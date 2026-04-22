/**
 * MCP Server — Semantic Router for Claude Code
 *
 * Exposes four granular tools for hierarchical codebase traversal:
 * 1. read_repo_map       — Bird's-eye view of entire repo
 * 2. read_file_skeleton  — Compressed AST + deps for a specific file
 * 3. read_function_code  — Extract just a specific function's source
 * 4. sync_file_context   — Blazing-fast single-file re-index after writes
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname, extname } from 'path';
import { parseFile } from '../ast/parser.js';
import type { ParseResult } from '../ast/parser.js';
import { extractFunctionCode } from '../ast/function-extractor.js';
import { formatVaultNote } from '../compression/formatter.js';
import { readExistingConcepts } from '../vault/init.js';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// patchRepoMapEntry — targeted single-line update in _RepoMap.md
// ---------------------------------------------------------------------------

/**
 * Replace or insert the _RepoMap.md entry for a single file.
 * Reads the existing map, patches the relevant line in-place, and writes it
 * back. This is O(lines in RepoMap) rather than O(all files in repo).
 */
async function patchRepoMapEntry(
  vaultDir: string,
  filename: string,
  parsed: ParseResult
): Promise<void> {
  const repoMapPath = join(vaultDir, '_RepoMap.md');

  // Derive the wikilink key the same way writeRepoMap does
  const rel = filename.replace(/\\/g, '/');
  const wikiKey = rel.replace(/\.[^/.]+$/, '');

  // Build the replacement line
  const parts: string[] = [];
  if (parsed.exports.length > 0) parts.push(`exports: ${parsed.exports.join(', ')}`);
  if (parsed.deps.length > 0) parts.push(`deps: ${parsed.deps.join(', ')}`);
  const newLine = parts.length > 0
    ? `- [[${wikiKey}]] — ${parts.join(' — ')}`
    : `- [[${wikiKey}]]`;

  // Read existing map (or start fresh if it doesn't exist yet)
  let content = '';
  try {
    const raw = await readFile(repoMapPath, 'utf-8');
    content = typeof raw === 'string' ? raw : '';
  } catch {
    content = '# RepoMap\n';
  }

  const lines = content.split('\n');

  // Escape special regex chars in the wiki key (paths may contain dots)
  const escapedKey = wikiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = new RegExp(`^- \\[\\[${escapedKey}\\]\\]`);
  const idx = lines.findIndex((l) => pat.test(l));

  if (idx !== -1) {
    lines[idx] = newLine;   // update existing entry
  } else {
    lines.push(newLine);    // new file — append
  }

  await writeFile(repoMapPath, lines.join('\n'), 'utf-8');
}

// ---------------------------------------------------------------------------
// getTestFileCandidates — derive likely test file paths from a source path
// ---------------------------------------------------------------------------

/**
 * Return an ordered list of candidate test file paths for a given source file.
 * Follows common TypeScript/JavaScript (.test.ts, .spec.ts, __tests__/) and
 * Python (test_*.py, *_test.py, tests/) conventions.
 */
export function getTestFileCandidates(filename: string): string[] {
  const normalised = filename.replace(/\\/g, '/');
  const lastSlash = normalised.lastIndexOf('/');
  const dir = lastSlash === -1 ? '' : normalised.slice(0, lastSlash);
  const basename = lastSlash === -1 ? normalised : normalised.slice(lastSlash + 1);
  const ext = extname(basename);
  const stem = basename.slice(0, basename.length - ext.length);
  const prefix = dir ? `${dir}/` : '';

  if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.mjs') {
    return [
      `${prefix}${stem}.test${ext}`,
      `${prefix}${stem}.spec${ext}`,
      `${prefix}__tests__/${stem}.test${ext}`,
      `tests/${stem}.test${ext}`,
      `test/${stem}.test${ext}`,
    ];
  }

  if (ext === '.py') {
    return [
      `${prefix}test_${stem}.py`,
      `${prefix}${stem}_test.py`,
      `tests/test_${stem}.py`,
      `test/test_${stem}.py`,
    ];
  }

  return [];
}

// ---------------------------------------------------------------------------
// buildDepGraph — parse _RepoMap.md into forward/reverse adjacency maps
// ---------------------------------------------------------------------------

export interface DepGraph {
  forward: Map<string, string[]>;
  reverse: Map<string, string[]>;
}

/**
 * Normalize a file key by stripping known source extensions and the leading
 * wikilink-style path traversal prefixes (RepoMap sometimes includes
 * ../../Ali/... for absolute-style entries — preserve the tail after the
 * last "OptiVault/" if present).
 */
export function normalizeGraphKey(key: string): string {
  let k = key.replace(/\\/g, '/').trim();
  // Strip known source extensions
  k = k.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|php|cpp|cc|h|hpp|cs)$/i, '');
  return k;
}

export function buildDepGraph(repoMapContent: string): DepGraph {
  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  const lines = repoMapContent.split('\n');
  const entryPat = /^- \[\[([^\]]+)\]\](.*)$/;

  for (const line of lines) {
    const m = entryPat.exec(line);
    if (!m) continue;

    const rawKey = m[1];
    const rest = m[2];
    const key = normalizeGraphKey(rawKey);

    // Extract deps segment if present
    const depsMatch = /—\s*deps:\s*([^—]+?)(?:\s*—|$)/.exec(rest);
    const deps: string[] = [];
    if (depsMatch) {
      const depList = depsMatch[1].split(',').map((d) => normalizeGraphKey(d));
      for (const d of depList) {
        if (d) deps.push(d);
      }
    }

    forward.set(key, deps);
    for (const d of deps) {
      const arr = reverse.get(d) ?? [];
      arr.push(key);
      reverse.set(d, arr);
    }
  }

  return { forward, reverse };
}

/**
 * BFS traversal up to `depth`. Returns unique {file, depth} entries at
 * their first-discovered depth.
 */
export function traverseGraph(
  adjacency: Map<string, string[]>,
  from: string,
  depth: number
): Array<{ file: string; depth: number }> {
  const results: Array<{ file: string; depth: number }> = [];
  const seen = new Set<string>([from]);
  let frontier: string[] = [from];

  for (let d = 1; d <= depth; d++) {
    const next: string[] = [];
    for (const node of frontier) {
      const neighbors = adjacency.get(node) ?? [];
      for (const nb of neighbors) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        results.push({ file: nb, depth: d });
        next.push(nb);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return results;
}

// ---------------------------------------------------------------------------
// startMcpServer — wire up all MCP tools and start the stdio transport
// ---------------------------------------------------------------------------

export async function startMcpServer(vaultDir: string, sourceDir?: string): Promise<void> {
  const server = new McpServer({ name: 'optivault', version: '0.1.0' });

  // ---------------------------------------------------------------------------
  // Tool 1: read_repo_map
  // ---------------------------------------------------------------------------

  server.tool(
    'read_repo_map',
    "Bird's-eye structural map of the repo. Call this first if you've never queried the graph in this session; otherwise prefer query_graph for specific traversal questions.",
    {},
    async () => {
      const repoMapPath = `${vaultDir}/_RepoMap.md`;
      try {
        const content = await readFile(repoMapPath, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return {
            content: [
              {
                type: 'text',
                text: 'RepoMap not found. Run "optivault init" to generate it.',
              },
            ],
          };
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 2: read_file_skeleton
  // ---------------------------------------------------------------------------

  server.tool(
    'read_file_skeleton',
    'Compressed signatures + deps for one file. Use AFTER query_graph has identified the relevant file. Never use as exploration; use as confirmation.',
    { filename: z.string().describe('Source file path, e.g. src/auth.ts') },
    async ({ filename }) => {
      const filePath = `${vaultDir}/${filename}.md`;
      try {
        const content = await readFile(filePath, 'utf-8');
        return { content: [{ type: 'text', text: content }] };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return {
            content: [
              {
                type: 'text',
                text: `No skeleton found for: ${filename}. Run 'optivault init' first.`,
              },
            ],
          };
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 3: read_function_code
  // ---------------------------------------------------------------------------

  server.tool(
    'read_function_code',
    'Surgically extract the raw source of a specific function — minimum viable read. Banned as an exploration tool; only use when you know the exact function name from a prior skeleton or graph call.',
    {
      filename: z.string().describe('Source file path, e.g. src/auth.ts'),
      functionName: z.string().describe('Function or method name to extract'),
    },
    async ({ filename, functionName }) => {
      if (!sourceDir) {
        return {
          content: [
            {
              type: 'text',
              text: 'Source directory not configured for this MCP server.',
            },
          ],
        };
      }

      try {
        const fullPath = `${sourceDir}/${filename}`;
        await parseFile(fullPath);
        const source = await readFile(fullPath, 'utf-8');

        const lastDot = filename.lastIndexOf('.');
        const ext = lastDot === -1 ? '' : filename.slice(lastDot);

        const funcCode = extractFunctionCode(source, functionName, ext);

        if (!funcCode) {
          return {
            content: [
              {
                type: 'text',
                text: `Function '${functionName}' not found in ${filename}`,
              },
            ],
          };
        }

        return { content: [{ type: 'text', text: funcCode }] };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return {
            content: [
              {
                type: 'text',
                text: `File not found: ${filename}`,
              },
            ],
          };
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 4: sync_file_context
  // ---------------------------------------------------------------------------

  server.tool(
    'sync_file_context',
    'MANDATORY after every surgical write. Triggers a single-file AST re-parse — updates the skeleton and patches the RepoMap in ~20ms. Step 3 of the verification loop: Read → Write+Verify → Sync. Never skip this.',
    {
      filename: z.string().describe(
        'Source file path relative to the project root, e.g. src/auth.ts'
      ),
    },
    async ({ filename }) => {
      if (!sourceDir) {
        return {
          content: [
            {
              type: 'text',
              text: 'Source directory not configured for this MCP server.',
            },
          ],
        };
      }

      try {
        const fullPath = join(sourceDir, filename);
        const parsed: ParseResult = await parseFile(fullPath);

        // Merge forward any pre-existing concepts from the vault note
        const notePath = join(vaultDir, filename + '.md');
        const existingConcepts = await readExistingConcepts(notePath);
        if (existingConcepts.length > 0) {
          parsed.concepts = existingConcepts;
        }

        const noteContent = formatVaultNote(parsed);

        // Overwrite the vault note for this file
        await mkdir(dirname(notePath), { recursive: true });
        await writeFile(notePath, noteContent, 'utf-8');

        // Patch just this entry in _RepoMap.md
        await patchRepoMapEntry(vaultDir, filename, parsed);

        return {
          content: [
            {
              type: 'text',
              text: `Successfully synced shadow context for ${filename}.`,
            },
          ],
        };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return {
            content: [
              {
                type: 'text',
                text: `File not found: ${filename}`,
              },
            ],
          };
        }
        throw err;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 5: read_tests_for_file
  // ---------------------------------------------------------------------------

  server.tool(
    'read_tests_for_file',
    'Fetch the test file for a source file before writing a change — tests define the contract you must not break. Supports TypeScript (.test.ts, .spec.ts, __tests__/) and Python (test_*.py) conventions.',
    {
      filename: z.string().describe('Source file path, e.g. src/auth.ts'),
    },
    async ({ filename }) => {
      if (!sourceDir) {
        return {
          content: [
            {
              type: 'text',
              text: 'Source directory not configured for this MCP server.',
            },
          ],
        };
      }

      const candidates = getTestFileCandidates(filename);

      for (const candidate of candidates) {
        const fullPath = join(sourceDir, candidate);
        try {
          const content = await readFile(fullPath, 'utf-8');
          return {
            content: [
              {
                type: 'text',
                text: `// Test file: ${candidate}\n${content}`,
              },
            ],
          };
        } catch {
          // Try next candidate
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: `No test file found for ${filename}. Looked for: ${candidates.join(', ')}`,
          },
        ],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 6: query_graph
  // ---------------------------------------------------------------------------

  server.tool(
    'query_graph',
    "PRIMARY wayfinding tool. Use this to answer 'what depends on X' or 'what calls X' instead of opening files. Returns a traversal of the AST dependency graph — no file bodies, no guessing.",
    {
      from: z.string().describe('Source file path, e.g. src/auth.ts'),
      relation: z
        .enum(['dependencies', 'callers'])
        .describe('"dependencies" = files `from` imports; "callers" = files that import `from`'),
      depth: z
        .number()
        .int()
        .min(1)
        .max(5)
        .describe('Traversal depth (1 = direct only). Capped at 5.'),
    },
    async ({ from, relation, depth }) => {
      const cappedDepth = Math.min(Math.max(1, depth), 5);
      const repoMapPath = `${vaultDir}/_RepoMap.md`;

      let content: string;
      try {
        content = await readFile(repoMapPath, 'utf-8');
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  from,
                  relation,
                  depth: cappedDepth,
                  results: [],
                  message: 'RepoMap not found. Run "optivault init" to generate it.',
                }),
              },
            ],
          };
        }
        throw err;
      }

      const graph = buildDepGraph(content);
      const normalizedFrom = normalizeGraphKey(from);
      const adjacency = relation === 'dependencies' ? graph.forward : graph.reverse;

      if (!graph.forward.has(normalizedFrom) && !graph.reverse.has(normalizedFrom)) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                from,
                relation,
                depth: cappedDepth,
                results: [],
                message: `'${from}' not found in RepoMap.`,
              }),
            },
          ],
        };
      }

      const results = traverseGraph(adjacency, normalizedFrom, cappedDepth);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ from, relation, depth: cappedDepth, results }),
          },
        ],
      };
    }
  );

  process.stderr.write(
    `[optivault:mcp] Server started. Vault: ${vaultDir}${sourceDir ? `, Source: ${sourceDir}` : ''}\n`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
