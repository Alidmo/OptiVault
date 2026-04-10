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

vi.mock('../ast/parser.js', () => ({
  parseFile: vi.fn(),
}));

vi.mock('../ast/function-extractor.js', () => ({
  extractFunctionCode: vi.fn(() => null),
}));

// Import under test after mocks are in place
import { startMcpServer } from './server.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VAULT_DIR = '/vault';
const FILENAME = 'src/auth.ts';
const NOTE_CONTENT = '# auth.ts\nCompressed shadow context here.';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('MCP server – semantic routing tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset captured tools between tests
    for (const key of Object.keys(capturedTools)) {
      delete capturedTools[key];
    }
  });

  it('registers read_repo_map tool', async () => {
    await startMcpServer(VAULT_DIR);
    expect(capturedTools['read_repo_map']).toBeDefined();
    expect(typeof capturedTools['read_repo_map']).toBe('function');
  });

  it('registers read_file_skeleton tool', async () => {
    await startMcpServer(VAULT_DIR);
    expect(capturedTools['read_file_skeleton']).toBeDefined();
    expect(typeof capturedTools['read_file_skeleton']).toBe('function');
  });

  it('registers read_function_code tool', async () => {
    await startMcpServer(VAULT_DIR, '/src');
    expect(capturedTools['read_function_code']).toBeDefined();
    expect(typeof capturedTools['read_function_code']).toBe('function');
  });

  it('read_file_skeleton returns file skeleton when it exists', async () => {
    mockReadFile.mockResolvedValueOnce(NOTE_CONTENT);
    await startMcpServer(VAULT_DIR);

    const handler = capturedTools['read_file_skeleton'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content).toHaveLength(1);
    expect(result.content[0].text).toBe(NOTE_CONTENT);
    expect(mockReadFile).toHaveBeenCalledWith(
      `${VAULT_DIR}/${FILENAME}.md`,
      'utf-8'
    );
  });

  it('read_file_skeleton returns error message when file missing', async () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    mockReadFile.mockRejectedValueOnce(enoent);
    await startMcpServer(VAULT_DIR);

    const handler = capturedTools['read_file_skeleton'];
    const result = (await handler({ filename: FILENAME })) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(result.content[0].text).toContain('No skeleton found');
  });
});
