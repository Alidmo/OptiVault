import { describe, it, expect } from 'vitest';
import { formatVaultNote } from './formatter.js';
import type { ParseResult } from '../ast/parser.js';

describe('formatVaultNote', () => {
  const baseParsed: ParseResult = {
    filePath: 'src/auth.ts',
    deps: ['database', 'crypto'],
    exports: ['verifyToken(token: string): Promise<boolean>', 'hashPwd(plain: string): string'],
  };

  it('produces the exact TOON + Signatures format for the basic case', () => {
    const result = formatVaultNote(baseParsed);
    const expected = [
      '---',
      'tgt: src/auth.ts',
      'dep: [[database]], [[crypto]]',
      'exp: [verifyToken(token: string): Promise<boolean>, hashPwd(plain: string): string]',
      '---',
      '## Signatures',
      '- `verifyToken(token: string): Promise<boolean>`',
      '- `hashPwd(plain: string): string`',
    ].join('\n');

    expect(result).toBe(expected);
  });

  it('omits the dep line when deps array is empty', () => {
    const parsed: ParseResult = { ...baseParsed, deps: [] };
    const result = formatVaultNote(parsed);

    expect(result).not.toContain('dep:');
    expect(result).toContain('tgt: src/auth.ts');
    expect(result).toContain('## Signatures');
  });

  it('omits the exp line and Signatures section when exports array is empty', () => {
    const parsed: ParseResult = { ...baseParsed, exports: [] };
    const result = formatVaultNote(parsed);

    expect(result).not.toContain('exp:');
    expect(result).not.toContain('## Signatures');
    expect(result).toContain('tgt: src/auth.ts');
    expect(result).toContain('dep: [[database]], [[crypto]]');
  });

  it('appends a notes line prefixed with "! " when notes are provided', () => {
    const notes = 'Keep fast. No net calls in verifyToken. Rely Redis.';
    const result = formatVaultNote(baseParsed, notes);

    expect(result).toContain(`! ${notes}`);
    // Notes line must be after the signatures section
    const lines = result.split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBe(`! ${notes}`);
  });

  it('produces Signatures section when exports are present', () => {
    const result = formatVaultNote(baseParsed);

    expect(result).toContain('## Signatures');
    expect(result).toContain('- `verifyToken(token: string): Promise<boolean>`');
    expect(result).toContain('- `hashPwd(plain: string): string`');
  });

  it('formats a single dep correctly without trailing comma', () => {
    const parsed: ParseResult = { ...baseParsed, deps: ['database'] };
    const result = formatVaultNote(parsed);

    expect(result).toContain('dep: [[database]]');
    expect(result).not.toContain('[[database]],');
  });

  it('omits notes line when notes is undefined', () => {
    const result = formatVaultNote(baseParsed, undefined);

    expect(result).not.toContain('!');
  });

  it('omits notes line when notes is an empty string', () => {
    const result = formatVaultNote(baseParsed, '');

    expect(result).not.toContain('!');
  });
});
