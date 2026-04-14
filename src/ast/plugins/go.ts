/**
 * Go Language Plugin
 *
 * Extracts dependencies and exports from Go source.
 * Handles: .go
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
// External package filter
// ---------------------------------------------------------------------------

/**
 * Go standard library packages and well-known external modules.
 * Go module paths are used as import paths — stdlib packages have no dot in
 * the first path component (e.g. "fmt", "net/http", "encoding/json").
 * Third-party modules have a domain prefix (e.g. "github.com/...").
 *
 * Strategy: a path is external if:
 *  1. Its first segment contains no dot (stdlib), OR
 *  2. Its first segment is a known external domain.
 */
const GO_EXTERNAL_DOMAINS = new Set([
  'github.com',
  'golang.org',
  'google.golang.org',
  'gopkg.in',
  'go.uber.org',
  'go.opencensus.io',
  'go.opentelemetry.io',
  'cloud.google.com',
  'k8s.io',
  'sigs.k8s.io',
  'istio.io',
  'github.com/stretchr',
  'github.com/gin-gonic',
  'github.com/gorilla',
  'github.com/labstack',
  'github.com/gofiber',
  'github.com/spf13',
  'github.com/pkg',
  'github.com/sirupsen',
  'github.com/rs',
  'github.com/go-chi',
  'github.com/go-redis',
  'github.com/olivere',
  'github.com/jmoiron',
  'github.com/lib',
  'github.com/mattn',
  'gorm.io',
  'entgo.io',
  'buf.build',
  'connectrpc.com',
  'filippo.io',
]);

function isExternalGoImport(importPath: string): boolean {
  const clean = importPath.replace(/^"|"$/g, '');
  const firstSegment = clean.split('/')[0] ?? clean;

  // Stdlib: first segment has no dot
  if (!firstSegment.includes('.')) return true;

  // Known external domain
  for (const domain of GO_EXTERNAL_DOMAINS) {
    if (clean === domain || clean.startsWith(domain + '/')) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local import paths from Go source.
 *
 * Handles:
 *  - `import "path"`
 *  - `import ( "path1" \n "path2" )`
 *  - Named imports: `import alias "path"`
 *
 * Only imports whose path contains a dot in the first segment AND are not
 * known external domains are kept (i.e. project-internal module paths).
 */
function extractGoDeps(source: string): string[] {
  const deps: string[] = [];
  const rawPaths: string[] = [];

  // Single-line import
  const singleImport = /^[ \t]*import\s+"([^"]+)"/gm;
  let m: RegExpExecArray | null;
  while ((m = singleImport.exec(source)) !== null) {
    rawPaths.push(m[1]);
  }

  // Block import: import ( ... )
  const blockImport = /\bimport\s*\(([\s\S]*?)\)/g;
  while ((m = blockImport.exec(source)) !== null) {
    const block = m[1];
    const linePat = /"([^"]+)"/g;
    let lm: RegExpExecArray | null;
    while ((lm = linePat.exec(block)) !== null) {
      rawPaths.push(lm[1]);
    }
  }

  for (const path of rawPaths) {
    if (isExternalGoImport(path)) continue;
    // Use only the last path segment as the dep node name
    const parts = path.split('/');
    const dep = parts[parts.length - 1] ?? path;
    deps.push(dep);
  }

  return dedupe(deps);
}

/**
 * Extract exported identifiers from Go source.
 *
 * In Go, exported = starts with an uppercase letter. Captures:
 *  - `func Name(params) ReturnType`
 *  - `func (recv) Name(params)` (method on receiver)
 *  - `type Name struct`
 *  - `type Name interface`
 *  - `type Name` (type alias / typedef)
 *  - `const Name` / `var Name` (exported package-level decls)
 */
function extractGoExports(source: string): string[] {
  const exports: string[] = [];

  // Functions and methods: func [(*RecvType)] ExportedName(params)
  const funcPat = /^func\s+(?:\([^)]*\)\s+)?([A-Z]\w*)\s*(\([^)]*\))/gm;
  let m: RegExpExecArray | null;
  while ((m = funcPat.exec(source)) !== null) {
    exports.push(`${m[1]}${m[2]}`);
  }

  // Type declarations
  const typePat = /^type\s+([A-Z]\w*)\s+(?:struct|interface|\w)/gm;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  // Package-level const / var (single-line)
  const constVarPat = /^(?:const|var)\s+([A-Z]\w*)\b/gm;
  while ((m = constVarPat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

function extractGoFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  const pat = new RegExp(`^func\\s+(?:\\([^)]*\\)\\s+)?${esc}\\s*\\(`, 'm');
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

function extractGoModulePurpose(source: string): string | null {
  // Package-level doc comment: consecutive // lines immediately before `package`
  // Strip build tags first
  const stripped = source.replace(/^\/\/go:build[^\n]*\n/gm, '').replace(/^\/\/ \+build[^\n]*\n/gm, '');

  // Leading comment block (before package declaration)
  const docMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)[ \t]*package\s/m.exec(stripped);
  if (docMatch) {
    const lines = docMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Block comment before package: /* ... */
  const blockMatch = /^[ \t]*\/\*([\s\S]*?)\*\/\s*\n[ \t]*package\s/m.exec(stripped);
  if (blockMatch) {
    const lines = blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry Point Detection
// ---------------------------------------------------------------------------

function isGoEntryPoint(source: string, filePath: string): boolean {
  // Go entry point: func main() in package main
  if (/^package\s+main\b/m.test(source) && /^func\s+main\s*\(\s*\)/m.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (['main', 'cmd', 'app', 'server'].includes(stem)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const goPlugin: LanguagePlugin = {
  extensions: ['.go'],
  extractDeps: extractGoDeps,
  extractExports: extractGoExports,
  extractFunctionCode: extractGoFunctionCode,
  extractModulePurpose: extractGoModulePurpose,
  isEntryPoint: isGoEntryPoint,
};
