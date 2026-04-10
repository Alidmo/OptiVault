/**
 * MCP Server — Semantic Router for Claude Code
 *
 * Exposes three granular tools for hierarchical codebase traversal:
 * 1. read_repo_map - Bird's-eye view of entire repo
 * 2. read_file_skeleton - Compressed AST + deps for a specific file
 * 3. read_function_code - Extract just a specific function's source
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'fs/promises';
import { parseFile } from '../ast/parser.js';
import { extractFunctionCode } from '../ast/function-extractor.js';
import { z } from 'zod';

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
  // Tool 3: read_function_code (NEW)
  // ---------------------------------------------------------------------------

  server.tool(
    'read_function_code',
    'Extract the raw source code for a specific function. Use this after read_file_skeleton to get the actual implementation.',
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
        // Reconstruct full file path from sourceDir
        const fullPath = `${sourceDir}/${filename}`;
        const parsed = await parseFile(fullPath);
        const source = await readFile(fullPath, 'utf-8');

        // Determine file extension
        const lastDot = filename.lastIndexOf('.');
        const ext = lastDot === -1 ? '' : filename.slice(lastDot);

        // Extract just this function
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

  process.stderr.write(
    `[optivault:mcp] Server started. Vault: ${vaultDir}${sourceDir ? `, Source: ${sourceDir}` : ''}\n`
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
