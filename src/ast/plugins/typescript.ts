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
 * Extract all import/require dependency names from TypeScript source text.
 *
 * Handles:
 *  - `import ... from 'module'`
 *  - `import 'module'` (side-effect import)
 *  - `require('module')`
 *  - `import('module')` (dynamic import)
 */
function extractTypeScriptDeps(source: string): string[] {
  const deps: string[] = [];

  // Static import:  import ... from 'path'
  const staticImport = /\bfrom\s+(['"`])([^'"`\n]+)\1/g;
  let m: RegExpExecArray | null;
  while ((m = staticImport.exec(source)) !== null) {
    deps.push(normaliseDep(m[2]));
  }

  // Side-effect import:  import 'path'
  const sideEffect = /\bimport\s+(['"`])([^'"`\n]+)\1/g;
  while ((m = sideEffect.exec(source)) !== null) {
    deps.push(normaliseDep(m[2]));
  }

  // require('path') and import('path')
  const requireOrDynamic = /\b(?:require|import)\s*\(\s*(['"`])([^'"`\n]+)\1\s*\)/g;
  while ((m = requireOrDynamic.exec(source)) !== null) {
    deps.push(normaliseDep(m[2]));
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

  // export const / let / var name
  const constExport = /^[ \t]*export\s+(?:const|let|var)\s+(\w+)/gm;
  while ((m = constExport.exec(source)) !== null) {
    exports.push(m[1]);
  }

  // export type Name / export interface Name
  const typeExport = /^[ \t]*export\s+(?:type|interface)\s+(\w+)/gm;
  while ((m = typeExport.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const typescriptPlugin: LanguagePlugin = {
  extensions: ['.ts', '.tsx', '.js', '.mjs', '.jsx'],
  extractDeps: extractTypeScriptDeps,
  extractExports: extractTypeScriptExports,
};
