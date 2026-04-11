// Vault Writer — Task 4 (Filesystem Agent)
// Responsibilities: recursive scan, pipeline, write .optivault/, _RepoMap.md

import { readdir, mkdir, writeFile, readFile, stat } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { parseFile } from '../ast/parser.js';
import type { ParseResult } from '../ast/parser.js';
import { formatVaultNote } from '../compression/formatter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.py']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.optivault']);

/** Unique sentinel that marks an existing CLAUDE.md as already patched. */
const CLAUDE_MD_MARKER = '<!-- optivault-protocol -->';

const CLAUDE_MD_PROTOCOL = `${CLAUDE_MD_MARKER}
# OptiVault Protocol Active
This repository uses OptiVault for AST-compressed context.

**Rules for AI Assistants:**
1. NEVER use \`cat\`, \`grep\`, or standard file reads to understand the codebase initially.
2. ALWAYS start by calling the \`read_repo_map\` MCP tool.
3. Use \`read_file_skeleton\` to view a file's dependencies and exported signatures.
4. Use \`read_function_code\` if you need to analyze or modify a specific function body.
5. **CRITICAL:** Whenever you modify a file or write new code, you MUST immediately call the \`sync_file_context\` MCP tool on that file to keep the shadow vault up to date.`;

// ---------------------------------------------------------------------------
// walkDir — recursively yield source file paths
// ---------------------------------------------------------------------------

export async function walkDir(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkDir(fullPath);
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
// processFile — parse and format for one file (no summarization needed)
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
// toRelativeForwardSlash — convert absolute path to forward-slash relative path
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
    // Strip extension for the wikilink target
    const wikiTarget = rel.replace(/\.[^/.]+$/, '');

    const parts: string[] = [];

    if (parsed.exports.length > 0) {
      parts.push(`exports: ${parsed.exports.join(', ')}`);
    }
    if (parsed.deps.length > 0) {
      parts.push(`deps: ${parsed.deps.join(', ')}`);
    }

    if (parts.length > 0) {
      lines.push(`- [[${wikiTarget}]] — ${parts.join(' — ')}`);
    } else {
      lines.push(`- [[${wikiTarget}]]`);
    }
  }

  const repoMapPath = join(outputDir, '_RepoMap.md');
  await writeFile(repoMapPath, lines.join('\n'), 'utf8');
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

  let inFrontmatter = false;
  let frontmatterClosed = false;
  let inSignatures = false;

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
        }
      }
    } else {
      if (line.trim() === '## Signatures') { inSignatures = true; continue; }
      if (inSignatures) {
        const m = line.match(/^- `(.+)`$/);
        if (m) exports.push(m[1]);
      }
    }
  }

  return { filePath, deps, exports };
}

// ---------------------------------------------------------------------------
// generateClaudeMd — create or patch CLAUDE.md with the OptiVault protocol
// ---------------------------------------------------------------------------

export async function generateClaudeMd(dir: string): Promise<void> {
  const claudePath = join(dir, 'CLAUDE.md');

  let existing: string | null = null;
  try {
    const raw = await readFile(claudePath, 'utf8');
    existing = typeof raw === 'string' ? raw : null;
  } catch {
    existing = null;
  }

  if (existing === null) {
    await writeFile(claudePath, CLAUDE_MD_PROTOCOL + '\n', 'utf8');
    console.log('[optivault] Created CLAUDE.md with OptiVault protocol.');
  } else if (!existing.includes(CLAUDE_MD_MARKER)) {
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    await writeFile(claudePath, existing + separator + CLAUDE_MD_PROTOCOL + '\n', 'utf8');
    console.log('[optivault] Appended OptiVault protocol to existing CLAUDE.md.');
  }
  // Marker already present — no-op (silent).
}

// ---------------------------------------------------------------------------
// runInit — main entry point
// ---------------------------------------------------------------------------

export async function runInit(dir: string, outputDir: string): Promise<void> {
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const files = await walkDir(dir);
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
      ({ parsed, content } = await processFile(filePath));
    } catch (err) {
      console.warn(`[optivault] Warning: skipping ${rel} — ${(err as Error).message}`);
      continue;
    }

    allParsed.push(parsed);

    // Write to .optivault/<relative-path>.md
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

  // Ensure the project's CLAUDE.md contains the OptiVault protocol directive
  await generateClaudeMd(dir);
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
