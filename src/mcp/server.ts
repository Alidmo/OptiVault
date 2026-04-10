import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFile } from 'fs/promises';
import { z } from 'zod';

export async function startMcpServer(vaultDir: string): Promise<void> {
  const server = new McpServer({ name: 'optivault', version: '0.1.0' });

  server.tool(
    'read_shadow_context',
    'Read the compressed shadow context note for a source file',
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
                text: `No shadow context found for: ${filename}. Run 'optivault init' first.`,
              },
            ],
          };
        }
        throw err;
      }
    },
  );

  process.stderr.write(`[optivault:mcp] Server started. Vault: ${vaultDir}\n`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
