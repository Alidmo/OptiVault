// Vault Writer — Task 4 (Filesystem Agent)
// Responsibilities: recursive scan, pipeline, write .optivault/, _RepoMap.md

import { readdir, mkdir, writeFile } from 'fs/promises';
import { join, relative, dirname } from 'path';
import { parseFile } from '../ast/parser.js';
import type { ParseResult } from '../ast/parser.js';
import { summarizeFunctions } from '../compression/ollama.js';
import type { FunctionSummary } from '../compression/ollama.js';
import { formatVaultNote } from '../compression/formatter.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.py']);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.optivault']);

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
// processFile — parse + summarize + format for one file
// ---------------------------------------------------------------------------

export async function processFile(filePath: string): Promise<{
  parsed: ParseResult;
  content: string;
}> {
  const parsed = await parseFile(filePath);

  let summaries: FunctionSummary[] = [];
  try {
    // Build stub function entries from exports for summarization.
    // Since the AST parser gives us signatures only (not bodies),
    // we pass empty bodies — Ollama will do its best.
    const functionEntries = parsed.exports.map((sig) => ({
      signature: sig,
      body: '',
    }));
    if (functionEntries.length > 0) {
      summaries = await summarizeFunctions(functionEntries);
    }
  } catch {
    // Ollama not running or unreachable — degrade gracefully with no caveman lines
    summaries = [];
  }

  const content = formatVaultNote(parsed, summaries);
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
// runInit — main entry point
// ---------------------------------------------------------------------------

export async function runInit(dir: string, outputDir: string): Promise<void> {
  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });

  const files = await walkDir(dir);
  const allParsed: ParseResult[] = [];

  for (const filePath of files) {
    const rel = toRelativeForwardSlash(filePath, dir);
    console.log(`[optivault] Processing ${rel}...`);

    const { parsed, content } = await processFile(filePath);
    allParsed.push(parsed);

    // Write to .optivault/<relative-path>.md
    const notePath = join(outputDir, rel + '.md');
    const noteDir = dirname(notePath);
    await mkdir(noteDir, { recursive: true });
    await writeFile(notePath, content, 'utf8');
  }

  // Write the master index
  await writeRepoMap(outputDir, allParsed, dir);

  console.log(`[optivault] Done. Wrote ${files.length} notes to ${outputDir}/`);
}

// ---------------------------------------------------------------------------
// readExistingRepoMap — read all existing parsed results for _RepoMap rebuild
// This is used by watch.ts to load previously-indexed data for non-changed files.
// We store a lightweight in-memory registry instead of re-parsing everything.
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
