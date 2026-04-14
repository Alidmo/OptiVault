/**
 * PHP Language Plugin
 *
 * Extracts dependencies and exports from PHP source.
 * Handles: .php
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

// ---------------------------------------------------------------------------
// External namespace filter
// ---------------------------------------------------------------------------

/**
 * Root PHP namespaces that are framework/stdlib — excluded from the dep graph.
 */
const PHP_EXTERNAL_PREFIXES = new Set([
  // PHP global / built-in (no namespace)
  // Symfony
  'Symfony',
  // Laravel / Illuminate
  'Illuminate', 'Laravel',
  // Doctrine
  'Doctrine',
  // Composer standard interfaces
  'Psr', 'Psr\\Log', 'Psr\\Http', 'Psr\\Container', 'Psr\\Cache',
  // PHPUnit
  'PHPUnit',
  // Carbon (datetime)
  'Carbon',
  // GuzzleHttp
  'GuzzleHttp',
  // Monolog
  'Monolog',
  // Twig
  'Twig',
  // Lumen / Slim
  'Slim',
  // WordPress (common theme/plugin dev)
  'WP',
  // Yii
  'yii',
  // Zend / Laminas
  'Zend', 'Laminas',
  // Propel
  'Propel',
  // Codeception
  'Codeception',
  // PHP CodeSniffer / PHPStan
  'PHP_CodeSniffer', 'PHPStan',
  // Phalcon
  'Phalcon',
]);

function isExternalPhpNamespace(ns: string): boolean {
  const root = ns.split('\\')[0];
  return PHP_EXTERNAL_PREFIXES.has(root ?? ns);
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local `use` statements from PHP source.
 *
 * Handles:
 *  - `use Foo\Bar\Baz;`
 *  - `use Foo\Bar\Baz as Alias;`
 *  - `use Foo\Bar\{ ClassA, ClassB };`
 *  - `require`/`require_once`/`include`/`include_once` with relative paths
 */
function extractPhpDeps(source: string): string[] {
  const deps: string[] = [];

  // use statements
  const usePat = /^[ \t]*use\s+([\w\\]+(?:\s*,\s*[\w\\]+)*)\s*(?:as\s+\w+)?\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = usePat.exec(source)) !== null) {
    // May be comma-separated
    const parts = m[1].split(',');
    for (const part of parts) {
      const ns = part.trim().split(/\s+as\s+/i)[0].trim();
      if (isExternalPhpNamespace(ns)) continue;
      // Use the last namespace segment as the dep node name
      const segments = ns.split('\\');
      const dep = segments[segments.length - 1] ?? ns;
      deps.push(dep);
    }
  }

  // use with group syntax: use App\Models\{ User, Post };
  const groupUsePat = /^[ \t]*use\s+([\w\\]+)\\\{\s*([^}]+)\}\s*;/gm;
  while ((m = groupUsePat.exec(source)) !== null) {
    const base = m[1];
    if (isExternalPhpNamespace(base)) continue;
    const names = m[2].split(',').map((n) => n.trim().split(/\s+as\s+/i)[0].trim());
    for (const name of names) {
      if (name) deps.push(name);
    }
  }

  // require/include with relative paths
  const requirePat =
    /\b(?:require|require_once|include|include_once)\s*\(?\s*(['"])([^'"]+)\1\s*\)?/g;
  while ((m = requirePat.exec(source)) !== null) {
    const path = m[2];
    if (path.startsWith('./') || path.startsWith('../')) {
      // Strip path prefix and extension
      const parts = path.replace(/^(?:\.\.\/|\.\/)+/, '').split('/');
      const name = (parts[parts.length - 1] ?? path).replace(/\.php$/, '');
      deps.push(name);
    }
  }

  return dedupe(deps);
}

/**
 * Extract top-level class / interface / trait / enum declarations from PHP source.
 */
function extractPhpExports(source: string): string[] {
  const exports: string[] = [];

  const typePat =
    /^[ \t]*(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  // Top-level functions (outside class, at zero indentation)
  const funcPat = /^(?:function)\s+(\w+)\s*\(/gm;
  while ((m = funcPat.exec(source)) !== null) {
    exports.push(`${m[1]}()`);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

function extractPhpFunctionCode(source: string, functionName: string): string | null {
  const esc = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(
    `^([ \\t]*)(?:(?:public|private|protected|static|abstract|final)\\s+)*function\\s+${esc}\\s*\\(`,
    'm',
  );
  const m = pat.exec(source);
  if (!m) return null;

  const slice = source.slice(m.index);
  const braceIdx = slice.indexOf('{');
  if (braceIdx === -1) return null;

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

function extractPhpModulePurpose(source: string): string | null {
  // Strip <?php opening tag before looking for comments
  const stripped = source.replace(/^<\?php\s*/i, '');

  // PHPDoc: /** ... */
  const docMatch = /^\/\*\*([\s\S]*?)\*\//m.exec(stripped);
  if (docMatch && stripped.trimStart().startsWith('/**')) {
    const lines = docMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0 && !l.startsWith('@'));
    if (lines.length > 0) return lines[0];
  }

  // Block comment
  const blockMatch = /^\/\*([\s\S]*?)\*\//m.exec(stripped);
  if (blockMatch && stripped.trimStart().startsWith('/*') && !stripped.trimStart().startsWith('/**')) {
    const lines = blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Leading // comment block
  const lineMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)/.exec(stripped);
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

const PHP_ENTRY_STEMS = new Set(['index', 'app', 'bootstrap', 'server', 'public', 'api', 'main']);

function isPhpEntryPoint(source: string, filePath: string): boolean {
  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (PHP_ENTRY_STEMS.has(stem)) return true;

  // Common front-controller / Laravel artisan patterns
  if (/\$app\s*=\s*(?:new\s+)?\w+\s*\(/.test(source) && /\$app->run\(/.test(source)) return true;
  if (/\$kernel\s*=\s*\$app->make\(/.test(source)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const phpPlugin: LanguagePlugin = {
  extensions: ['.php'],
  extractDeps: extractPhpDeps,
  extractExports: extractPhpExports,
  extractFunctionCode: extractPhpFunctionCode,
  extractModulePurpose: extractPhpModulePurpose,
  isEntryPoint: isPhpEntryPoint,
};
