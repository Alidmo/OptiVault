import { describe, it, expect } from 'vitest';
import { formatVaultNote } from './formatter.js';
import type { ParseResult } from '../ast/parser.js';

describe('formatVaultNote', () => {
  const baseParsed: ParseResult = {
    filePath: 'src/auth.ts',
    deps: ['database', 'crypto'],
    exports: ['verifyToken(token: string): Promise<boolean>', 'hashPwd(plain: string): string'],
  };

  it('produces the YAML frontmatter + Inputs/Outputs format for the basic case', () => {
    const result = formatVaultNote(baseParsed);
    const expected = [
      '---',
      'tgt: src/auth.ts',
      'dep: [[database]], [[crypto]]',
      'exp: [verifyToken(token: string): Promise<boolean>, hashPwd(plain: string): string]',
      '---',
      '## Inputs',
      'Imports:: [[database]], [[crypto]]',
      '## Outputs',
      'Provides:: `verifyToken(token: string): Promise<boolean>`',
      'Provides:: `hashPwd(plain: string): string`',
    ].join('\n');

    expect(result).toBe(expected);
  });

  it('omits the dep line and ## Inputs section when deps array is empty', () => {
    const parsed: ParseResult = { ...baseParsed, deps: [] };
    const result = formatVaultNote(parsed);

    expect(result).not.toContain('dep:');
    expect(result).not.toContain('## Inputs');
    expect(result).not.toContain('Imports::');
    expect(result).toContain('tgt: src/auth.ts');
    expect(result).toContain('## Outputs');
  });

  it('omits the exp line and ## Outputs section when exports array is empty', () => {
    const parsed: ParseResult = { ...baseParsed, exports: [] };
    const result = formatVaultNote(parsed);

    expect(result).not.toContain('exp:');
    expect(result).not.toContain('## Outputs');
    expect(result).not.toContain('Provides::');
    expect(result).toContain('tgt: src/auth.ts');
    expect(result).toContain('dep: [[database]], [[crypto]]');
  });

  it('appends a notes line prefixed with "! " when notes are provided', () => {
    const notes = 'Keep fast. No net calls in verifyToken. Rely Redis.';
    const result = formatVaultNote(baseParsed, notes);

    expect(result).toContain(`! ${notes}`);
    // Notes line must be after the Outputs section
    const lines = result.split('\n');
    const lastLine = lines[lines.length - 1];
    expect(lastLine).toBe(`! ${notes}`);
  });

  it('produces ## Outputs section with Provides:: lines when exports are present', () => {
    const result = formatVaultNote(baseParsed);

    expect(result).toContain('## Outputs');
    expect(result).toContain('Provides:: `verifyToken(token: string): Promise<boolean>`');
    expect(result).toContain('Provides:: `hashPwd(plain: string): string`');
  });

  it('formats a single dep correctly without trailing comma', () => {
    const parsed: ParseResult = { ...baseParsed, deps: ['database'] };
    const result = formatVaultNote(parsed);

    expect(result).toContain('dep: [[database]]');
    expect(result).not.toContain('[[database]],');
    expect(result).toContain('Imports:: [[database]]');
  });

  it('omits notes line when notes is undefined', () => {
    const result = formatVaultNote(baseParsed, undefined);

    expect(result).not.toContain('!');
  });

  it('omits notes line when notes is an empty string', () => {
    const result = formatVaultNote(baseParsed, '');

    expect(result).not.toContain('!');
  });

  // -------------------------------------------------------------------------
  // Task 1.1: Purpose in frontmatter + blockquote
  // -------------------------------------------------------------------------

  it('includes purpose in YAML frontmatter when provided', () => {
    const parsed: ParseResult = {
      ...baseParsed,
      purpose: 'Handles JWT authentication and password hashing',
    };
    const result = formatVaultNote(parsed);

    expect(result).toContain('purpose: "Handles JWT authentication and password hashing"');
  });

  it('renders purpose as a blockquote in the body', () => {
    const parsed: ParseResult = {
      ...baseParsed,
      purpose: 'Handles JWT authentication and password hashing',
    };
    const result = formatVaultNote(parsed);

    expect(result).toContain('> Handles JWT authentication and password hashing');
  });

  it('purpose blockquote appears before ## Inputs section', () => {
    const parsed: ParseResult = {
      ...baseParsed,
      purpose: 'Handles authentication',
    };
    const result = formatVaultNote(parsed);
    const purposeIdx = result.indexOf('> Handles authentication');
    const inputsIdx = result.indexOf('## Inputs');
    expect(purposeIdx).toBeLessThan(inputsIdx);
  });

  it('omits purpose frontmatter and blockquote when purpose is absent', () => {
    const result = formatVaultNote(baseParsed);

    expect(result).not.toContain('purpose:');
    expect(result).not.toContain('> ');
  });

  it('escapes double-quotes in purpose for valid YAML', () => {
    const parsed: ParseResult = {
      ...baseParsed,
      purpose: 'Module for "auth" handling',
    };
    const result = formatVaultNote(parsed);
    const frontmatterLines = result.split('\n').filter((l) => l.startsWith('purpose:'));
    expect(frontmatterLines).toHaveLength(1);
    // The frontmatter line must be valid (not contain a bare unescaped ")
    expect(frontmatterLines[0]).toContain('\\"auth\\"');
  });

  // -------------------------------------------------------------------------
  // Task 1.2: Entry point tagging
  // -------------------------------------------------------------------------

  it('adds type: entrypoint and tags: [entry-point] for entry point files', () => {
    const parsed: ParseResult = {
      ...baseParsed,
      isEntryPoint: true,
    };
    const result = formatVaultNote(parsed);

    expect(result).toContain('type: entrypoint');
    expect(result).toContain('tags: [entry-point]');
  });

  it('omits type and tags lines for non-entry-point files', () => {
    const result = formatVaultNote(baseParsed);

    expect(result).not.toContain('type: entrypoint');
    expect(result).not.toContain('tags: [entry-point]');
  });

  it('entry point frontmatter appears before dep line', () => {
    const parsed: ParseResult = { ...baseParsed, isEntryPoint: true };
    const result = formatVaultNote(parsed);
    const typeIdx = result.indexOf('type: entrypoint');
    const depIdx = result.indexOf('dep:');
    expect(typeIdx).toBeLessThan(depIdx);
  });

  it('combines purpose + entry-point + deps + exports correctly', () => {
    const parsed: ParseResult = {
      filePath: 'src/index.ts',
      deps: ['app'],
      exports: ['main()'],
      purpose: 'Application bootstrap',
      isEntryPoint: true,
    };
    const result = formatVaultNote(parsed);

    expect(result).toContain('purpose: "Application bootstrap"');
    expect(result).toContain('type: entrypoint');
    expect(result).toContain('tags: [entry-point]');
    expect(result).toContain('dep: [[app]]');
    expect(result).toContain('exp: [main()]');
    expect(result).toContain('> Application bootstrap');
    expect(result).toContain('Imports:: [[app]]');
    expect(result).toContain('Provides:: `main()`');
  });

  // -------------------------------------------------------------------------
  // Task 1.3: Dataview inline fields
  // -------------------------------------------------------------------------

  it('uses Imports:: Dataview inline field in ## Inputs section', () => {
    const result = formatVaultNote(baseParsed);
    expect(result).toContain('Imports:: [[database]], [[crypto]]');
  });

  it('uses Provides:: Dataview inline field in ## Outputs section', () => {
    const result = formatVaultNote(baseParsed);
    expect(result).toContain('Provides:: `verifyToken(token: string): Promise<boolean>`');
    expect(result).toContain('Provides:: `hashPwd(plain: string): string`');
  });

  it('## Inputs appears before ## Outputs in the body', () => {
    const result = formatVaultNote(baseParsed);
    const inputsIdx = result.indexOf('## Inputs');
    const outputsIdx = result.indexOf('## Outputs');
    expect(inputsIdx).toBeLessThan(outputsIdx);
  });

  // -------------------------------------------------------------------------
  // Task 2: concepts frontmatter (self-learning merge)
  // -------------------------------------------------------------------------

  it('emits concepts frontmatter line when parsed.concepts is non-empty', () => {
    const parsed: ParseResult = { ...baseParsed, concepts: ['Auth'] };
    const result = formatVaultNote(parsed);
    expect(result).toContain('concepts: [Auth]');
  });

  it('emits multi-item concepts array as bare YAML', () => {
    const parsed: ParseResult = { ...baseParsed, concepts: ['Auth', 'Checkout'] };
    const result = formatVaultNote(parsed);
    expect(result).toContain('concepts: [Auth, Checkout]');
  });

  it('omits the concepts line when concepts is undefined', () => {
    const result = formatVaultNote(baseParsed);
    expect(result).not.toContain('concepts:');
  });

  it('omits the concepts line when concepts is an empty array', () => {
    const parsed: ParseResult = { ...baseParsed, concepts: [] };
    const result = formatVaultNote(parsed);
    expect(result).not.toContain('concepts:');
  });

  it('concepts line appears after exp line in frontmatter', () => {
    const parsed: ParseResult = { ...baseParsed, concepts: ['Auth'] };
    const result = formatVaultNote(parsed);
    const expIdx = result.indexOf('exp:');
    const conceptsIdx = result.indexOf('concepts:');
    expect(expIdx).toBeLessThan(conceptsIdx);
  });
});
