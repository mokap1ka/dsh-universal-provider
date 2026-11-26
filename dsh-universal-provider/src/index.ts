import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { ServiceType as LlmServiceType } from '@deepseek-ai/dsh-llm'
import type { ServiceType as CredentialsServiceType } from '@deepseek-ai/dsh-credentials'

// 1. Схема конфигурации: поля для URL и ключа
export interface Config {
  providerId: string
  baseUrl: string
  apiKey: string
  protocol: 'openai' | 'anthropic'
}

export const Config: Schema<Config> = Schema.object({
  providerId: Schema.string().required().description('Уникальный ID провайдера (латиница, например, my-anthropic)'),
  baseUrl: Schema.string().required().description('Базовый URL API (например, https://api.anthropic.com/v1)'),
  apiKey: Schema.string().required().role('secret').description('Ваш API-ключ'),
  protocol: Schema.union([
    Schema.const('openai').description('OpenAI-совместимый (DeepSeek, Ollama, Qwen и др.)'),
    Schema.const('anthropic').description('Anthropic Messages API'),
  ]).default('openai').description('Протокол API'),
})

// 2. Плагин
export const name = 'my-custom-provider'
export const inject = ['llm', 'credentials', 'settings'] // Зависимости

export function apply(ctx: Context, config: Config) {
  const { llm, credentials } = ctx
  
  // Регистрируем API-ключ в защищенном хранилище DSH
  const credentialRef = `custom-provider:${config.providerId}:apiKey`
  
  ctx.effect(() => {
    credentials.set(credentialRef, config.apiKey)
    return () => credentials.delete(credentialRef)
  })

  // Регистрируем самого провайдера в LLM-сервисе
  ctx.effect(() => {
    const dispose = llm.registerProvider({
      id: config.providerId,
      name: config.providerId, // Отображаемое имя
      baseUrl: config.baseUrl,
      apiKeyRef: credentialRef,
      protocol: config.protocol === 'anthropic' ? 'anthropic-messages' : 'openai-completions',
      // Список моделей: DSH сам запросит их у провайдера, если endpoint /models доступен.
      // Для Anthropic или других API, где такого endpoint нет, можно указать модели вручную:
      models: config.protocol === 'anthropic'
        ? [
            { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
            { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus' },
          ]
        : undefined, // Для OpenAI-совместимых DSH попробует загрузить список сам
    })
    return () => dispose()
  })
}
