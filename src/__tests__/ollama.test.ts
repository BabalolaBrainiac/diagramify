import { describe, expect, it, vi } from 'vitest';
import { createOllamaEngine } from '../core/ollama.js';
import { createArchitectureRequest } from '../core/engines.js';

const request = () => createArchitectureRequest({ description: 'A shop.', direction: 'LR' });

describe('local interpretation', () => {
  it('uses an installed model and passes the graph schema without an API key', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true, response: '{"nodes":[]}',
        prompt_eval_count: 10, eval_count: 20 })));
    const result = await createOllamaEngine({ model: 'local-fixture', fetch: fetcher }).generate(await request());
    expect(result).toEqual({ graph: { nodes: [] }, tokensUsed: 30 });
    const [url, init] = fetcher.mock.calls[1];
    expect(String(url)).toBe('http://127.0.0.1:11434/api/generate');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init?.body))).toMatchObject({ stream: false, format: { type: 'object' }, options: { temperature: 0 } });
    expect(fetcher.mock.calls.map(([address]) => String(address))).not.toContain(expect.stringContaining('/api/pull'));
  });

  it.each(['https://example.com', 'file:///tmp/model', 'http://localhost?token=value'])('rejects a nonlocal or ambiguous address', baseUrl => {
    expect(() => createOllamaEngine({ model: 'local-fixture', baseUrl })).toThrow();
  });

  it('rejects a hosted model before sending the source context', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('{"remote_host":"https://example.com"}'));
    await expect(createOllamaEngine({ model: 'alias', fetch: fetcher }).generate(await request())).rejects.toThrow('hosted service');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    { done: true, done_reason: 'length', response: '{}' },
    { done: false, response: '{}' },
    { done: true, response: 'invalid' },
  ])('rejects incomplete or invalid model output', async response => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response(JSON.stringify(response)));
    await expect(createOllamaEngine({ model: 'fixture', fetch: fetcher }).generate(await request())).rejects.toThrow();
  });

  it('stops a request when its timeout expires', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    await expect(createOllamaEngine({ model: 'fixture', fetch: fetcher, timeoutMs: 5 }).generate(await request())).rejects.toThrow('timed out');
  });

  it('rejects oversized responses before parsing their contents', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(8 * 1024 * 1024 + 1)));
    await expect(createOllamaEngine({ model: 'fixture', fetch: fetcher }).generate(await request())).rejects.toThrow('size limit');
  });

  it('reports an unavailable local server without a hosted retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    await expect(createOllamaEngine({ model: 'fixture', fetch: fetcher }).generate(await request())).rejects.toThrow('Start Ollama');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
