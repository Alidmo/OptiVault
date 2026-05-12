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
import { readExistingConcepts, persistToGraph } from '../vault/init.js';
import { openGraphStore } from '../store/sqlite.js';
import { normalizeGraphKey } from '../store/keys.js';
import { z } from 'zod';

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
// renderRepoSummary — synthesize a bird's-eye view from the SQLite store
// ---------------------------------------------------------------------------

/**
 * Build a compact markdown summary of every file node tracked in the graph
 * store. Replaces the old `_RepoMap.md` artifact — same shape, computed on
 * demand so it can never drift from the underlying graph.
 */
function renderRepoSummary(vaultDir: string): string {
  const store = openGraphStore(vaultDir);
  try {
    const files = store.allFiles();
    if (files.length === 0) {
      return '# RepoMap\n\n(graph is empty — run `optivault init` first)';
    }

    const lines: string[] = ['# RepoMap', ''];
    for (const node of files) {
      const deps = store.neighbors(node.id, 'out', ['DEPENDS_ON']).map((n) => n.id);
      const parts: string[] = [];
      if (node.roles.length > 0) parts.push(`roles: ${node.roles.join(', ')}`);
      if (deps.length > 0) parts.push(`deps: ${deps.join(', ')}`);
      lines.push(
        parts.length > 0 ? `- [[${node.id}]] — ${parts.join(' — ')}` : `- [[${node.id}]]`
      );
    }
    return lines.join('\n');
  } finally {
    store.close();
  }
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
      try {
        return { content: [{ type: 'text', text: renderRepoSummary(vaultDir) }] };
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'SQLITE_CANTOPEN') {
          return {
            content: [
              {
                type: 'text',
                text: 'Graph store not found. Run "optivault init" to generate it.',
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

        // Patch the graph store entry for this file
        const store = openGraphStore(vaultDir);
        try {
          persistToGraph(store, parsed, sourceDir);
        } finally {
          store.close();
        }

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
    "PRIMARY wayfinding tool. Use this to answer 'what depends on X', 'what calls X', or 'which files have a given framework role' (e.g. role: 'Symfony:Entity' for ORM models). Returns a traversal of the AST dependency graph — no file bodies, no guessing.",
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
      role: z
        .string()
        .optional()
        .describe(
          'Optional framework-role filter (e.g. "Symfony:Entity", "Symfony:Controller"). When set, only nodes whose vault-note YAML `roles:` array contains this value are returned.'
        ),
    },
    async ({ from, relation, depth, role }) => {
      const cappedDepth = Math.min(Math.max(1, depth), 5);
      const normalizedFrom = normalizeGraphKey(from);

      let store;
      try {
        store = openGraphStore(vaultDir);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'SQLITE_CANTOPEN') {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  from,
                  relation,
                  depth: cappedDepth,
                  results: [],
                  message: 'Graph store not found. Run "optivault init" to generate it.',
                }),
              },
            ],
          };
        }
        throw err;
      }

      try {
        if (!store.hasNode(normalizedFrom)) {
          // Allow traversal from nodes that only appear as edge targets
          // (e.g. external/unresolved deps), but bail out if completely unknown.
          const outgoing = store.neighbors(normalizedFrom, 'out');
          const incoming = store.neighbors(normalizedFrom, 'in');
          if (outgoing.length === 0 && incoming.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    from,
                    relation,
                    depth: cappedDepth,
                    results: [],
                    message: `'${from}' not found in graph.`,
                  }),
                },
              ],
            };
          }
        }

        const direction = relation === 'dependencies' ? 'out' : 'in';
        let results = store.traverse(normalizedFrom, direction, cappedDepth, ['DEPENDS_ON']);

        if (role) {
          const roleMatches = new Set(store.queryByRole(role).map((n) => n.id));
          results = results.filter((r) => roleMatches.has(r.file));
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                from,
                relation,
                depth: cappedDepth,
                ...(role ? { role } : {}),
                results,
              }),
            },
          ],
        };
      } finally {
        store.close();
      }
    }
  );

  process.stderr.write(
    `[optivault:mcp] Server started. Vault: ${vaultDir}${sourceDir ? `, Source: ${sourceDir}` : ''}\n`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
