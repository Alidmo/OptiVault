/**
 * Python Language Plugin
 *
 * Extracts dependencies and exports from Python source.
 * Handles: .py
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove duplicate entries while preserving insertion order. */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Normalise a raw import path into a wikilink-friendly dep name.
 *
 * Rules applied in order:
 *  1. Strip a leading `@scope/` segment (scoped npm packages).
 *  2. Strip leading `./` or `../` sequences.
 *  3. Strip a trailing file extension (.ts, .tsx, .js, .mjs, .py, …).
 *  4. Take only the last path component (handles `foo/bar/baz` → `baz`).
 */
function normaliseDep(raw: string): string {
  let dep = raw.trim().replace(/^['"`]|['"`]$/g, ''); // remove surrounding quotes if any

  // Remove scoped package prefix: @scope/name → name
  dep = dep.replace(/^@[^/]+\//, '');

  // Remove leading relative path segments
  dep = dep.replace(/^(?:\.\.\/|\.\/)+/, '');

  // Take only the last path segment
  const segments = dep.split('/');
  dep = segments[segments.length - 1] ?? dep;

  // Strip known file extensions
  dep = dep.replace(/\.(ts|tsx|js|mjs|cjs|py)$/, '');

  return dep;
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract all import dependency names from Python source text.
 *
 * Handles:
 *  - `import module` / `import a, b, c`
 *  - `from .relative import ...` / `from module import ...`
 */
function extractPythonDeps(source: string): string[] {
  const deps: string[] = [];

  // from [.relative.]module import ...
  const fromImport = /^[ \t]*from\s+([\w.]+)\s+import\b/gm;
  let m: RegExpExecArray | null;
  while ((m = fromImport.exec(source)) !== null) {
    // Strip leading dots (relative import markers)
    const mod = m[1].replace(/^\.+/, '');
    if (mod) deps.push(normaliseDep(mod));
  }

  // import module [as alias] [, module2 [as alias2] ...]
  const plainImport = /^[ \t]*import\s+([\w,\s.]+?)(?:\s*#.*)?$/gm;
  while ((m = plainImport.exec(source)) !== null) {
    const names = m[1].split(',');
    for (const name of names) {
      // Handle `module as alias` — take only the module part
      const base = name.trim().split(/\s+as\s+/i)[0].trim();
      // For dotted names like `os.path`, take the top-level module
      const topLevel = base.split('.')[0];
      if (topLevel) deps.push(normaliseDep(topLevel));
    }
  }

  return dedupe(deps);
}

/**
 * Extract top-level function/class definitions from Python source.
 *
 * Handles:
 *  - `def name(params):`
 *  - `async def name(params):`
 *  - `class Name:`  / `class Name(Base):`
 *
 * Only top-level definitions (zero indentation) are returned, since those
 * are the module's public API equivalents.
 */
function extractPythonExports(source: string): string[] {
  const exports: string[] = [];

  // Top-level def (no leading whitespace)
  const funcDef = /^(?:async\s+)?def\s+(\w+)\s*(\([^)]*\))\s*(?:->.*?)?:/gm;
  let m: RegExpExecArray | null;
  while ((m = funcDef.exec(source)) !== null) {
    // Verify there's no leading whitespace (top-level only)
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const indent = m.index - lineStart;
    if (indent === 0) {
      const name = m[1];
      const params = m[2];
      exports.push(`${name}${params}`);
    }
  }

  // Top-level class
  const classDef = /^class\s+(\w+)/gm;
  while ((m = classDef.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the full source of a named function or method from Python source.
 *
 * Handles top-level `def name(...)` and `async def name(...)`.
 * The function body ends when a non-blank line returns to the same or lower
 * indentation level as the `def` keyword.
 */
function extractPyFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  const pat = new RegExp(`^([ \\t]*)(?:async\\s+)?def\\s+${esc}\\s*\\(`, 'm');
  const m = pat.exec(source);
  if (!m) return null;

  const baseIndentLen = m[1].length;
  const lines = source.slice(m.index).split('\n');
  const out: string[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { out.push(line); continue; }
    const indentLen = (line.match(/^([ \t]*)/)?.[1] ?? '').length;
    if (indentLen <= baseIndentLen) break; // back at or above def level — function ended
    out.push(line);
  }

  // Trim trailing blank lines
  while (out.length > 1 && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const pythonPlugin: LanguagePlugin = {
  extensions: ['.py'],
  extractDeps: extractPythonDeps,
  extractExports: extractPythonExports,
  extractFunctionCode: extractPyFunctionCode,
};
