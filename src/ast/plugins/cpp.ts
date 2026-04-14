/**
 * C / C++ Language Plugin
 *
 * Extracts dependencies and exports from C and C++ source.
 * Handles: .c, .cpp, .cc, .cxx, .h, .hpp, .hxx
 *
 * Design decisions:
 *  - Only quoted #include "file.hpp" become dep wikilinks (project-local).
 *    Angle-bracket #include <windows.h> are system/stdlib — always filtered.
 *  - Exports: top-level struct/class/enum/union/namespace names + free function
 *    signatures (no leading whitespace, so methods inside classes are excluded).
 *  - Entry point: presence of `int main(` or `void main(`.
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract local #include dependencies.
 * Only `#include "file.hpp"` (quoted) are kept — these reference project files.
 * `#include <header>` (angle-bracket) are system/stdlib and are dropped.
 */
function extractCppDeps(source: string): string[] {
  const deps: string[] = [];

  // #include "relative/path/file.hpp"
  const includePat = /^[ \t]*#[ \t]*include[ \t]+"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = includePat.exec(source)) !== null) {
    const raw = m[1];
    // Strip directory prefix and extension
    const parts = raw.replace(/\\/g, '/').split('/');
    const name = (parts[parts.length - 1] ?? raw).replace(/\.(h|hpp|hxx|h\+\+|hh)$/i, '');
    deps.push(name);
  }

  return dedupe(deps);
}

/**
 * Extract top-level type and function declarations from C/C++ source.
 *
 * Captures:
 *  - `struct Name`
 *  - `class Name`
 *  - `union Name`
 *  - `enum [class] Name`
 *  - `namespace Name` (C++)
 *  - Top-level free functions (no leading whitespace before return type)
 */
function extractCppExports(source: string): string[] {
  const exports: string[] = [];

  // Top-level type declarations
  const typePat = /^(?:struct|class|union|enum(?:\s+class)?|namespace)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  // Top-level free functions — line must start without whitespace,
  // have a return type, function name, and opening paren.
  // Excludes constructors (no return type) and lambdas.
  // Pattern: at column 0, word chars (return type), spaces, word (name), '('
  const funcPat = /^(?:(?:static|inline|extern|virtual|explicit|constexpr|consteval|constinit|[[nodiscard]]\s*)\s+)*(?:[\w:*&<>]+\s+)+(\w+)\s*\(([^)]*)\)/gm;
  while ((m = funcPat.exec(source)) !== null) {
    // Verify at column 0 (top-level)
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    if (m.index !== lineStart) continue;
    const name = m[1];
    // Skip keywords that look like function calls
    if (['if', 'for', 'while', 'switch', 'return', 'catch', 'else'].includes(name)) continue;
    exports.push(`${name}(${m[2]})`);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

function extractCppFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  // Match any line containing the function name followed by '('
  const pat = new RegExp(`^([ \\t]*)(?:[\\w:*&<>~]+\\s+)*${esc}\\s*\\(`, 'm');
  const m = pat.exec(source);
  if (!m) return null;

  const slice = source.slice(m.index);
  const braceIdx = slice.indexOf('{');
  if (braceIdx === -1) return null;

  let depth = 0;
  let end = -1;
  let inStr: '"' | "'" | null = null;
  for (let i = braceIdx; i < slice.length; i++) {
    const ch = slice[i];
    if (inStr) {
      if (ch === '\\') { i++; continue; }
      if (ch === inStr) inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      if (--depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  return slice.slice(0, end + 1).trim();
}

// ---------------------------------------------------------------------------
// Module Purpose Extraction
// ---------------------------------------------------------------------------

function extractCppModulePurpose(source: string): string | null {
  // Strip #pragma once / include guards before looking
  const stripped = source.replace(/^#pragma\s+once\s*\n?/m, '');

  // Doxygen/block comment: /** ... */ or /* ... */
  const docMatch = /^\/\*[\*!]?([\s\S]*?)\*\//m.exec(stripped);
  if (docMatch) {
    const lines = docMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*[\*!]?\s?/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@') && !l.startsWith('\\'));
    if (lines.length > 0) return lines[0];
  }

  // Leading // comment block
  const lineMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)/.exec(stripped);
  if (lineMatch) {
    const lines = lineMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\s?/, '').trim())
      // Skip pure-separator lines (only ─, -, =, *, _, or whitespace)
      .filter((l) => l.length > 0 && !/^[─\-=*_\s]+$/.test(l));
    if (lines.length > 0) return lines[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry Point Detection
// ---------------------------------------------------------------------------

function isCppEntryPoint(source: string, filePath: string): boolean {
  // Canonical C/C++ entry point
  if (/\bint\s+main\s*\(/.test(source)) return true;
  if (/\bvoid\s+main\s*\(/.test(source)) return true;
  // Windows WinMain
  if (/\bWinMain\s*\(/.test(source) || /\bwWinMain\s*\(/.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (['main', 'app', 'entry', 'bootstrap', 'launcher'].includes(stem)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const cppPlugin: LanguagePlugin = {
  extensions: ['.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx'],
  extractDeps: extractCppDeps,
  extractExports: extractCppExports,
  extractFunctionCode: extractCppFunctionCode,
  extractModulePurpose: extractCppModulePurpose,
  isEntryPoint: isCppEntryPoint,
};
