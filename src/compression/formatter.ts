// Formatter — Builds TOON + Signatures .md string from ParseResult

import type { ParseResult } from '../ast/parser.js';

export function formatVaultNote(parsed: ParseResult, notes?: string): string {
  const lines: string[] = ['---'];

  lines.push(`tgt: ${parsed.filePath}`);

  if (parsed.deps.length > 0) {
    lines.push(`dep: ${parsed.deps.map((d) => `[[${d}]]`).join(', ')}`);
  }

  if (parsed.exports.length > 0) {
    lines.push(`exp: [${parsed.exports.join(', ')}]`);
  }

  lines.push('---');

  // New format: ## Signatures section with full function signatures
  if (parsed.exports.length > 0) {
    lines.push('## Signatures');
    for (const signature of parsed.exports) {
      lines.push(`- \`${signature}\``);
    }
  }

  if (notes !== undefined && notes.length > 0) {
    lines.push(`! ${notes}`);
  }

  return lines.join('\n');
}
