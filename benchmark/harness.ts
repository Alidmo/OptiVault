// Benchmark harness — measures OptiVault navigation path vs brute-force cat.
// Task: "Find all files that transitively depend on src/ast/parser.ts up to
// depth 2, and list their signatures."

import { readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkDir } from '../src/vault/init.js';
import { buildDepGraph, traverseGraph, normalizeGraphKey } from '../src/mcp/server.js';

export const TASK_DESCRIPTION =
  'Find all files that transitively depend on src/ast/parser.ts up to depth 2, and list their signatures.';

export interface RunMetrics {
  files_read: number;
  bytes: number;
  chars: number;
  estimated_tokens: number;
  wall_ms: number;
  payload_preview: string;
}

export interface Deltas {
  token_reduction_pct: number;
  speedup_x: number;
  files_read_reduction_pct: number;
}

const TOKEN_DIVISOR = 4;

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / TOKEN_DIVISOR);
}

export function computeDeltas(brute: RunMetrics, opti: RunMetrics): Deltas {
  const token_reduction_pct =
    brute.estimated_tokens === 0
      ? 0
      : ((brute.estimated_tokens - opti.estimated_tokens) / brute.estimated_tokens) * 100;
  const speedup_x = opti.wall_ms === 0 ? Infinity : brute.wall_ms / opti.wall_ms;
  const files_read_reduction_pct =
    brute.files_read === 0
      ? 0
      : ((brute.files_read - opti.files_read) / brute.files_read) * 100;
  return {
    token_reduction_pct: round2(token_reduction_pct),
    speedup_x: round2(speedup_x),
    files_read_reduction_pct: round2(files_read_reduction_pct),
  };
}

function round2(n: number): number {
  if (!isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

function metricsFromPayload(
  filesRead: number,
  bytes: number,
  payload: string,
  wallMs: number,
): RunMetrics {
  return {
    files_read: filesRead,
    bytes,
    chars: payload.length,
    estimated_tokens: estimateTokens(payload.length),
    wall_ms: wallMs,
    payload_preview: payload.slice(0, 200),
  };
}

/**
 * Way A — Brute-force: read every TS/PY source file under src/.
 * Caller passes a list of absolute paths and a reader fn so this is testable.
 */
export async function runBruteForce(
  files: string[],
  readFn: (p: string) => Promise<string>,
): Promise<RunMetrics> {
  const start = performance.now();
  const parts: string[] = [];
  let bytes = 0;
  for (const f of files) {
    const content = await readFn(f);
    bytes += Buffer.byteLength(content, 'utf8');
    parts.push(`// === ${f} ===\n${content}\n`);
  }
  const payload = parts.join('');
  const wallMs = performance.now() - start;
  return metricsFromPayload(files.length, bytes, payload, wallMs);
}

/**
 * Way B — OptiVault: traverse graph, read only skeletons for callers.
 * `skeletonPathFor` maps a graph key (e.g. "src/ast/parser") to an absolute
 * skeleton path (e.g. "_optivault/src/ast/parser.ts.md").
 */
export async function runOptiVault(
  repoMapContent: string,
  from: string,
  depth: number,
  skeletonPathFor: (graphKey: string) => string,
  readFn: (p: string) => Promise<string>,
): Promise<RunMetrics> {
  const start = performance.now();
  const graph = buildDepGraph(repoMapContent);
  let normalizedFrom = normalizeGraphKey(from);

  // If the full path isn't a key in reverse (because RepoMap stores deps as
  // bare basenames), fall back to the basename.
  if (!graph.reverse.has(normalizedFrom)) {
    const basename = normalizedFrom.split('/').pop() ?? normalizedFrom;
    if (graph.reverse.has(basename)) {
      normalizedFrom = basename;
    }
  }

  const results = traverseGraph(graph.reverse, normalizedFrom, depth);
  const parts: string[] = [];
  let bytes = 0;
  let filesRead = 0;
  for (const r of results) {
    const path = skeletonPathFor(r.file);
    try {
      const content = await readFn(path);
      bytes += Buffer.byteLength(content, 'utf8');
      parts.push(`// === ${r.file} (depth ${r.depth}) ===\n${content}\n`);
      filesRead++;
    } catch {
      // Skeleton missing (e.g. external dep like "types") — skip silently.
    }
  }
  const payload = parts.join('');
  const wallMs = performance.now() - start;
  return metricsFromPayload(filesRead, bytes, payload, wallMs);
}

export interface BenchmarkResult {
  task: string;
  timestamp: string;
  runs: {
    brute_force: RunMetrics;
    optivault: RunMetrics;
  };
  deltas: Deltas;
}

export async function runBenchmark(repoRoot: string): Promise<BenchmarkResult> {
  const srcDir = join(repoRoot, 'src');
  const vaultDir = join(repoRoot, '_optivault');

  // Brute force: all source files under src/ (TS + PY — no .py exist but
  // walkDir already filters by supported extensions).
  const allFiles = await walkDir(srcDir);
  const bruteForce = await runBruteForce(allFiles, (p) => readFile(p, 'utf8'));

  // OptiVault: read RepoMap, traverse reverse graph from parser, read skeletons.
  const repoMapContent = await readFile(join(vaultDir, '_RepoMap.md'), 'utf8');
  // Graph keys are normalized (no extension). Skeletons on disk are
  // <key>.<ext>.md — probe known extensions until one hits.
  const readSkeletonAnyExt = async (graphKey: string): Promise<string> => {
    const candidates = ['ts', 'tsx', 'js', 'py', 'go', 'rs', 'java', 'kt', 'php', 'cpp', 'cs'];
    for (const ext of candidates) {
      const p = join(vaultDir, `${graphKey}.${ext}.md`);
      try {
        return await readFile(p, 'utf8');
      } catch {
        // try next
      }
    }
    throw new Error(`no skeleton for ${graphKey}`);
  };
  const optivault = await runOptiVault(
    repoMapContent,
    'src/ast/parser',
    2,
    (k) => k, // pass graph key through; readFn does the ext-probing
    readSkeletonAnyExt,
  );

  return {
    task: TASK_DESCRIPTION,
    timestamp: new Date().toISOString(),
    runs: {
      brute_force: bruteForce,
      optivault,
    },
    deltas: computeDeltas(bruteForce, optivault),
  };
}

// ---------------------------------------------------------------------------
// CLI entry — only runs when invoked directly (tsx benchmark/harness.ts)
// ---------------------------------------------------------------------------

const isMain = (() => {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1] ? resolve(process.argv[1]) : '';
    return thisFile === argv1;
  } catch {
    return false;
  }
})();

if (isMain) {
  const repoRoot = resolve(fileURLToPath(import.meta.url), '..', '..');
  // Sanity: ensure _optivault exists.
  try {
    await stat(join(repoRoot, '_optivault', '_RepoMap.md'));
  } catch {
    console.error('ERROR: _optivault/_RepoMap.md not found. Run "optivault init ." first.');
    process.exit(1);
  }

  const result = await runBenchmark(repoRoot);
  const outPath = join(repoRoot, 'benchmark', 'benchmark_results.json');
  await writeFile(outPath, JSON.stringify(result, null, 2) + '\n', 'utf8');

  const bf = result.runs.brute_force;
  const ov = result.runs.optivault;
  const d = result.deltas;
  const rel = relative(repoRoot, outPath).split(sep).join('/');
  console.log(`OptiVault Benchmark — src/ast/parser.ts callers, depth=2`);
  console.log(
    `  Brute force: ${bf.files_read} files, ${bf.chars} chars, ~${bf.estimated_tokens} tokens, ${Math.round(bf.wall_ms)}ms`,
  );
  console.log(
    `  OptiVault:   ${ov.files_read} files, ${ov.chars} chars, ~${ov.estimated_tokens} tokens, ${Math.round(ov.wall_ms)}ms`,
  );
  console.log(`  Δ tokens:    ${d.token_reduction_pct}% reduction`);
  console.log(`  Δ latency:   ${d.speedup_x}× faster`);
  console.log(`  Results:     ${rel}`);
}
