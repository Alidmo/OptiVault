import { describe, it, expect } from 'vitest';
import { formatVaultNote } from './formatter.js';
import type { ParseResult } from '../ast/parser.js';
import type { FunctionSummary } from './ollama.js';

describe('formatVaultNote', () => {
  const baseParsed: ParseResult = {
    filePath: 'src/auth.ts',
    deps: ['database', 'crypto'],
    exports: ['verifyToken', 'hashPwd'],
  };

  const baseSummaries: FunctionSummary[] = [
    { signature: 'verifyToken(token)', caveman: 'Read token. Check [[database]]. Return bool.' },
    { signature: 'hashPwd(plain)', caveman: 'Salt pwd. Hash via [[crypto]]. Return string.' },
  ];

  it('produces the exact TOON + Caveman format for the basic case', () => {
    const result = formatVaultNote(baseParsed, baseSummaries);
    const expected = [
      '---',
      'tgt: src/auth.ts',
      'dep: [[database]], [[crypto]]',
      'exp: [verifyToken, hashPwd]',
      '---',
      'verifyToken(token): Read token. Check [[database]]. Return bool.',
      'hashPwd(plain): Salt pwd. Hash via [[crypto]]. Return string.',
    ].join('\n');

    expect(result).toBe(expected);
  });

  it('omits the dep line when deps array is empty', () => {
    const parsed: ParseResult = { ...baseParsed, deps: [] };
    const result = formatVaultNote(parsed, baseSummaries);

    expect(result).not.toContain('dep:');
    expect(result).toContain('tgt: src/auth.ts');
    expect(result).toContain('exp: [verifyToken, hashPwd]');
  });

  it('omits the exp line when exports array is empty', () => {
    const parsed: ParseResult = { ...baseParsed, exports: [] };
    const result = formatVaultNote(parsed, baseSummaries);

    expect(result).not.toContain('exp:');
    expect(result).toContain('tgt: src/auth.ts');
    expect(result).toContain('dep: [[database]], [[crypto]]');
  });

  it('appends a notes line prefixed with "! " when notes are provided', () => {
    const notes = 'Keep fast. No net calls in verifyToken. Rely Redis.';
    const result = formatVaultNote(baseParsed, baseSummaries, notes);

    expect(result).toContain(`! ${notes}`);
    // Notes line must be after the closing ---
    const lines = result.split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBe(`! ${notes}`);
  });

  it('produces no body lines after the closing --- when summaries is empty', () => {
    const result = formatVaultNote(baseParsed, []);
    const lines = result.split('\n');

    // Find the second '---' (closing frontmatter)
    const secondDashIndex = lines.indexOf('---', 1);
    expect(secondDashIndex).toBeGreaterThan(0);

    // Nothing should follow it
    const afterFrontmatter = lines.slice(secondDashIndex + 1);
    expect(afterFrontmatter).toHaveLength(0);
  });

  it('formats a single dep correctly without trailing comma', () => {
    const parsed: ParseResult = { ...baseParsed, deps: ['database'] };
    const result = formatVaultNote(parsed, []);

    expect(result).toContain('dep: [[database]]');
    expect(result).not.toContain('[[database]],');
  });

  it('omits notes line when notes is undefined', () => {
    const result = formatVaultNote(baseParsed, baseSummaries, undefined);

    expect(result).not.toContain('!');
  });

  it('omits notes line when notes is an empty string', () => {
    const result = formatVaultNote(baseParsed, baseSummaries, '');

    expect(result).not.toContain('!');
  });
});
