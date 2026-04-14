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
// startMcpServer — wire up all four tools and start the stdio transport
// ---------------------------------------------------------------------------

export async function startMcpServer(vaultDir: string, sourceDir?: string): Promise<void> {
  const server = new McpServer({ name: 'optivault', version: '0.1.0' });

  // ---------------------------------------------------------------------------
  // Tool 1: read_repo_map
  // ---------------------------------------------------------------------------

  server.tool(
    'read_repo_map',
    'Fetches the high-level architecture map of the entire codebase. Shows files, exports, and dependencies.',
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
    'Fetch the ultra-compressed AST skeleton (deps + signatures) for a specific file.',
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
    'Surgically extract the raw source of a specific function — touch only what you must. Use after read_file_skeleton to target the exact function body without reading the whole file. Minimum viable read.',
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
        const noteContent = formatVaultNote(parsed);

        // Overwrite the vault note for this file
        const notePath = join(vaultDir, filename + '.md');
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
    'Locate and return the test file for a given source file. Use before or after a surgical change to verify behavior. Supports TypeScript (.test.ts, .spec.ts, __tests__/) and Python (test_*.py) conventions.',
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

  process.stderr.write(
    `[optivault:mcp] Server started. Vault: ${vaultDir}${sourceDir ? `, Source: ${sourceDir}` : ''}\n`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
