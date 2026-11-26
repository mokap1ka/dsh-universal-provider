import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { ServiceType as LlmServiceType } from '@deepseek-ai/dsh-llm'
import type { ServiceType as CredentialsServiceType } from '@deepseek-ai/dsh-credentials'

export interface Config {
  baseUrl: string
  apiKey: string
}

export const Config: Schema<Config> = Schema.object({
  baseUrl: Schema.string().required().description('Любой адрес API (например, https://api.target-app.shop/v1)'),
  apiKey: Schema.string().required().role('secret').description('Ваш секретный API-ключ'),
})

export const name = 'dsh-universal-provider'
export const inject = ['llm', 'credentials', 'settings']

// --- ФУНКЦИЯ АВТООПРЕДЕЛЕНИЯ ПРОТОКОЛА ---
async function detectProtocol(
  baseUrl: string,
  apiKey: string,
): Promise<'openai-completions' | 'anthropic-messages'> {
  const cleanUrl = baseUrl.replace(/\/$/, '')

  // Попытка №1: OpenAI-стиль (Bearer)
  try {
    const res = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      // OpenAI: { data: [{ id, object: "model" }] }
      if (Array.isArray(data?.data) && data.data[0]?.object === 'model') {
        return 'openai-completions'
      }
      // Anthropic: { data: [{ id, type: "model", display_name }] }
      if (Array.isArray(data?.data) && (data.data[0]?.type === 'model' || data.data[0]?.display_name)) {
        return 'anthropic-messages'
      }
    }
  } catch { /* игнорируем, пробуем дальше */ }

  // Попытка №2: Anthropic-стиль (x-api-key)
  try {
    const res = await fetch(`${cleanUrl}/models`, {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.data) && (data.data[0]?.type === 'model' || data.data[0]?.display_name)) {
        return 'anthropic-messages'
      }
    }
  } catch { /* игнорируем */ }

  // Fallback: OpenAI-совместимый — самый распространённый стандарт
  return 'openai-completions'
}

export async function apply(ctx: Context, config: Config) {
  const { llm, credentials } = ctx
  const hostname = new URL(config.baseUrl).hostname
  const providerId = `universal-${hostname.replace(/\./g, '-')}`
  const credentialRef = `universal-provider:${providerId}:apiKey`

  // Определяем протокол пробным запросом
  const protocol = await detectProtocol(config.baseUrl, config.apiKey)

  // Сохраняем ключ в защищённое хранилище
  ctx.effect(() => {
    credentials.set(credentialRef, config.apiKey)
    return () => credentials.delete(credentialRef)
  })

  // Регистрируем провайдера
  ctx.effect(() => {
    const models = protocol === 'anthropic-messages'
      ? [
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
        ]
      : undefined // для OpenAI-совместимых DSH попробует загрузить список сам

    const dispose = llm.registerProvider({
      id: providerId,
      name: `Universal (${hostname})`,
      baseUrl: config.baseUrl,
      apiKeyRef: credentialRef,
      protocol: protocol as any,
      models,
    })
    return () => dispose()
  })

  ctx.logger?.info?.(`[universal-provider] ${hostname} → ${protocol}`)
}
