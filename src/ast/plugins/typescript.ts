/**
 * TypeScript Language Plugin
 *
 * Extracts dependencies and exports from TypeScript/JavaScript source.
 * Handles: .ts, .tsx, .js, .mjs, .jsx
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove duplicate entries while preserving insertion order. */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk forward from `openPos` (an opening `{`) and return the index of the
 * matching `}`, respecting nested braces and string literals.
 * Returns -1 if no matching brace is found.
 */
function findClosingBrace(source: string, openPos: number): number {
  let depth = 0;
  let inStr: '"' | "'" | '`' | null = null;
  for (let i = openPos; i < source.length; i++) {
    const ch = source[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; } // skip escape sequence
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inStr = ch as '"' | "'" | '`';
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      if (--depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Extract the function body (or expression) starting at `offset` in `source`.
 *
 * Handles both block bodies (`{ ... }`) and arrow expression bodies (`=> expr`).
 * Returns null if no body can be located.
 */
function extractBodyAt(source: string, offset: number): string | null {
  const slice = source.slice(offset);
  const braceIdx = slice.indexOf('{');
  const arrowIdx = slice.indexOf('=>');

  // Arrow with expression body: `=>` appears before any `{`
  if (arrowIdx !== -1 && (braceIdx === -1 || arrowIdx < braceIdx)) {
    let j = arrowIdx + 2;
    while (j < slice.length && (slice[j] === ' ' || slice[j] === '\t')) j++;
    if (j < slice.length && slice[j] !== '{') {
      // Expression body — take until `;` or end-of-line
      const semi = slice.indexOf(';', j);
      const nl = slice.indexOf('\n', j);
      let stop = slice.length;
      if (semi !== -1) stop = Math.min(stop, semi + 1);
      if (nl !== -1) stop = Math.min(stop, nl);
      return slice.slice(0, stop).trim();
    }
    // Arrow with block body — fall through to brace matching
  }

  if (braceIdx === -1) return null;
  const closeIdx = findClosingBrace(slice, braceIdx);
  if (closeIdx === -1) return null;
  return slice.slice(0, closeIdx + 1).trim();
}

/**
 * Extract the full source of a named function/arrow/method from TypeScript source.
 *
 * Handles:
 *  - `[export] [async] function name(...) { ... }`
 *  - `[export] const/let/var name = [async] (...) => ...`
 *  - Class methods with optional access modifiers
 */
function extractTSFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  const patterns = [
    // Standard/async function declaration
    new RegExp(`^[ \\t]*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${esc}\\b`, 'm'),
    // Arrow/const/let/var assignment
    new RegExp(`^[ \\t]*(?:export\\s+)?(?:const|let|var)\\s+${esc}\\b`, 'm'),
    // Class method (indented, optional access modifiers)
    new RegExp(`^[ \\t]+(?:(?:public|private|protected|static|async|override)\\s+)*${esc}\\b`, 'm'),
  ];

  for (const pat of patterns) {
    const m = pat.exec(source);
    if (!m) continue;
    const body = extractBodyAt(source, m.index);
    if (body) return body;
  }
  return null;
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
 * Return true for import paths that reference a project-local file.
 * Only relative paths (starting with `./` or `../`) count.
 * External npm packages and Node builtins are excluded to keep the
 * Obsidian graph free of orphaned package nodes.
 */
function isRelativeImport(raw: string): boolean {
  return raw.startsWith('./') || raw.startsWith('../');
}

/**
 * Extract project-local import dependency names from TypeScript source text.
 *
 * Only relative imports (`./module`, `../util`) are emitted as wikilink-ready
 * dep names. External packages (`express`, `@scope/pkg`, `path`) are skipped
 * to prevent orphaned nodes in the Obsidian graph.
 *
 * Handles:
 *  - `import ... from './module'`
 *  - `import './side-effect'` (side-effect import)
 *  - `require('./module')`
 *  - `import('./lazy')` (dynamic import)
 */
function extractTypeScriptDeps(source: string): string[] {
  const deps: string[] = [];

  // Static import:  import ... from './path'
  const staticImport = /\bfrom\s+(['"`])([^'"`\n]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = staticImport.exec(source)) !== null) {
    if (isRelativeImport(m[2])) deps.push(normaliseDep(m[2]));
  }

  // Side-effect import:  import './path'
  const sideEffect = /\bimport\s+(['"`])([^'"`\n]+)\1/g;
  while ((m = sideEffect.exec(source)) !== null) {
    if (isRelativeImport(m[2])) deps.push(normaliseDep(m[2]));
  }

  // require('./path') and import('./path')
  const requireOrDynamic = /\b(?:require|import)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;
  while ((m = requireOrDynamic.exec(source)) !== null) {
    if (isRelativeImport(m[2])) deps.push(normaliseDep(m[2]));
  }

  return dedupe(deps);
}

/**
 * Extract exported function/class/const signatures from TypeScript source.
 *
 * Handles:
 *  - `export function name(params): ReturnType`
 *  - `export async function name(params)`
 *  - `export class Name`
 *  - `export const name = ...`
 *  - `export let / export var`
 *  - `export default function name(params)`
 *  - `export default class Name`
 *  - `export type Name` / `export interface Name`
 */
function extractTypeScriptExports(source: string): string[] {
  const exports: string[] = [];

  // export [async] function name(params)
  const fnExport =
    /^[ \t]*export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)\s*(<[^>]*>)?\s*(\([^)]*\))/gm;
  let m: RegExpExecArray | null;
  while ((m = fnExport.exec(source)) !== null) {
    const name = m[1];
    const params = m[3]; // includes the parentheses
    exports.push(`${name}${params}`);
  }

  // export class Name
  const classExport = /^[ \t]*export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm;
  while ((m = classExport.exec(source)) !== null) {
    exports.push(m[1]);
  }

  // export const/let/var name = [async] (params): ReturnType => ...  (arrow function)
  const arrowNames = new Set<string>();
  const arrowExport =
    /^[ \t]*export\s+(?:const|let|var)\s+(\w+)(?:\s*:\s*[^=\n]+)?\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=\n]*)?\s*=>/gm;
  while ((m = arrowExport.exec(source)) !== null) {
    arrowNames.add(m[1]);
    exports.push(`${m[1]}(${m[2]})`);
  }

  // export const / let / var name  (plain value — skip names already captured as arrows)
  const constExport = /^[ \t]*export\s+(?:const|let|var)\s+(\w+)/gm;
  while ((m = constExport.exec(source)) !== null) {
    if (!arrowNames.has(m[1])) exports.push(m[1]);
  }

  // export type Name / export interface Name
  const typeExport = /^[ \t]*export\s+(?:type|interface)\s+(\w+)/gm;
  while ((m = typeExport.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Module Purpose Extraction
// ---------------------------------------------------------------------------

/**
 * Extract a one-line module purpose from TypeScript/JavaScript source.
 *
 * Priority order:
 *  1. First meaningful line of a leading JSDoc block (`/** ... *\/`)
 *  2. First meaningful line of a leading block comment (`/* ... *\/`)
 *  3. First meaningful line of a consecutive leading `//` comment block
 *
 * Returns null if no leading comment can be found.
 */
function extractTSModulePurpose(source: string): string | null {
  // JSDoc: /** ... */
  const jsdocMatch = /^\/\*\*([\s\S]*?)\*\//m.exec(source);
  if (jsdocMatch && source.trimStart().startsWith('/**')) {
    const lines = jsdocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@'));
    if (lines.length > 0) return lines[0];
  }

  // Block comment: /* ... */
  const blockMatch = /^\/\*([\s\S]*?)\*\//m.exec(source);
  if (blockMatch && source.trimStart().startsWith('/*') && !source.trimStart().startsWith('/**')) {
    const lines = blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Consecutive leading // comment lines
  const lineCommentMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)/.exec(source);
  if (lineCommentMatch) {
    const lines = lineCommentMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry Point Detection
// ---------------------------------------------------------------------------

const ENTRY_POINT_STEMS = new Set(['index', 'main', 'app', 'server', 'entry', 'bootstrap']);

/**
 * Determine if a TypeScript/JavaScript file is a program entry point.
 *
 * Checks:
 *  - Filename stem is a known entry point name (index, main, app, server, entry, bootstrap)
 *  - `export default function main()` pattern
 *  - Common server startup calls (app.listen, createServer, express())
 */
function isTSEntryPoint(source: string, filePath: string): boolean {
  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (ENTRY_POINT_STEMS.has(stem)) return true;

  if (/export\s+default\s+function\s+main\b/.test(source)) return true;
  if (/\bapp\.listen\s*\(/.test(source)) return true;
  if (/\bcreateServer\s*\(/.test(source)) return true;
  if (/\bexpress\s*\(\s*\)/.test(source)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const typescriptPlugin: LanguagePlugin = {
  extensions: ['.ts', '.tsx', '.js', '.mjs', '.jsx'],
  extractDeps: extractTypeScriptDeps,
  extractExports: extractTypeScriptExports,
  extractFunctionCode: extractTSFunctionCode,
  extractModulePurpose: extractTSModulePurpose,
  isEntryPoint: isTSEntryPoint,
};
