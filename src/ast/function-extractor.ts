/**
 * Function Code Extractor
 *
 * Locates a specific function in source code and returns just that function's body.
 * Supports TypeScript and Python.
 */

// Import and register built-in plugins on module load
import './plugins/index.js';

import { getPlugin } from './registry.js';

/**
 * Extract a specific function's source code from a file.
 *
 * @param source Source code text
 * @param functionName Function or method name to find
 * @param ext File extension (e.g., '.ts', '.py')
 * @returns The function's source code, or null if not found
 */
export function extractFunctionCode(
  source: string,
  functionName: string,
  ext: string
): string | null {
  const plugin = getPlugin(ext);
  if (!plugin?.extractFunctionCode) {
    return null;
  }
  return plugin.extractFunctionCode(source, functionName);
}
