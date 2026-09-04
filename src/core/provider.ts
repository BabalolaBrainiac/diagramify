import { generateObject, generateText, type LanguageModel } from 'ai';
import type { z } from 'zod';
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

/** True for Gemini 2.5 models which use thinking tokens that eat into the output budget. */
function isGeminiThinkingModel(model: LanguageModel): boolean {
  const id = (model as any).modelId as string | undefined;
  return typeof id === 'string' && /gemini-2\.5/.test(id);
}

export async function callLLM(
  model: LanguageModel,
  systemPrompt: string,
  userPrompt: string,
  maxTokens?: number,
  temperature?: number,
): Promise<{ text: string; tokensUsed: number }> {
  // For Gemini 2.5 thinking models, disable thinking budget so all output tokens go to text.
  // Without this, the model spends most tokens on hidden reasoning, truncating diagram output.
  const providerOptions = isGeminiThinkingModel(model)
    ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
    : undefined;

  const result = await generateText({
    model,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: temperature ?? 0.7,
    maxOutputTokens: maxTokens,
    ...(providerOptions ? { providerOptions } : {}),
  });

  return {
    text: result.text,
    tokensUsed: result.usage.totalTokens ?? 0,
  };
}

/**
 * Asks the model to fill a schema instead of writing text.
 *
 * This is what makes provider choice stop mattering. A model no longer has to
 * be good at Mermaid formatting. It only has to return the shape the schema
 * describes, which every serious provider supports.
 */
export async function callLLMForObject<T>(
  model: LanguageModel,
  systemPrompt: string,
  userPrompt: string,
  schema: z.ZodType<T>,
  maxTokens?: number,
  temperature?: number,
): Promise<{ object: T; tokensUsed: number }> {
  // A thinking model spends its output budget on hidden reasoning, which
  // truncates the answer. Structured output needs the whole budget.
  const providerOptions = isGeminiThinkingModel(model)
    ? { google: { thinkingConfig: { thinkingBudget: 0 } } }
    : undefined;

  const result = await generateObject({
    model,
    schema,
    system: systemPrompt,
    prompt: userPrompt,
    temperature: temperature ?? 0.3,
    maxOutputTokens: maxTokens,
    ...(providerOptions ? { providerOptions } : {}),
  });

  return {
    object: result.object as T,
    tokensUsed: result.usage.totalTokens ?? 0,
  };
}

/** True when the provider can be reached. Used to pick a path before a call. */
export function hasCredentials(config: DiagramifyConfig): boolean {
  if (config.apiKey) {
    return true;
  }
  const names: Record<ProviderName, string[]> = {
    anthropic: ['ANTHROPIC_API_KEY'],
    openai: ['OPENAI_API_KEY'],
    google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GEMINI_API_KEY'],
  };
  return (names[config.provider as ProviderName] ?? []).some((name) => Boolean(process.env[name]));
}
