/**
 * AST Parsing Engine — Plugin-based Extractor (Task 2)
 *
 * Uses a dynamic plugin registry to extract dependencies and exports.
 * Supports any language for which a plugin is registered.
 */

// Import and register built-in plugins on module load
import './plugins/index.js';

import { getPlugin, registeredExtensions } from './registry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Normalise input to file extension format.
 *
 * Accepts either:
 *  - File extension with dot: '.ts', '.py'
 *  - Legacy language name: 'typescript', 'python'
 *
 * Returns extension in '.ext' format.
 */
function normalizeInput(input: string): string {
  if (input.startsWith('.')) {
    return input;
  }

  // Legacy language name → extension mapping
  const nameToExt: Record<string, string> = {
    typescript: '.ts',
    python: '.py',
  };

  return nameToExt[input] ?? input;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract dependency names from source code using the appropriate plugin.
 *
 * @param source Source code text
 * @param extOrLanguage File extension (e.g. '.ts', '.py') or legacy language name
 * @returns Array of normalised dependency names
 * @throws Error if no plugin is registered for the extension
 */
export function extractDeps(source: string, extOrLanguage: string): string[] {
  const ext = normalizeInput(extOrLanguage);
  const plugin = getPlugin(ext);
  if (!plugin) {
    throw new Error(
      `No extractor plugin for extension: ${ext}. Registered: ${registeredExtensions().join(', ')}`
    );
  }
  return plugin.extractDeps(source);
}

/**
 * Extract export signatures from source code using the appropriate plugin.
 *
 * @param source Source code text
 * @param extOrLanguage File extension (e.g. '.ts', '.py') or legacy language name
 * @returns Array of export signatures
 * @throws Error if no plugin is registered for the extension
 */
export function extractExports(source: string, extOrLanguage: string): string[] {
  const ext = normalizeInput(extOrLanguage);
  const plugin = getPlugin(ext);
  if (!plugin) {
    throw new Error(
      `No extractor plugin for extension: ${ext}. Registered: ${registeredExtensions().join(', ')}`
    );
  }
  return plugin.extractExports(source);
}

/**
 * Backwards compatibility: class-based API (for existing code)
 * Supports both file extensions and legacy language names.
 * New code should use extractDeps/extractExports directly.
 */
export class DependencyExtractor {
  extract(source: string, extOrLanguage: string): string[] {
    return extractDeps(source, extOrLanguage);
  }
}

export class ExportExtractor {
  extract(source: string, extOrLanguage: string): string[] {
    return extractExports(source, extOrLanguage);
  }
}
