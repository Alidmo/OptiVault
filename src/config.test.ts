import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock 'fs' so readFileSync never touches disk
// ---------------------------------------------------------------------------
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
}));

import { getConfig, DEFAULT_VAULT_DIR } from './config.js';
import * as fs from 'fs';

const mockReadFileSync = vi.mocked(fs.readFileSync);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns _optivault default when no config file exists', () => {
    mockReadFileSync.mockImplementation(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    });
    expect(getConfig('/project').vaultDir).toBe(DEFAULT_VAULT_DIR);
    expect(getConfig('/project').vaultDir).toBe('_optivault');
  });

  it('returns configured vaultDir when optivault.json is present', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ vaultDir: '_my_vault' }));
    expect(getConfig('/project').vaultDir).toBe('_my_vault');
  });

  it('reads config from the correct path', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ vaultDir: 'custom' }));
    getConfig('/my/project');
    expect(mockReadFileSync).toHaveBeenCalledWith(
      expect.stringContaining('optivault.json'),
      'utf8'
    );
  });

  it('falls back to default on malformed JSON', () => {
    mockReadFileSync.mockReturnValue('{ not valid json');
    expect(getConfig('/project').vaultDir).toBe(DEFAULT_VAULT_DIR);
  });

  it('falls back to default when vaultDir key is missing', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ someOtherKey: 'value' }));
    expect(getConfig('/project').vaultDir).toBe(DEFAULT_VAULT_DIR);
  });

  it('falls back to default when vaultDir is an empty string', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ vaultDir: '   ' }));
    expect(getConfig('/project').vaultDir).toBe(DEFAULT_VAULT_DIR);
  });

  it('trims whitespace from vaultDir', () => {
    mockReadFileSync.mockReturnValue(JSON.stringify({ vaultDir: '  _clean  ' }));
    expect(getConfig('/project').vaultDir).toBe('_clean');
  });
});
