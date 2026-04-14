// Formatter — Builds hierarchical Obsidian .md string from ParseResult
// Sections: YAML frontmatter → Purpose blockquote → ## Inputs → ## Outputs
// Dataview-compatible inline fields (Imports::, Provides::) for directed graph rendering.

import type { ParseResult } from '../ast/parser.js';

export function formatVaultNote(parsed: ParseResult, notes?: string): string {
  const lines: string[] = ['---'];

  lines.push(`tgt: ${parsed.filePath}`);

  if (parsed.purpose) {
    // Escape quotes so the value is valid YAML
    lines.push(`purpose: "${parsed.purpose.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  }

  if (parsed.isEntryPoint) {
    lines.push('type: entrypoint');
    lines.push('tags: [entry-point]');
  }

  if (parsed.deps.length > 0) {
    lines.push(`dep: ${parsed.deps.map((d) => `[[${d}]]`).join(', ')}`);
  }

  if (parsed.exports.length > 0) {
    lines.push(`exp: [${parsed.exports.join(', ')}]`);
  }

  lines.push('---');

  // Purpose — displayed as a blockquote so it reads first in both Obsidian and LLM context
  if (parsed.purpose) {
    lines.push(`> ${parsed.purpose}`);
  }

  // Inputs — upstream dependencies as Dataview inline field for directed graph edges
  if (parsed.deps.length > 0) {
    lines.push('## Inputs');
    lines.push(`Imports:: ${parsed.deps.map((d) => `[[${d}]]`).join(', ')}`);
  }

  // Outputs — exported API as Dataview inline fields for downstream consumers
  if (parsed.exports.length > 0) {
    lines.push('## Outputs');
    for (const signature of parsed.exports) {
      lines.push(`Provides:: \`${signature}\``);
    }
  }

  if (notes !== undefined && notes.length > 0) {
    lines.push(`! ${notes}`);
  }

  return lines.join('\n');
}
