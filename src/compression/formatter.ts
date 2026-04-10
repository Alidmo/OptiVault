// Formatter — Builds TOON + Caveman .md string from ParseResult + summaries (Task 3)

import type { ParseResult } from '../ast/parser.js';
import type { FunctionSummary } from './ollama.js';

export function formatVaultNote(
  parsed: ParseResult,
  summaries: FunctionSummary[],
  notes?: string
): string {
  const lines: string[] = ['---'];

  lines.push(`tgt: ${parsed.filePath}`);

  if (parsed.deps.length > 0) {
    lines.push(`dep: ${parsed.deps.map((d) => `[[${d}]]`).join(', ')}`);
  }

  if (parsed.exports.length > 0) {
    lines.push(`exp: [${parsed.exports.join(', ')}]`);
  }

  lines.push('---');

  for (const summary of summaries) {
    lines.push(`${summary.signature}: ${summary.caveman}`);
  }

  if (notes !== undefined && notes.length > 0) {
    lines.push(`! ${notes}`);
  }

  return lines.join('\n');
}
