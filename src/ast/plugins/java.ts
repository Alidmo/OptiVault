/**
 * Java Language Plugin
 *
 * Extracts dependencies and exports from Java source.
 * Handles: .java
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
 * Top-level Java package prefixes that are always external (JDK, popular frameworks).
 * An import whose first package segment starts with one of these is excluded from
 * the dep graph so it doesn't create orphaned nodes in Obsidian.
 */
const JAVA_EXTERNAL_PREFIXES = new Set([
  // JDK
  'java', 'javax', 'jdk', 'sun', 'com.sun', 'org.ietf', 'org.omg', 'org.w3c', 'org.xml',
  // Testing
  'org.junit', 'org.mockito', 'org.hamcrest', 'org.assertj', 'org.testng',
  // Spring / Jakarta EE
  'org.springframework', 'jakarta', 'javax.persistence', 'org.hibernate',
  // Apache Commons / logging
  'org.apache', 'org.slf4j', 'ch.qos', 'log4j', 'org.log4j',
  // Google / Guava / GSON
  'com.google',
  // Jackson
  'com.fasterxml',
  // Lombok
  'lombok',
  // Kotlin (may appear in mixed projects)
  'kotlin', 'kotlinx',
  // Android
  'android', 'androidx',
  // Other popular libs
  'io.micronaut', 'io.quarkus', 'io.vertx',
  'reactor', 'io.reactivex',
  'okhttp3', 'retrofit2', 'com.squareup',
  'org.bouncycastle',
  'net.bytebuddy',
  'io.netty',
]);

function isExternalJavaImport(fqn: string): boolean {
  // Match against known external prefixes
  for (const prefix of JAVA_EXTERNAL_PREFIXES) {
    if (fqn === prefix || fqn.startsWith(prefix + '.')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local import dependency names from Java source.
 *
 * Only `import` statements whose package root is NOT in the external prefix list
 * are emitted — these are assumed to be project-internal classes.
 * Wildcard imports (`import com.example.util.*`) have the `.*` stripped.
 */
function extractJavaDeps(source: string): string[] {
  const deps: string[] = [];

  const importPat = /^[ \t]*import\s+(?:static\s+)?([\w.]+(?:\.\*)?)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = importPat.exec(source)) !== null) {
    let fqn = m[1].replace(/\.\*$/, ''); // strip wildcard
    if (isExternalJavaImport(fqn)) continue;

    // Use only the simple class name as the dep node name
    const parts = fqn.split('.');
    const dep = parts[parts.length - 1] ?? fqn;
    deps.push(dep);
  }

  return dedupe(deps);
}

/**
 * Extract top-level public class / interface / enum / record declarations.
 *
 * Handles:
 *  - `public class Foo`
 *  - `public interface Bar`
 *  - `public enum Status`
 *  - `public record Point(int x, int y)`
 *  - `public @interface MyAnnotation`
 */
function extractJavaExports(source: string): string[] {
  const exports: string[] = [];

  const typePat =
    /^[ \t]*(?:public\s+)?(?:(?:abstract|final|sealed|non-sealed)\s+)*(?:class|interface|enum|record|@interface)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

/**
 * Extract the source of a named method from Java source.
 *
 * Locates the method signature line and captures until the matching closing `}`.
 */
function extractJavaFunctionCode(source: string, functionName: string): string | null {
  const esc = functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(
    `^([ \\t]*)(?:(?:public|private|protected|static|final|synchronized|abstract|default|native|strictfp)\\s+)*[\\w<>\\[\\]]+\\s+${esc}\\s*\\(`,
    'm',
  );
  const m = pat.exec(source);
  if (!m) return null;

  // Find the opening brace on or after the match
  const slice = source.slice(m.index);
  const braceIdx = slice.indexOf('{');
  if (braceIdx === -1) return null;

  // Walk forward matching braces
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

/**
 * Extract a one-line module purpose from Java source.
 *
 * Priority:
 *  1. First meaningful line of a leading Javadoc block (`/** ... *\/`)
 *  2. First meaningful line of a leading block comment (`/* ... *\/`)
 *  3. First line of a leading `//` comment block
 */
function extractJavaModulePurpose(source: string): string | null {
  // Javadoc: /** ... */
  const javadocMatch = /^\/\*\*([\s\S]*?)\*\//m.exec(source);
  if (javadocMatch && source.trimStart().startsWith('/**')) {
    const lines = javadocMatch[1]
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

const JAVA_ENTRY_STEMS = new Set(['main', 'app', 'application', 'server', 'bootstrap', 'launcher', 'startup']);

/**
 * Determine if a Java file is a program entry point.
 *
 * Checks:
 *  - Presence of `public static void main(String` signature
 *  - `@SpringBootApplication` annotation
 *  - Filename stem matches common entry point names
 */
function isJavaEntryPoint(source: string, filePath: string): boolean {
  if (/public\s+static\s+void\s+main\s*\(\s*String/.test(source)) return true;
  if (/@SpringBootApplication/.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (JAVA_ENTRY_STEMS.has(stem)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const javaPlugin: LanguagePlugin = {
  extensions: ['.java'],
  extractDeps: extractJavaDeps,
  extractExports: extractJavaExports,
  extractFunctionCode: extractJavaFunctionCode,
  extractModulePurpose: extractJavaModulePurpose,
  isEntryPoint: isJavaEntryPoint,
};
