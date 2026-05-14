// Vault Watcher
// Responsibilities: chokidar watch, incremental re-parse on file save

import { unlink, mkdir, writeFile } from 'fs/promises';
import { join, relative, dirname, basename } from 'path';
import chokidar from 'chokidar';
import { IGNORED_DIRECTORIES } from '../config.js';
import {
  runInit,
  walkDir,
  processFile,
  persistToGraph,
  VaultRegistry,
} from './init.js';
import { openGraphStore } from '../store/sqlite.js';
import { normalizeGraphKey } from '../store/keys.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SUPPORTED_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.py']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSupportedFile(filePath: string): boolean {
  const dotIndex = filePath.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = filePath.slice(dotIndex);
  return SUPPORTED_EXTENSIONS.has(ext);
}

function toRelativeForwardSlash(filePath: string, baseDir: string): string {
  return relative(baseDir, filePath).replace(/\\/g, '/');
}

function notePathFor(filePath: string, dir: string, outputDir: string): string {
  const rel = toRelativeForwardSlash(filePath, dir);
  return join(outputDir, rel + '.md');
}

// ---------------------------------------------------------------------------
// runWatch — main entry point
// ---------------------------------------------------------------------------

export async function runWatch(dir: string, outputDir: string): Promise<void> {
  const vaultDirName = basename(outputDir);

  // Patterns for directories chokidar should never watch into
  const watchIgnored = [
    ...IGNORED_DIRECTORIES.map((d) => `**/${d}/**`),
    `**/${vaultDirName}/**`,
  ];

  // 1. Initial full scan (persists to SQLite via runInit)
  await runInit(dir, outputDir);

  // 2. Open store for incremental updates from the watcher
  const store = openGraphStore(outputDir);

  // 3. Populate registry from the initial scan
  const registry = new VaultRegistry();
  const allFiles = await walkDir(dir, new Set([vaultDirName]));
  for (const filePath of allFiles) {
    try {
      const { parsed } = await processFile(filePath);
      registry.set(filePath, parsed);
    } catch {
      // If a file fails on initial load, skip it in the registry
    }
  }

  // 3. Set up chokidar watcher
  const watcher = chokidar.watch(dir, {
    ignored: watchIgnored,
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 50,
    },
  });

  // Handler for add/change events
  const handleAddOrChange = async (filePath: string): Promise<void> => {
    if (!isSupportedFile(filePath)) return;

    const rel = toRelativeForwardSlash(filePath, dir);
    console.log(`[optivault:watch] Changed: ${rel} — re-indexed`);

    try {
      const { parsed, content } = await processFile(filePath);
      registry.set(filePath, parsed);
      persistToGraph(store, parsed, dir);

      const notePath = notePathFor(filePath, dir, outputDir);
      const noteDir = dirname(notePath);
      await mkdir(noteDir, { recursive: true });
      await writeFile(notePath, content, 'utf8');
    } catch (err) {
      console.error(`[optivault:watch] Error processing ${rel}:`, err);
      return;
    }
  };

  // Handler for unlink events
  const handleUnlink = async (filePath: string): Promise<void> => {
    if (!isSupportedFile(filePath)) return;

    const rel = toRelativeForwardSlash(filePath, dir);
    console.log(`[optivault:watch] Deleted: ${rel} — removed from vault`);

    registry.delete(filePath);
    store.deleteFile(normalizeGraphKey(rel));

    const notePath = notePathFor(filePath, dir, outputDir);
    try {
      await unlink(notePath);
    } catch {
      // File may not exist — ignore
    }
  };

  watcher.on('add', (filePath) => void handleAddOrChange(filePath));
  watcher.on('change', (filePath) => void handleAddOrChange(filePath));
  watcher.on('unlink', (filePath) => void handleUnlink(filePath));

  watcher.on('error', (err) => {
    console.error('[optivault:watch] Watcher error:', err);
  });

  console.log(`[optivault:watch] Watching ${dir} for changes...`);

  await new Promise<void>((resolve) => {
    watcher.on('close', resolve);
  });
}
