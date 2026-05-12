// AST Parsing Engine — public entry point (Task 2)
// Uses the plugin-based extractor to parse files in any registered language.

import { readFile } from 'fs/promises';
import {
  extractDeps,
  extractExports,
  extractModulePurpose,
  detectEntryPoint,
  extractEntities,
  DependencyExtractor,
  ExportExtractor,
} from './extractor.js';
import { detectFrameworkRoles } from './framework-heuristics.js';
import type { Entity } from './types.js';

export { DependencyExtractor, ExportExtractor };
export type { Entity };

// ---------------------------------------------------------------------------
// ParseResult
// ---------------------------------------------------------------------------

export interface ParseResult {
  deps: string[];        // Obsidian wikilink targets e.g. ['database', 'crypto']
  exports: string[];     // Exported function/class signatures e.g. ['verifyToken(token: string)']
  filePath: string;
  purpose?: string;      // Module-level purpose extracted from docstring or leading comment
  isEntryPoint?: true;   // Present (true) when the file is a program entry point
  concepts?: string[];   // Carried over from the pre-existing vault note (never populated by parsers)
  roles?: string[];      // Framework roles (e.g. "Symfony:Entity") detected by heuristics
  entities?: Entity[];   // Granular entities (functions/classes) declared in this file
}

// ---------------------------------------------------------------------------
// File extension detection
// ---------------------------------------------------------------------------

/**
 * Extract file extension from a file path (including the dot).
 * Returns null for unsupported files.
 */
function getFileExtension(filePath: string): string | null {
  const lastDot = filePath.lastIndexOf('.');
  if (lastDot === -1) return null;
  return filePath.slice(lastDot).toLowerCase();
}

// ---------------------------------------------------------------------------
// parseFile — Plugin-driven parser
// ---------------------------------------------------------------------------

/**
 * Read a source file from disk and extract:
 *  - `deps`    — normalised import/require targets (wikilink-ready)
 *  - `exports` — exported function/class/const signatures
 *
 * Uses the plugin registry to support any registered language.
 * Throws if:
 *  - The file cannot be read
 *  - The file extension has no registered parser plugin
 */
export async function parseFile(filePath: string): Promise<ParseResult> {
  const ext = getFileExtension(filePath);
  if (ext === null) {
    throw new Error(`No file extension found: ${filePath}`);
  }

  const source = await readFile(filePath, 'utf8');

  const purpose = extractModulePurpose(source, ext);
  const entryPoint = detectEntryPoint(source, filePath, ext);
  const roles = detectFrameworkRoles(source, filePath);
  const entities = extractEntities(source, ext);

  return {
    deps: extractDeps(source, ext),
    exports: extractExports(source, ext),
    filePath,
    ...(purpose ? { purpose } : {}),
    ...(entryPoint ? { isEntryPoint: true as const } : {}),
    ...(roles.length > 0 ? { roles } : {}),
    ...(entities.length > 0 ? { entities } : {}),
  };
}
