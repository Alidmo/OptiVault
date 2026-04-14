/**
 * Rust Language Plugin
 *
 * Extracts dependencies and exports from Rust source.
 * Handles: .rs
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
// External crate filter
// ---------------------------------------------------------------------------

/**
 * Well-known external Rust crates — kept here so common `use` statements
 * from these crates don't become graph nodes.
 *
 * Rust modules prefixed with `std::`, `core::`, `alloc::` are always external.
 * Everything else is project-internal unless it's in this set.
 */
const RUST_EXTERNAL_CRATES = new Set([
  // std / core / alloc (always external)
  'std', 'core', 'alloc', 'proc_macro', 'test',
  // Async runtimes
  'tokio', 'async_std', 'smol', 'futures', 'async_trait',
  // Web frameworks
  'actix_web', 'actix', 'axum', 'warp', 'rocket', 'tide', 'hyper', 'tower', 'tower_http',
  // Serialization
  'serde', 'serde_json', 'serde_yaml', 'toml', 'ron', 'bincode', 'postcard',
  // Error handling
  'anyhow', 'thiserror', 'eyre', 'color_eyre',
  // Logging / tracing
  'log', 'env_logger', 'tracing', 'tracing_subscriber',
  // CLI
  'clap', 'structopt', 'argh', 'pico_args',
  // Database
  'sqlx', 'diesel', 'sea_orm', 'rusqlite',
  // HTTP clients
  'reqwest', 'ureq', 'surf',
  // Crypto / hashing
  'sha2', 'md5', 'hmac', 'aes', 'rsa', 'ed25519_dalek', 'ring', 'rustls',
  // Utilities
  'rand', 'uuid', 'chrono', 'time', 'once_cell', 'lazy_static', 'regex',
  'itertools', 'rayon', 'crossbeam', 'parking_lot', 'dashmap',
  'bytes', 'byteorder', 'nom', 'pest', 'logos',
  // Config
  'config', 'dotenv', 'envy',
  // Testing
  'mockall', 'rstest', 'proptest', 'quickcheck',
  // gRPC / protobuf
  'tonic', 'prost',
  // Redis / messaging
  'redis', 'lapin', 'rdkafka',
  // Observability
  'prometheus', 'opentelemetry', 'metrics',
]);

function isExternalRustCrate(path: string): boolean {
  const root = path.split('::')[0];
  return RUST_EXTERNAL_CRATES.has(root ?? path);
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local `use` paths from Rust source.
 *
 * Handles:
 *  - `use crate::module::Type;`
 *  - `use super::module::Type;`
 *  - `use self::module::Type;`
 *  - `mod module;` (inline module declaration)
 *
 * External crates (in RUST_EXTERNAL_CRATES) are filtered out.
 * `crate::`, `super::`, `self::` paths are always project-local.
 */
function extractRustDeps(source: string): string[] {
  const deps: string[] = [];

  // use statements
  const usePat = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?use\s+([\w:{}*,\s]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = usePat.exec(source)) !== null) {
    const raw = m[1].trim();
    // Extract root path (before first ::)
    const root = raw.replace(/\{.*/, '').trim().split('::')[0] ?? raw;

    // Always include relative paths
    if (['crate', 'super', 'self'].includes(root)) {
      // Get the last meaningful segment
      const clean = raw.replace(/\{[^}]*\}/, '').replace(/::$/, '');
      const parts = clean.split('::');
      const dep = parts[parts.length - 1]?.trim();
      if (dep && dep !== 'crate' && dep !== 'super' && dep !== 'self') {
        deps.push(dep);
      }
    } else if (!isExternalRustCrate(root)) {
      const parts = root.split('::');
      deps.push(parts[parts.length - 1] ?? root);
    }
  }

  // mod declarations (pull in module files)
  const modPat = /^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm;
  while ((m = modPat.exec(source)) !== null) {
    deps.push(m[1]);
  }

  return dedupe(deps);
}

/**
 * Extract public items from Rust source.
 *
 * Captures:
 *  - `pub fn name(params)`
 *  - `pub async fn name(params)`
 *  - `pub struct Name`
 *  - `pub enum Name`
 *  - `pub trait Name`
 *  - `pub type Name`
 *  - `pub const NAME`
 *  - `pub static NAME`
 *  - `impl TraitName for StructName` / `impl StructName` (impl blocks, just the type name)
 */
function extractRustExports(source: string): string[] {
  const exports: string[] = [];

  // pub fn / pub async fn
  const fnPat = /^[ \t]*pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+(\w+)\s*(?:<[^>]*>)?\s*(\([^)]*\))/gm;
  let m: RegExpExecArray | null;
  while ((m = fnPat.exec(source)) !== null) {
    exports.push(`${m[1]}${m[2]}`);
  }

  // pub struct / enum / trait / type / const / static
  const typePat = /^[ \t]*pub(?:\([^)]*\))?\s+(?:unsafe\s+)?(?:struct|enum|trait|type|const|static)\s+(\w+)/gm;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

function extractRustFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  const pat = new RegExp(
    `^([ \\t]*)(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?fn\\s+${esc}\\b`,
    'm',
  );
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

function extractRustModulePurpose(source: string): string | null {
  // Inner doc comment (module-level): //! lines at top of file
  const innerDocMatch = /^((?:[ \t]*\/\/![^\n]*\n)+)/.exec(source);
  if (innerDocMatch) {
    const lines = innerDocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/!\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Outer doc comment: /// lines
  const outerDocMatch = /^((?:[ \t]*\/\/\/[^\n]*\n)+)/.exec(source);
  if (outerDocMatch) {
    const lines = outerDocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\/\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Leading // comment block
  const lineMatch = /^((?:[ \t]*\/\/[^/!][^\n]*\n)+)/.exec(source);
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

function isRustEntryPoint(source: string, filePath: string): boolean {
  // Canonical: fn main() at top level
  if (/^fn\s+main\s*\(\s*\)/m.test(source)) return true;
  if (/^(?:async\s+)?fn\s+main\s*\(\s*\)/m.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  // Cargo convention: src/main.rs and src/bin/*.rs are entry points
  if (stem === 'main') return true;
  if (filePath.replace(/\\/g, '/').includes('/bin/')) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const rustPlugin: LanguagePlugin = {
  extensions: ['.rs'],
  extractDeps: extractRustDeps,
  extractExports: extractRustExports,
  extractFunctionCode: extractRustFunctionCode,
  extractModulePurpose: extractRustModulePurpose,
  isEntryPoint: isRustEntryPoint,
};
