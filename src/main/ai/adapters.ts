import { AnthropicAdapter } from './anthropic'
import { OpenAICompatibleAdapter, pickGemini, pickOllama, pickOpenAI, pickOpenRouter } from './openaiCompatible'
import type { ProviderAdapter } from './types'

/** Every provider AutoTyper can write with, in the order the UI lists them. */
export function createAdapters(): ProviderAdapter[] {
  return [
    new AnthropicAdapter(),
    new OpenAICompatibleAdapter({
      id: 'openai',
      name: 'ChatGPT (OpenAI)',
      keyPage: 'https://platform.openai.com/api-keys',
      keyPlaceholder: 'sk-…',
      envVars: ['OPENAI_API_KEY'],
      pick: pickOpenAI
    }),
    new OpenAICompatibleAdapter({
      id: 'gemini',
      name: 'Gemini (Google)',
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      keyPage: 'https://aistudio.google.com/app/apikey',
      keyPlaceholder: 'AIza…',
      envVars: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      pick: pickGemini
    }),
    new OpenAICompatibleAdapter({
      id: 'openrouter',
      name: 'OpenRouter',
      baseURL: 'https://openrouter.ai/api/v1',
      keyPage: 'https://openrouter.ai/settings/keys',
      keyPlaceholder: 'sk-or-…',
      envVars: ['OPENROUTER_API_KEY'],
      signIn: true,
      // The model list is public, so check the key itself (GET /api/v1/key rejects bad keys).
      verifyPath: '/key',
      headers: { 'HTTP-Referer': 'https://github.com/autotyper', 'X-Title': 'AutoTyper' },
      pick: pickOpenRouter
    }),
    new OpenAICompatibleAdapter({
      id: 'ollama',
      name: 'Ollama (on this computer)',
      baseURL: 'http://localhost:11434/v1',
      envVars: [],
      local: true,
      pick: pickOllama
    })
  ]
}
