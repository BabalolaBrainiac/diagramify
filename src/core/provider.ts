import { generateText, type LanguageModel } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { DiagramifyConfig, ProviderName } from './types.js';

const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o',
  google: 'gemini-2.5-flash',
};

export function resolveModel(config: DiagramifyConfig): LanguageModel {
  const modelId = config.model ?? DEFAULT_MODELS[config.provider as ProviderName];

  if (config.provider === 'google' && process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  if (config.apiKey) {
    process.env[getApiKeyEnvVar(config.provider)] = config.apiKey;
  }

  switch (config.provider) {
    case 'anthropic':
      return anthropic(modelId);
    case 'openai':
      return openai(modelId);
    case 'google':
      return google(modelId);
    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

function getApiKeyEnvVar(provider: ProviderName): string {
  const envMap: Record<ProviderName, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    google: process.env['GEMINI_API_KEY'] ? 'GEMINI_API_KEY' : 'GOOGLE_GENERATIVE_AI_API_KEY',
  };
  return envMap[provider];
}

export async function callLLM(
  model: LanguageModel,
  systemPrompt: string,
  userPrompt: string,
  maxTokens?: number,
  temperature?: number,
): Promise<{ text: string; tokensUsed: number }> {
  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: temperature ?? 0.7,
    maxTokens: maxTokens,
  });

  return {
    text: result.text,
    tokensUsed: result.usage.totalTokens,
  };
}
