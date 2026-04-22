// Vault Writer
// Responsibilities: recursive scan, pipeline, write vault dir, _RepoMap.md

import { readdir, mkdir, writeFile, readFile, stat, rename } from 'fs/promises';
import { join, relative, dirname, basename, normalize } from 'path';
import { parseFile } from '../ast/parser.js';
import type { ParseResult } from '../ast/parser.js';
import { formatVaultNote } from '../compression/formatter.js';
import { LEGACY_VAULT_DIR, IGNORED_DIRECTORIES } from '../config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set([
  // TypeScript / JavaScript
  '.ts', '.tsx', '.js', '.mjs', '.jsx',
  // Python
  '.py',
  // JVM
  '.java', '.kt', '.kts',
  // PHP
  '.php',
  // C / C++
  '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hxx',
  // C#
  '.cs',
  // Go
  '.go',
  // Rust
  '.rs',
]);

/**
 * Directory names that are always skipped during walks.
 * The active vault directory is added dynamically at call time.
 */
const BASE_SKIP_DIRS = new Set(IGNORED_DIRECTORIES);

/** Sentinel embedded in CLAUDE.md to detect an already-patched file. */
const CLAUDE_MD_MARKER = '<!-- optivault-protocol -->';

// ---------------------------------------------------------------------------
// walkDir — recursively yield source file paths
// ---------------------------------------------------------------------------

/**
 * Recursively collect all supported source files under `dir`.
 *
 * @param dir          Root directory to walk.
 * @param extraSkipDirs Additional directory names to skip (e.g. the vault dir).
 */
export async function walkDir(
  dir: string,
  extraSkipDirs: ReadonlySet<string> = new Set()
): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (BASE_SKIP_DIRS.has(entry.name) || extraSkipDirs.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkDir(fullPath, extraSkipDirs);
      results.push(...nested);
    } else if (entry.isFile()) {
      const dotIndex = entry.name.lastIndexOf('.');
      if (dotIndex !== -1) {
        const ext = entry.name.slice(dotIndex);
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          results.push(fullPath);
        }
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// processFile — parse and format for one file
// ---------------------------------------------------------------------------

export async function processFile(filePath: string): Promise<{
  parsed: ParseResult;
  content: string;
}> {
  const parsed = await parseFile(filePath);
  const content = formatVaultNote(parsed);
  return { parsed, content };
}

// ---------------------------------------------------------------------------
// toRelativeForwardSlash
// ---------------------------------------------------------------------------

function toRelativeForwardSlash(filePath: string, baseDir: string): string {
  return relative(baseDir, filePath).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// writeRepoMap — write _RepoMap.md from all ParseResults
// ---------------------------------------------------------------------------

export async function writeRepoMap(
  outputDir: string,
  allParsed: ParseResult[],
  baseDir: string
): Promise<void> {
  const lines: string[] = ['# RepoMap', ''];

  for (const parsed of allParsed) {
    const rel = toRelativeForwardSlash(parsed.filePath, baseDir);
    const wikiTarget = rel.replace(/\.[^/.]+$/, '');

    const parts: string[] = [];
    if (parsed.exports.length > 0) {
      parts.push(`exports: ${parsed.exports.join(', ')}`);
    }
    if (parsed.deps.length > 0) {
      parts.push(`deps: ${parsed.deps.join(', ')}`);
    }

    lines.push(
      parts.length > 0
        ? `- [[${wikiTarget}]] — ${parts.join(' — ')}`
        : `- [[${wikiTarget}]]`
    );
  }

  const repoMapPath = join(outputDir, '_RepoMap.md');
  await writeFile(repoMapPath, lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// readExistingConcepts — parse `concepts: [A, B]` from a vault note's frontmatter
// ---------------------------------------------------------------------------

/**
 * Read an existing vault note and return the `concepts:` array from its YAML
 * frontmatter. Returns `[]` if the file is missing, has no frontmatter, or no
 * concepts line. Accepts both bare (`[Auth, Checkout]`) and quoted
 * (`["Auth", "Checkout"]`) forms.
 */
export async function readExistingConcepts(notePath: string): Promise<string[]> {
  let raw: string | undefined;
  try {
    const result = await readFile(notePath, 'utf8');
    raw = typeof result === 'string' ? result : undefined;
  } catch {
    return [];
  }
  if (!raw) return [];

  const lines = raw.split('\n');
  let inFrontmatter = false;

  for (const line of lines) {
    if (line.trim() === '---') {
      if (!inFrontmatter) { inFrontmatter = true; continue; }
      else break; // closing frontmatter
    }
    if (!inFrontmatter) continue;

    const m = line.match(/^concepts:\s*\[([^\]]*)\]\s*$/);
    if (m) {
      const inner = m[1].trim();
      if (!inner) return [];
      return inner
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, '').trim())
        .filter((s) => s.length > 0);
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// readVaultNote — reconstruct a ParseResult from an existing vault note
// ---------------------------------------------------------------------------

async function readVaultNote(notePath: string, fallbackFilePath: string): Promise<ParseResult | null> {
  let raw: string | undefined;
  try {
    const result = await readFile(notePath, 'utf8');
    raw = typeof result === 'string' ? result : undefined;
  } catch {
    return null;
  }
  if (!raw) return null;

  const lines = raw.split('\n');
  let filePath = fallbackFilePath;
  const deps: string[] = [];
  const exports: string[] = [];
  const concepts: string[] = [];

  let inFrontmatter = false;
  let frontmatterClosed = false;
  let inOutputs = false;

  for (const line of lines) {
    if (!frontmatterClosed) {
      if (line.trim() === '---') {
        if (!inFrontmatter) { inFrontmatter = true; continue; }
        else { frontmatterClosed = true; continue; }
      }
      if (inFrontmatter) {
        if (line.startsWith('tgt:')) {
          filePath = line.slice(4).trim();
        } else if (line.startsWith('dep:')) {
          for (const m of line.slice(4).matchAll(/\[\[([^\]]+)\]\]/g)) {
            deps.push(m[1]);
          }
        } else {
          const cm = line.match(/^concepts:\s*\[([^\]]*)\]\s*$/);
          if (cm) {
            const inner = cm[1].trim();
            if (inner) {
              for (const s of inner.split(',')) {
                const cleaned = s.trim().replace(/^["']|["']$/g, '').trim();
                if (cleaned) concepts.push(cleaned);
              }
            }
          }
        }
      }
    } else {
      const trimmed = line.trim();
      // Handle both legacy (## Signatures) and current (## Outputs) section headers
      if (trimmed === '## Outputs' || trimmed === '## Signatures') {
        inOutputs = true;
        continue;
      }
      // Any other ## heading ends the outputs section
      if (trimmed.startsWith('## ')) { inOutputs = false; continue; }

      if (inOutputs) {
        // Current format: Provides:: `signature`
        let m = line.match(/^Provides:: `(.+)`$/);
        if (m) { exports.push(m[1]); continue; }
        // Legacy format: - `signature`
        m = line.match(/^- `(.+)`$/);
        if (m) { exports.push(m[1]); continue; }
      }
    }
  }

  return {
    filePath,
    deps,
    exports,
    ...(concepts.length > 0 ? { concepts } : {}),
  };
}

// ---------------------------------------------------------------------------
// generateClaudeMd — create or patch CLAUDE.md with the OptiVault protocol
// ---------------------------------------------------------------------------

/**
 * Ensure `CLAUDE.md` in `dir` contains the OptiVault protocol block.
 * Creates the file if absent, appends to it if the marker is missing,
 * and is a silent no-op when the marker is already present.
 *
 * @param dir      Project root directory.
 * @param vaultDir Vault directory name to reference in the protocol.
 */
export async function generateClaudeMd(dir: string, vaultDir: string): Promise<void> {
  const claudePath = join(dir, 'CLAUDE.md');

  const protocol = `${CLAUDE_MD_MARKER}
# OptiVault Protocol Active
This repository uses OptiVault for AST-compressed context.
Shadow vault: \`${vaultDir}/\`

## Senior Agent Navigation Protocol

Exploration is done through the dependency graph, not the filesystem. Six MCP tools are available: \`read_repo_map\`, \`query_graph\`, \`read_file_skeleton\`, \`read_function_code\`, \`read_tests_for_file\`, \`sync_file_context\`.

### Banned Behaviors
- Using \`cat\`, \`grep\`, \`head\`, \`tail\`, or the Claude Code \`Read\` tool as the first step of exploration.
- Opening a file to "see what's in it" before querying the graph.
- Guessing at dependencies, call sites, or architecture instead of querying.
- Any full-file read when a skeleton or graph query would answer the same question.

### Mandatory Navigation Loop
1. **\`read_repo_map\`** — call once per session if you do not yet have a top-level picture. Skip on subsequent turns.
2. **\`query_graph\`** — *primary wayfinding*. Ask "what does X depend on?" or "what calls into X?" with \`relation: dependencies | callers\` and \`depth: 1–3\`. Use this BEFORE touching any file.
3. **\`read_file_skeleton\`** — once \`query_graph\` has narrowed the target set, confirm exported signatures and deps for the specific file.
4. **\`read_function_code\`** — surgical. One function at a time. Only when you already know the exact function name.
5. **\`read_tests_for_file\`** — before writing a change, to understand the contract you must not break.
6. **Write** the surgical edit.
7. **\`sync_file_context\`** — MANDATORY immediately after every write, to keep the AST graph current.

## Core Behavioral Principles (Karpathy Protocol)

### 1. Think Before Coding
Read the shadow context first. Query the graph, then read skeletons, then read function bodies. Never form an opinion about the codebase until you have traversed it.

### 2. Simplicity First
Write the minimum code that satisfies the requirement. No premature abstractions, no speculative features. If a helper is not used in two places, it should not exist.

### 3. Surgical Changes
Target the exact function or module that needs to change. Never rewrite a 500-line file when a 5-line surgical edit solves the problem. Touch only what you must.

### 4. Goal-Driven Execution
Every change must be verifiable. Before writing code, state the goal and the test that will confirm success. After writing, run the tests. If the tests do not pass, do not move on.

## Concepts Frontmatter

Vault notes may be manually annotated with a \`concepts: [Auth, Checkout, ...]\` list in their YAML frontmatter. OptiVault preserves these annotations across re-syncs (both \`init\` and \`sync_file_context\`), so collaborators can tag files with domain concepts without those tags being overwritten when the AST is re-indexed.

## Output Compression (Caveman Protocol)
- Respond with minimum tokens. No filler. State facts only.
- Do not explain what you are about to do. Do it.
- After a change, confirm: file changed, tests status, sync done. Nothing else.

**PENALTY:** Explicitly penalised for using \`cat\`, full-file \`Read\`, or \`grep\` for exploration when \`query_graph\` or \`read_file_skeleton\` would answer the same question. Use the graph, not brute force.`;

  let existing: string | null = null;
  try {
    const raw = await readFile(claudePath, 'utf8');
    existing = typeof raw === 'string' ? raw : null;
  } catch {
    existing = null;
  }

  if (existing === null) {
    await writeFile(claudePath, protocol + '\n', 'utf8');
    console.log('[optivault] Created CLAUDE.md with OptiVault protocol.');
  } else if (!existing.includes(CLAUDE_MD_MARKER)) {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await writeFile(claudePath, existing + separator + protocol + '\n', 'utf8');
    console.log('[optivault] Appended OptiVault protocol to existing CLAUDE.md.');
  }
  // Marker already present — no-op (silent).
}

// ---------------------------------------------------------------------------
// migrateLegacyVault — rename .optivault → new vault dir if legacy exists
// ---------------------------------------------------------------------------

/**
 * One-time migration from the legacy `.optivault` directory to the configured
 * vault directory name. Safe to call on every startup — does nothing when:
 *  - The legacy directory does not exist.
 *  - The target directory already exists (won't overwrite).
 *  - The target IS the legacy directory (no rename needed).
 *
 * @param projectDir      Absolute path to the project root.
 * @param resolvedOutputDir Absolute path to the desired vault directory.
 */
export async function migrateLegacyVault(
  projectDir: string,
  resolvedOutputDir: string
): Promise<void> {
  const legacyPath = join(projectDir, LEGACY_VAULT_DIR);

  // Nothing to migrate if paths are identical (normalize handles cross-platform slashes)
  if (normalize(legacyPath) === normalize(resolvedOutputDir)) return;

  // Check if legacy vault exists
  try {
    await stat(legacyPath);
  } catch {
    return; // no legacy vault — nothing to do
  }

  // Don't overwrite an existing target
  try {
    await stat(resolvedOutputDir);
    console.warn(
      `[optivault] Warning: both ${LEGACY_VAULT_DIR} and ${basename(resolvedOutputDir)} exist — skipping migration to avoid data loss.`
    );
    return;
  } catch {
    // Target doesn't exist — safe to rename
  }

  await rename(legacyPath, resolvedOutputDir);
  console.log(
    `[optivault] Migrated ${LEGACY_VAULT_DIR} → ${basename(resolvedOutputDir)}`
  );
}

// ---------------------------------------------------------------------------
// runInit — main entry point
// ---------------------------------------------------------------------------

export async function runInit(dir: string, outputDir: string): Promise<void> {
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  // Scaffold the concepts/ dir for future self-learning (empty is fine)
  await mkdir(join(outputDir, 'concepts'), { recursive: true });

  const vaultDirName = basename(outputDir);
  const files = await walkDir(dir, new Set([vaultDirName]));
  const allParsed: ParseResult[] = [];
  let skipped = 0;

  for (const filePath of files) {
    const rel = toRelativeForwardSlash(filePath, dir);
    const notePath = join(outputDir, rel + '.md');

    // ------------------------------------------------------------------
    // Idempotent skip: if the existing vault note is at least as new as
    // the source file, reconstruct ParseResult from the cached note.
    // ------------------------------------------------------------------
    let shouldSkip = false;
    try {
      const [srcStat, noteStat] = await Promise.all([stat(filePath), stat(notePath)]);
      shouldSkip = noteStat.mtimeMs >= srcStat.mtimeMs;
    } catch {
      // note doesn't exist or stat failed → must (re)parse
    }

    if (shouldSkip) {
      const cached = await readVaultNote(notePath, filePath);
      if (cached) {
        allParsed.push(cached);
        skipped++;
        continue;
      }
      // Vault note unreadable despite existing — fall through to re-parse
    }

    console.log(`[optivault] Processing ${rel}...`);

    let parsed: ParseResult;
    let content: string;
    try {
      parsed = await parseFile(filePath);
      // Merge forward any pre-existing concepts from the vault note
      const existingConcepts = await readExistingConcepts(notePath);
      if (existingConcepts.length > 0) {
        parsed.concepts = existingConcepts;
      }
      content = formatVaultNote(parsed);
    } catch (err) {
      console.warn(`[optivault] Warning: skipping ${rel} — ${(err as Error).message}`);
      continue;
    }

    allParsed.push(parsed);

    const noteDir = dirname(notePath);
    await mkdir(noteDir, { recursive: true });
    await writeFile(notePath, content, 'utf8');
  }

  // Write the master index
  await writeRepoMap(outputDir, allParsed, dir);

  const processed = files.length - skipped;
  console.log(
    `[optivault] Done. Processed ${processed} files, skipped ${skipped} unchanged — ${outputDir}/`
  );

  // Ensure CLAUDE.md contains the OptiVault protocol directive
  await generateClaudeMd(dir, vaultDirName);
}

// ---------------------------------------------------------------------------
// VaultRegistry — lightweight in-memory index used by watch.ts
// ---------------------------------------------------------------------------

export class VaultRegistry {
  private entries = new Map<string, ParseResult>();

  set(filePath: string, parsed: ParseResult): void {
    this.entries.set(filePath, parsed);
  }

  delete(filePath: string): void {
    this.entries.delete(filePath);
  }

  getAll(): ParseResult[] {
    return [...this.entries.values()];
  }

  has(filePath: string): boolean {
    return this.entries.has(filePath);
  }
}
