// Compression Layer — OllamaClient and summarizeFunctions (Task 3)

export interface FunctionSummary {
  signature: string;
  caveman: string; // ≤10-word imperative summary
}

const SYSTEM_PROMPT =
  'You are a code summarizer. Summarize this function in under 10 words. Omit articles (a, the). Use imperative verbs. Do not use markdown headers. Output only the summary, nothing else.';

interface OllamaChunk {
  response: string;
  done: boolean;
}

export class OllamaClient {
  constructor(
    private model: string = 'phi3',
    private baseUrl: string = 'http://localhost:11434'
  ) {}

  async summarize(signature: string, body: string): Promise<string> {
    const prompt = `Function: ${signature}\n\nBody:\n${body}`;

    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        system: SYSTEM_PROMPT,
        stream: true,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama request failed: ${response.status} ${response.statusText}`
      );
    }

    if (!response.body) {
      throw new Error('Ollama response has no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulated = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const chunk = JSON.parse(trimmed) as OllamaChunk;
        accumulated += chunk.response;

        if (chunk.done) {
          return accumulated.trim();
        }
      }
    }

    // Flush any remaining buffer content
    if (buffer.trim()) {
      const chunk = JSON.parse(buffer.trim()) as OllamaChunk;
      accumulated += chunk.response;
    }

    return accumulated.trim();
  }
}

export async function summarizeFunctions(
  functions: Array<{ signature: string; body: string }>,
  model?: string
): Promise<FunctionSummary[]> {
  const client = new OllamaClient(model);
  const results: FunctionSummary[] = [];

  for (const fn of functions) {
    const caveman = await client.summarize(fn.signature, fn.body);
    results.push({ signature: fn.signature, caveman });
  }

  return results;
}
