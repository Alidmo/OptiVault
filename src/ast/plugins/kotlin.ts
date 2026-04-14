/**
 * Kotlin Language Plugin
 *
 * Extracts dependencies and exports from Kotlin source.
 * Handles: .kt, .kts
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// External package filter
// ---------------------------------------------------------------------------

/**
 * Top-level package prefixes that are external in Kotlin projects.
 * Imports whose root package matches are excluded from the dep graph.
 */
const KOTLIN_EXTERNAL_PREFIXES = new Set([
  // Kotlin stdlib / runtime
  'kotlin', 'kotlinx',
  // JDK
  'java', 'javax', 'jdk', 'sun',
  // Android / AndroidX
  'android', 'androidx',
  // Spring
  'org.springframework',
  // Ktor
  'io.ktor',
  // Coroutines (part of kotlinx, already covered)
  // Testing
  'org.junit', 'org.mockito', 'org.hamcrest', 'org.assertj', 'io.mockk',
  // Apache / logging
  'org.apache', 'org.slf4j', 'ch.qos',
  // Google
  'com.google',
  // Jackson
  'com.fasterxml',
  // Retrofit / OkHttp
  'retrofit2', 'okhttp3', 'com.squareup',
  // Exposed (JetBrains SQL)
  'org.jetbrains.exposed',
  // Other JetBrains
  'org.jetbrains',
  // Dagger / Hilt
  'dagger', 'javax.inject',
  // Serialization
  'kotlinx.serialization',
]);

function isExternalKotlinImport(fqn: string): boolean {
  for (const prefix of KOTLIN_EXTERNAL_PREFIXES) {
    if (fqn === prefix || fqn.startsWith(prefix + '.')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local import dependency names from Kotlin source.
 *
 * Only imports whose package root is NOT in the external prefix list are emitted.
 */
function extractKotlinDeps(source: string): string[] {
  const deps: string[] = [];

  // import com.example.foo.Bar  or  import com.example.foo.*
  const importPat = /^[ \t]*import\s+([\w.]+(?:\.\*)?)/gm;
  let m: RegExpExecArray | null;
  while ((m = importPat.exec(source)) !== null) {
    const fqn = m[1].replace(/\.\*$/, '');
    if (isExternalKotlinImport(fqn)) continue;

    // Use the simple class/object name as the dep node
    const parts = fqn.split('.');
    const dep = parts[parts.length - 1] ?? fqn;
    deps.push(dep);
  }

  return dedupe(deps);
}

/**
 * Extract top-level class / object / interface / fun declarations from Kotlin source.
 *
 * Handles:
 *  - `class Foo` / `data class Foo` / `sealed class Foo` / `abstract class Foo`
 *  - `object Bar` / `companion object`
 *  - `interface Baz`
 *  - `fun topLevelFunction(params)`  (top-level, no indentation)
 *  - `enum class Status`
 *  - `annotation class MyAnnotation`
 */
function extractKotlinExports(source: string): string[] {
  const exports: string[] = [];

  // Top-level type declarations (class, object, interface, enum class, annotation class)
  const typePat =
    /^(?:(?:public|internal|private|protected|open|abstract|sealed|data|value|inner|inline|fun|external|expect|actual)\s+)*(?:class|object|interface|enum\s+class|annotation\s+class)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  // Top-level fun declarations (zero indentation)
  const funPat = /^(?:(?:public|internal|private|protected|inline|suspend|tailrec|operator|infix|external|expect|actual)\s+)*fun\s+(?:<[^>]*>\s+)?(\w+)\s*(\([^)]*\))/gm;
  while ((m = funPat.exec(source)) !== null) {
    // Verify top-level (no leading whitespace before the first modifier/fun)
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const indent = m.index - lineStart;
    if (indent === 0) {
      exports.push(`${m[1]}${m[2]}`);
    }
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

function extractKotlinFunctionCode(source: string, functionName: string): string | null {
  const esc = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(
    `^([ \\t]*)(?:(?:public|internal|private|protected|inline|suspend|override|tailrec|operator|infix)\\s+)*fun\\s+(?:<[^>]*>\\s+)?${esc}\\s*\\(`,
    'm',
  );
  const m = pat.exec(source);
  if (!m) return null;

  const slice = source.slice(m.index);
  const braceIdx = slice.indexOf('{');
  if (braceIdx === -1) {
    // Expression body: fun foo() = expr
    const eqIdx = slice.indexOf('=');
    if (eqIdx === -1) return null;
    const nl = slice.indexOf('\n', eqIdx);
    return slice.slice(0, nl === -1 ? undefined : nl).trim();
  }

  let depth = 0;
  let end = -1;
  for (let i = braceIdx; i < slice.length; i++) {
    if (slice[i] === '{') depth++;
    else if (slice[i] === '}') {
      if (--depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  return slice.slice(0, end + 1).trim();
}

// ---------------------------------------------------------------------------
// Module Purpose Extraction
// ---------------------------------------------------------------------------

function extractKotlinModulePurpose(source: string): string | null {
  // KDoc: /** ... */
  const kdocMatch = /^\/\*\*([\s\S]*?)\*\//m.exec(source);
  if (kdocMatch && source.trimStart().startsWith('/**')) {
    const lines = kdocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@'));
    if (lines.length > 0) return lines[0];
  }

  // Block comment
  const blockMatch = /^\/\*([\s\S]*?)\*\//m.exec(source);
  if (blockMatch && source.trimStart().startsWith('/*') && !source.trimStart().startsWith('/**')) {
    const lines = blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Leading // comment block
  const lineMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)/.exec(source);
  if (lineMatch) {
    const lines = lineMatch[1]
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

const KOTLIN_ENTRY_STEMS = new Set(['main', 'app', 'application', 'server', 'bootstrap', 'launcher']);

function isKotlinEntryPoint(source: string, filePath: string): boolean {
  // fun main() or fun main(args: Array<String>)
  if (/^fun\s+main\s*\(/m.test(source)) return true;
  if (/@SpringBootApplication/.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (KOTLIN_ENTRY_STEMS.has(stem)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const kotlinPlugin: LanguagePlugin = {
  extensions: ['.kt', '.kts'],
  extractDeps: extractKotlinDeps,
  extractExports: extractKotlinExports,
  extractFunctionCode: extractKotlinFunctionCode,
  extractModulePurpose: extractKotlinModulePurpose,
  isEntryPoint: isKotlinEntryPoint,
};
