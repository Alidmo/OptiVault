import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaClient, summarizeFunctions } from './ollama.js';

// ---------------------------------------------------------------------------
// Helpers to build a mock streaming NDJSON fetch response
// ---------------------------------------------------------------------------

function makeNdjsonStream(chunks: Array<{ response: string; done: boolean }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
      }
      controller.close();
    },
  });
}

function makeMockFetch(chunks: Array<{ response: string; done: boolean }>): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: makeNdjsonStream(chunks),
  } as unknown as Response);
}

// ---------------------------------------------------------------------------
// OllamaClient.summarize
// ---------------------------------------------------------------------------

describe('OllamaClient.summarize', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('calls POST /api/generate with the correct URL', async () => {
    const mockFetch = makeMockFetch([
      { response: 'Read token.', done: false },
      { response: ' Return bool.', done: true },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient('phi3', 'http://localhost:11434');
    await client.summarize('verifyToken(token)', 'return jwt.verify(token, SECRET);');

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/api/generate');
  });

  it('sends the correct system prompt in the request body', async () => {
    const mockFetch = makeMockFetch([{ response: 'Verify JWT.', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    await client.summarize('verifyToken(token)', 'return jwt.verify(token, SECRET);');

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(body.system).toBe(
      'You are a code summarizer. Summarize this function in under 10 words. Omit articles (a, the). Use imperative verbs. Do not use markdown headers. Output only the summary, nothing else.'
    );
  });

  it('sends the correct user prompt format', async () => {
    const mockFetch = makeMockFetch([{ response: 'Hash password.', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    const signature = 'hashPwd(plain)';
    const body = 'return bcrypt.hash(plain, 10);';
    await client.summarize(signature, body);

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(requestBody.prompt).toBe(`Function: ${signature}\n\nBody:\n${body}`);
  });

  it('sets stream: true in the request body', async () => {
    const mockFetch = makeMockFetch([{ response: 'Do thing.', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    await client.summarize('fn()', '');

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(requestBody.stream).toBe(true);
  });

  it('accumulates response text across multiple chunks', async () => {
    const mockFetch = makeMockFetch([
      { response: 'Read', done: false },
      { response: ' token.', done: false },
      { response: ' Return bool.', done: true },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    const result = await client.summarize('verifyToken(token)', 'return jwt.verify(token, SECRET);');

    expect(result).toBe('Read token. Return bool.');
  });

  it('stops accumulating after the chunk where done is true', async () => {
    const mockFetch = makeMockFetch([
      { response: 'Validate input.', done: true },
      // This chunk should never be reached
      { response: ' EXTRA', done: false },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    const result = await client.summarize('fn()', '');

    expect(result).toBe('Validate input.');
    expect(result).not.toContain('EXTRA');
  });

  it('trims leading and trailing whitespace from the result', async () => {
    const mockFetch = makeMockFetch([{ response: '  Check token.  ', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    const result = await client.summarize('fn()', '');

    expect(result).toBe('Check token.');
  });

  it('throws when the HTTP response is not ok', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      body: null,
    } as unknown as Response);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient();
    await expect(client.summarize('fn()', '')).rejects.toThrow('500');
  });

  it('uses the model name supplied to the constructor', async () => {
    const mockFetch = makeMockFetch([{ response: 'Do thing.', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    const client = new OllamaClient('llama3');
    await client.summarize('fn()', '');

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(requestBody.model).toBe('llama3');
  });
});

// ---------------------------------------------------------------------------
// summarizeFunctions
// ---------------------------------------------------------------------------

describe('summarizeFunctions', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns an array with one summary per function', async () => {
    let callCount = 0;
    const responses = ['Read token. Return bool.', 'Hash password. Return string.'];

    const mockFetch = vi.fn().mockImplementation(() => {
      const response = responses[callCount++];
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: makeNdjsonStream([{ response, done: true }]),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', mockFetch);

    const fns = [
      { signature: 'verifyToken(token)', body: 'return jwt.verify(token, SECRET);' },
      { signature: 'hashPwd(plain)', body: 'return bcrypt.hash(plain, 10);' },
    ];

    const result = await summarizeFunctions(fns);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ signature: 'verifyToken(token)', caveman: 'Read token. Return bool.' });
    expect(result[1]).toEqual({ signature: 'hashPwd(plain)', caveman: 'Hash password. Return string.' });
  });

  it('calls fetch once per function (sequentially)', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        body: makeNdjsonStream([{ response: 'Do thing.', done: true }]),
      } as unknown as Response);
    });
    vi.stubGlobal('fetch', mockFetch);

    const fns = [
      { signature: 'fn1()', body: 'return 1;' },
      { signature: 'fn2()', body: 'return 2;' },
      { signature: 'fn3()', body: 'return 3;' },
    ];

    await summarizeFunctions(fns);

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(callCount).toBe(3);
  });

  it('returns an empty array when given no functions', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const result = await summarizeFunctions([]);

    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('passes the custom model name to the Ollama API', async () => {
    const mockFetch = makeMockFetch([{ response: 'Do thing.', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    await summarizeFunctions([{ signature: 'fn()', body: '' }], 'mistral');

    const [, init] = (mockFetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(requestBody.model).toBe('mistral');
  });

  it('preserves the original signature in each FunctionSummary', async () => {
    const mockFetch = makeMockFetch([{ response: 'Compute value.', done: true }]);
    vi.stubGlobal('fetch', mockFetch);

    const fns = [{ signature: 'computeValue(x, y)', body: 'return x + y;' }];
    const result = await summarizeFunctions(fns);

    expect(result[0].signature).toBe('computeValue(x, y)');
  });
});
