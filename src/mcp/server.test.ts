import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoist mutable state so vi.mock factories can safely reference it
// ---------------------------------------------------------------------------
const { capturedTools, mockReadFile } = vi.hoisted(() => ({
  capturedTools: {} as Record<string, (...args: unknown[]) => unknown>,
  mockReadFile: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the MCP SDK so tests never touch stdio or real network
// ---------------------------------------------------------------------------
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: vi.fn().mockImplementation(() => ({
      tool: vi.fn(
        (
          _name: string,
          _descriptionOrSchema: unknown,
          _schemaOrCb: unknown,
          maybeCb?: (...args: unknown[]) => unknown,
        ) => {
          // The four-argument overload is: tool(name, description, schema, cb)
          const name = _name as string;
          const cb = maybeCb ?? (_schemaOrCb as (...args: unknown[]) => unknown);
          capturedTools[name] = cb;
        },
      ),
      connect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
  return { StdioServerTransport: vi.fn().mockImplementation(() => ({})) };
});

// ---------------------------------------------------------------------------
// Mock fs/promises
// ---------------------------------------------------------------------------
vi.mock('fs/promises', () => ({ readFile: mockReadFile }));

// Import under test after mocks are in place
import { startMcpServer } from './server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VAULT_DIR = '/vault';
const FILENAME = 'src/auth.ts';
const NOTE_CONTENT = '# auth.ts\nCompressed shadow context here.';

async function invokeHandler(filename: string) {
  // Trigger server initialisation so the tool is registered
  await startMcpServer(VAULT_DIR);
  const handler = capturedTools['read_shadow_context'];
  if (!handler) throw new Error('read_shadow_context tool was not registered');
  return handler({ filename }) as Promise<{
    content: Array<{ type: string; text: string }>;
  }>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MCP server – read_shadow_context tool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured tools between tests
    for (const key of Object.keys(capturedTools)) {
      delete capturedTools[key];
    }
  });

  it('returns correct text content for an existing shadow context file', async () => {
    mockReadFile.mockResolvedValueOnce(NOTE_CONTENT);

    const result = await invokeHandler(FILENAME);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(NOTE_CONTENT);
    expect(mockReadFile).toHaveBeenCalledWith(
      `${VAULT_DIR}/${FILENAME}.md`,
      'utf-8',
    );
  });

  it('returns "No shadow context found" message when the file is missing (ENOENT)', async () => {
    const enoent = Object.assign(new Error('ENOENT: no such file'), {
      code: 'ENOENT',
    });
    mockReadFile.mockRejectedValueOnce(enoent);

    const result = await invokeHandler(FILENAME);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toBe(
      `No shadow context found for: ${FILENAME}. Run 'optivault init' first.`,
    );
  });

  it('registers the read_shadow_context tool on the McpServer instance', async () => {
    mockReadFile.mockResolvedValue(NOTE_CONTENT);

    await startMcpServer(VAULT_DIR);

    expect(capturedTools['read_shadow_context']).toBeDefined();
    expect(typeof capturedTools['read_shadow_context']).toBe('function');
  });
});
