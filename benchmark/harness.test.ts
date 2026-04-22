import { describe, it, expect } from 'vitest';
import {
  runBruteForce,
  runOptiVault,
  computeDeltas,
  estimateTokens,
  type RunMetrics,
} from './harness.js';

// ---------------------------------------------------------------------------
// Synthetic in-memory fixtures — no real fs, no real _optivault.
// ---------------------------------------------------------------------------

const SYNTHETIC_REPO_MAP = `# RepoMap

- [[src/ast/parser]] — exports: parseFile(filePath: string) — deps: extractor
- [[src/compression/formatter]] — exports: formatVaultNote(p: ParseResult) — deps: parser
- [[src/mcp/server]] — exports: buildDepGraph(s: string) — deps: parser, formatter
- [[src/vault/init]] — exports: runInit(d: string) — deps: parser, formatter
`;

const SYNTHETIC_SOURCES: Record<string, string> = {
  'src/ast/parser.ts':
    '// parser — fat implementation\n' + 'x'.repeat(2000),
  'src/compression/formatter.ts':
    '// formatter — fat implementation\n' + 'y'.repeat(2000),
  'src/mcp/server.ts':
    '// server — fat implementation\n' + 'z'.repeat(2000),
  'src/vault/init.ts':
    '// init — fat implementation\n' + 'w'.repeat(2000),
};

const SYNTHETIC_SKELETONS: Record<string, string> = {
  formatter: '---\nexp: [formatVaultNote(p: ParseResult)]\n---\n',
  server: '---\nexp: [buildDepGraph(s: string)]\n---\n',
  init: '---\nexp: [runInit(d: string)]\n---\n',
};

describe('benchmark harness', () => {
  it('exports runBenchmark, runBruteForce, runOptiVault', async () => {
    const mod = await import('./harness.js');
    expect(typeof mod.runBenchmark).toBe('function');
    expect(typeof mod.runBruteForce).toBe('function');
    expect(typeof mod.runOptiVault).toBe('function');
  });

  it('runOptiVault returns fewer estimated_tokens than runBruteForce on the same graph', async () => {
    const read = async (p: string) => {
      if (SYNTHETIC_SOURCES[p]) return SYNTHETIC_SOURCES[p];
      throw new Error(`missing ${p}`);
    };
    const brute = await runBruteForce(Object.keys(SYNTHETIC_SOURCES), read);

    const readSkel = async (graphKey: string) => {
      const basename = graphKey.split('/').pop() ?? graphKey;
      if (SYNTHETIC_SKELETONS[basename]) return SYNTHETIC_SKELETONS[basename];
      throw new Error(`missing skel ${graphKey}`);
    };
    const opti = await runOptiVault(
      SYNTHETIC_REPO_MAP,
      'src/ast/parser',
      2,
      (k) => k,
      readSkel,
    );

    expect(opti.estimated_tokens).toBeLessThan(brute.estimated_tokens);
    expect(opti.files_read).toBeGreaterThan(0);
  });

  it('computeDeltas produces correct percentages and speedup', () => {
    const brute: RunMetrics = {
      files_read: 42,
      bytes: 200_000,
      chars: 200_000,
      estimated_tokens: 50_000,
      wall_ms: 100,
      payload_preview: '',
    };
    const opti: RunMetrics = {
      files_read: 8,
      bytes: 4_000,
      chars: 4_000,
      estimated_tokens: 1_000,
      wall_ms: 10,
      payload_preview: '',
    };
    const d = computeDeltas(brute, opti);
    expect(d.token_reduction_pct).toBe(98);
    expect(d.speedup_x).toBe(10);
    expect(d.files_read_reduction_pct).toBeCloseTo(80.95, 1);
  });

  it('estimateTokens uses chars/4 ceiling', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
  });
});
