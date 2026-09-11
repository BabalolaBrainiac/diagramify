import type { ArchitectureEngine } from './engines.js';

export interface OllamaOptions {
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxTokens?: number;
  fetch?: typeof fetch;
}

function localAddress(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('The local model address must use a loopback host without credentials or query parameters.');
  }
  return url;
}

async function readResponse(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Ollama returned HTTP ${response.status}. Check the server and installed model.`);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Ollama returned an empty response.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) {
        await reader.cancel();
        throw new Error('The local model response exceeds the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Ollama returned an invalid response.');
  return body as Record<string, unknown>;
}

/** Uses an installed local model. It does not download models or contact a hosted provider. */
export function createOllamaEngine(options: OllamaOptions): ArchitectureEngine {
  const baseUrl = localAddress(options.baseUrl ?? 'http://127.0.0.1:11434');
  const model = options.model.trim();
  if (!model || /(?:^|[-:])cloud(?:$|[-:])/.test(model)) throw new Error('Select an installed local model. Cloud models are not supported.');
  const timeoutMs = options.timeoutMs ?? 120000;
  const maxTokens = options.maxTokens ?? 8192;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new Error('The model timeout and token limit must be positive numbers.');
  }
  const request = options.fetch ?? globalThis.fetch;
  return {
    name: `ollama/${model}`,
    async generate(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const post = async (path: string, body: object) => readResponse(await request(new URL(path, baseUrl), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: controller.signal, redirect: 'error',
      }));
      try {
        const info = await post('/api/show', { model });
        if (info.remote_host || info.remote_model) throw new Error('The selected model uses a hosted service. Select a local model.');
        const result = await post('/api/generate', {
          model, system: input.systemPrompt, prompt: input.prompt,
          format: input.schema, stream: false, think: false,
          options: { temperature: 0, num_predict: maxTokens },
        });
        if (result.done !== true || result.done_reason === 'length' || typeof result.response !== 'string') {
          throw new Error('The local model did not return a complete graph.');
        }
        const tokens = [result.prompt_eval_count, result.eval_count]
          .reduce<number>((sum, count) => sum + (typeof count === 'number' && Number.isFinite(count) && count >= 0 ? count : 0), 0);
        return { graph: JSON.parse(result.response), tokensUsed: tokens };
      } catch (error) {
        if (controller.signal.aborted) throw new Error('The local model request timed out.');
        if (error instanceof SyntaxError) throw new Error('The local model returned invalid JSON.');
        if (error instanceof TypeError) throw new Error('Cannot reach the local model server. Start Ollama and select an installed model.');
        throw error;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
