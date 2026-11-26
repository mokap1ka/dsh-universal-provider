import Schema from '@deepseek-ai/schemastery'

export const name = 'dsh-universal-provider'
export const inject = ['llm', 'credentials', 'settings']

export const Config = Schema.object({
  baseUrl: Schema.string().required().description('Адрес API провайдера (например, https://api.anthropic.com/v1)'),
  apiKey: Schema.string().required().role('secret').description('Ваш секретный API-ключ'),
})

async function detectProtocol(baseUrl, apiKey) {
  const cleanUrl = baseUrl.replace(/\/$/, '')
  try {
    const res = await fetch(`${cleanUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.data) && data.data[0]?.object === 'model') return 'openai-completions'
      if (Array.isArray(data?.data) && (data.data[0]?.type === 'model' || data.data[0]?.display_name)) return 'anthropic-messages'
    }
  } catch (e) {}

  try {
    const res = await fetch(`${cleanUrl}/models`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(5000),
    })
    if (res.ok) {
      const data = await res.json()
      if (Array.isArray(data?.data) && (data.data[0]?.type === 'model' || data.data[0]?.display_name)) return 'anthropic-messages'
    }
  } catch (e) {}

  return 'openai-completions'
}

export async function apply(ctx, config) {
  const { llm, credentials } = ctx
  const hostname = new URL(config.baseUrl).hostname
  const providerId = `universal-${hostname.replace(/\./g, '-')}`
  const credentialRef = `universal-provider:${providerId}:apiKey`

  const protocol = await detectProtocol(config.baseUrl, config.apiKey)

  ctx.effect(() => {
    credentials.set(credentialRef, config.apiKey)
    return () => credentials.delete(credentialRef)
  })

  ctx.effect(() => {
    const models = protocol === 'anthropic-messages' ? [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku' },
    ] : undefined

    const dispose = llm.registerProvider({
      id: providerId,
      name: `Universal (${hostname})`,
      baseUrl: config.baseUrl,
      apiKeyRef: credentialRef,
      protocol: protocol,
      models,
    })
    return () => dispose()
  })

  ctx.logger?.info?.(`[universal-provider] ${hostname} -> ${protocol}`)
}
