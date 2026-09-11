import { generateObject, generateText, type LanguageModel } from 'ai';
import type { z } from 'zod';
import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import { google } from '@ai-sdk/google';
import type { DiagramifyConfig, ProviderName } from './types.js';
import { resolveModelId } from './models.js';

/**
 * Builds the model handle.
 *
 * `modelId` is resolved before this call, so the provider is asked what it
 * offers rather than told a name this package happened to know when it shipped.
 */
export function resolveModel(config: DiagramifyConfig, modelId: string): LanguageModel {
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

/** How long to wait for one model call before giving up. */
const CALL_TIMEOUT_MS = Number(process.env.DIAGRAMIFY_TIMEOUT_MS ?? 120000);

/** How many times to retry. The SDK default of 3 hides a quota error for minutes. */
const MAX_RETRIES = Number(process.env.DIAGRAMIFY_MAX_RETRIES ?? 1);

/**
 * Rewrites a provider error into something a user can act on.
 *
 * A quota error used to surface as a wall of retries and a raw SDK message.
 * The cause matters less than the next step, so the next step comes first.
 */
function describeCallFailure(error: unknown, modelId?: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const named = modelId ? ` (${modelId})` : '';

  if (/quota|rate.?limit|429|resource_exhausted/i.test(message)) {
    return new Error(
      `The provider refused the request because the quota for this key is used up${named}.\n` +
        '  - Wait for the quota to reset, or use a key with a higher limit.\n' +
        '  - Try a smaller model: --tier fast\n' +
        '  - Pin a model with separate quota: --model <id>. Run "diagramify models --all" to list them.\n' +
        '  - Build the diagram with no model at all: --no-llm',
    );
  }

  if (/high demand|overload|503|unavailable/i.test(message)) {
    return new Error(
      `The model is busy${named}. Try again shortly, pick another with --model, or run --no-llm.`,
    );
  }

  if (/abort|timeout/i.test(message)) {
    return new Error(
      `The model did not answer within ${Math.round(CALL_TIMEOUT_MS / 1000)}s${named}. ` +
        'Raise DIAGRAMIFY_TIMEOUT_MS, choose a smaller model with --tier fast, or run --no-llm.',
    );
  }

  if (/api key|unauthenticated|401|403|permission/i.test(message)) {
    return new Error(
      `The provider rejected the key${named}. Check that it is current and has access to this model.`,
    );
  }

  return error instanceof Error ? error : new Error(message);
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let result;
  try {
    result = await generateText({
      model,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: temperature ?? 0.7,
      maxOutputTokens: maxTokens,
      maxRetries: MAX_RETRIES,
      abortSignal: controller.signal,
      ...(providerOptions ? { providerOptions } : {}),
    });
  } catch (error) {
    throw describeCallFailure(error, (model as { modelId?: string }).modelId);
  } finally {
    clearTimeout(timer);
  }

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);

  let result;
  try {
    result = await generateObject({
      model,
      schema,
      system: systemPrompt,
      prompt: userPrompt,
      temperature: temperature ?? 0.3,
      maxOutputTokens: maxTokens,
      maxRetries: MAX_RETRIES,
      abortSignal: controller.signal,
      ...(providerOptions ? { providerOptions } : {}),
    });
  } catch (error) {
    throw describeCallFailure(error, (model as { modelId?: string }).modelId);
  } finally {
    clearTimeout(timer);
  }

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

/**
 * Chooses the provider and the model together, then builds the handle.
 *
 * This is the entry point a caller should use. It reports which provider and
 * model it settled on, so the choice is never a surprise to the user.
 */
export async function resolveProviderAndModel(
  config: DiagramifyConfig,
  onNotice?: (message: string) => void,
): Promise<{ model: LanguageModel; modelId: string; provider: ProviderName }> {
  const credential = config.apiKey;

  const modelId = await resolveModelId(config.provider, {
    model: config.model,
    tier: config.tier,
    apiKey: credential,
    discover: config.discoverModels,
    onNotice,
  });

  return {
    model: resolveModel(config, modelId),
    modelId,
    provider: config.provider,
  };
}
