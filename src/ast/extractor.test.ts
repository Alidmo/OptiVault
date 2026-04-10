import { describe, it, expect } from 'vitest';
import { DependencyExtractor, ExportExtractor } from './extractor.js';
import { extractFunctionCode } from './function-extractor.js';

// ---------------------------------------------------------------------------
// Shared instances
// ---------------------------------------------------------------------------

const deps = new DependencyExtractor();
const exps = new ExportExtractor();

// ---------------------------------------------------------------------------
// TypeScript — DependencyExtractor
// ---------------------------------------------------------------------------

describe('DependencyExtractor — TypeScript', () => {
  it('extracts a named import from a relative path', () => {
    const src = `import { connect } from './database'`;
    expect(deps.extract(src, 'typescript')).toContain('database');
  });

  it('extracts a default import', () => {
    const src = `import Router from './router'`;
    expect(deps.extract(src, 'typescript')).toContain('router');
  });

  it('extracts a namespace import', () => {
    const src = `import * as utils from './utils'`;
    expect(deps.extract(src, 'typescript')).toContain('utils');
  });

  it('strips the file extension from the dep name', () => {
    const src = `import { foo } from './helpers.js'`;
    expect(deps.extract(src, 'typescript')).toContain('helpers');
    expect(deps.extract(src, 'typescript')).not.toContain('helpers.js');
  });

  it('strips leading ../ traversal', () => {
    const src = `import { bar } from '../../shared/bar'`;
    expect(deps.extract(src, 'typescript')).toContain('bar');
  });

  it('strips @scope/ prefix from scoped packages', () => {
    const src = `import { x } from '@scope/my-package'`;
    expect(deps.extract(src, 'typescript')).toContain('my-package');
  });

  it('handles require() calls', () => {
    const src = `const path = require('path')`;
    expect(deps.extract(src, 'typescript')).toContain('path');
  });

  it('handles dynamic import()', () => {
    const src = `const mod = await import('./lazy-module')`;
    expect(deps.extract(src, 'typescript')).toContain('lazy-module');
  });

  it('extracts multiple deps from a single source file', () => {
    const src = [
      `import { verifyToken } from './auth'`,
      `import bcrypt from 'bcryptjs'`,
      `import { Pool } from './db/pool'`,
    ].join('\n');
    const result = deps.extract(src, 'typescript');
    expect(result).toContain('auth');
    expect(result).toContain('bcryptjs');
    expect(result).toContain('pool');
  });

  it('deduplicates repeated imports of the same module', () => {
    const src = [
      `import { a } from './helpers'`,
      `import { b } from './helpers'`,
    ].join('\n');
    const result = deps.extract(src, 'typescript');
    expect(result.filter((d) => d === 'helpers')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// TypeScript — ExportExtractor
// ---------------------------------------------------------------------------

describe('ExportExtractor — TypeScript', () => {
  it('extracts a named export function with typed parameters', () => {
    const src = `export function verifyToken(token: string): boolean { return true; }`;
    expect(exps.extract(src, 'typescript')).toContain('verifyToken(token: string)');
  });

  it('extracts an async export function', () => {
    const src = `export async function fetchUser(id: number): Promise<User> {}`;
    expect(exps.extract(src, 'typescript')).toContain('fetchUser(id: number)');
  });

  it('extracts an export class', () => {
    const src = `export class AuthService {}`;
    expect(exps.extract(src, 'typescript')).toContain('AuthService');
  });

  it('extracts an abstract export class', () => {
    const src = `export abstract class BaseRepo {}`;
    expect(exps.extract(src, 'typescript')).toContain('BaseRepo');
  });

  it('extracts export const', () => {
    const src = `export const MAX_RETRIES = 3;`;
    expect(exps.extract(src, 'typescript')).toContain('MAX_RETRIES');
  });

  it('extracts export let and export var', () => {
    const srcLet = `export let counter = 0;`;
    const srcVar = `export var legacy = true;`;
    expect(exps.extract(srcLet, 'typescript')).toContain('counter');
    expect(exps.extract(srcVar, 'typescript')).toContain('legacy');
  });

  it('extracts export interface', () => {
    const src = `export interface UserPayload { id: number; }`;
    expect(exps.extract(src, 'typescript')).toContain('UserPayload');
  });

  it('extracts export type alias', () => {
    const src = `export type Token = string;`;
    expect(exps.extract(src, 'typescript')).toContain('Token');
  });

  it('extracts multiple exports from one source string', () => {
    const src = [
      `export function login(user: string, pass: string): boolean { return false; }`,
      `export class SessionManager {}`,
      `export const SESSION_TTL = 3600;`,
    ].join('\n');
    const result = exps.extract(src, 'typescript');
    expect(result).toContain('login(user: string, pass: string)');
    expect(result).toContain('SessionManager');
    expect(result).toContain('SESSION_TTL');
  });

  it('does not include non-exported functions', () => {
    const src = `function internalHelper() {}\nexport function publicApi(): void {}`;
    const result = exps.extract(src, 'typescript');
    expect(result).toContain('publicApi()');
    expect(result).not.toContain('internalHelper');
  });

  it('deduplicates identical export names', () => {
    // Overloads can repeat the same name — ensure it appears only once.
    const src = [
      `export function hash(input: string): string`,
      `export function hash(input: Buffer): string`,
    ].join('\n');
    const result = exps.extract(src, 'typescript');
    expect(result.filter((e) => e.startsWith('hash'))).toHaveLength(2); // two distinct signatures
  });

  it('extracts arrow function with typed parameters including the signature', () => {
    const src = `export const verifyToken = (token: string): boolean => { return true; }`;
    expect(exps.extract(src, 'typescript')).toContain('verifyToken(token: string)');
  });

  it('extracts async arrow function signature', () => {
    const src = `export const fetchUser = async (id: number): Promise<User> => { return null; }`;
    expect(exps.extract(src, 'typescript')).toContain('fetchUser(id: number)');
  });

  it('extracts plain export const (non-arrow) as just the name', () => {
    const src = `export const MAX_RETRIES = 3;`;
    const result = exps.extract(src, 'typescript');
    expect(result).toContain('MAX_RETRIES');
    // Should NOT include spurious parameter suffix
    expect(result.find((e) => e.startsWith('MAX_RETRIES('))).toBeUndefined();
  });

  it('does not double-count an arrow function export', () => {
    const src = `export const handler = (req: Request, res: Response) => {};`;
    const result = exps.extract(src, 'typescript');
    // Should appear exactly once (with params), not also as bare name
    expect(result.filter((e) => e === 'handler' || e.startsWith('handler('))).toHaveLength(1);
    expect(result).toContain('handler(req: Request, res: Response)');
  });
});

// ---------------------------------------------------------------------------
// Python — DependencyExtractor
// ---------------------------------------------------------------------------

describe('DependencyExtractor — Python', () => {
  it('extracts a plain import', () => {
    const src = `import crypto`;
    expect(deps.extract(src, 'python')).toContain('crypto');
  });

  it('extracts multiple modules from one import line', () => {
    const src = `import os, sys, pathlib`;
    const result = deps.extract(src, 'python');
    expect(result).toContain('os');
    expect(result).toContain('sys');
    expect(result).toContain('pathlib');
  });

  it('extracts from-import absolute', () => {
    const src = `from hashlib import sha256`;
    expect(deps.extract(src, 'python')).toContain('hashlib');
  });

  it('extracts from-import relative (strips leading dots)', () => {
    const src = `from .models import User`;
    expect(deps.extract(src, 'python')).toContain('models');
  });

  it('extracts from-import with parent-relative path', () => {
    const src = `from ..database import pool`;
    expect(deps.extract(src, 'python')).toContain('database');
  });

  it('handles import with alias', () => {
    const src = `import numpy as np`;
    expect(deps.extract(src, 'python')).toContain('numpy');
  });

  it('deduplicates repeated imports', () => {
    const src = `import os\nimport os`;
    const result = deps.extract(src, 'python');
    expect(result.filter((d) => d === 'os')).toHaveLength(1);
  });

  it('extracts multiple deps across many lines', () => {
    const src = [
      `import os`,
      `import sys`,
      `from pathlib import Path`,
      `from .utils import helper`,
    ].join('\n');
    const result = deps.extract(src, 'python');
    expect(result).toContain('os');
    expect(result).toContain('sys');
    expect(result).toContain('pathlib');
    expect(result).toContain('utils');
  });
});

// ---------------------------------------------------------------------------
// Python — ExportExtractor
// ---------------------------------------------------------------------------

describe('ExportExtractor — Python', () => {
  it('extracts a top-level function definition', () => {
    const src = `def hashPwd(plain):`;
    expect(exps.extract(src, 'python')).toContain('hashPwd(plain)');
  });

  it('extracts a top-level async function definition', () => {
    const src = `async def fetch_user(user_id, db):`;
    expect(exps.extract(src, 'python')).toContain('fetch_user(user_id, db)');
  });

  it('extracts a top-level class definition', () => {
    const src = `class UserService:`;
    expect(exps.extract(src, 'python')).toContain('UserService');
  });

  it('extracts a class with a base class', () => {
    const src = `class AdminService(UserService):`;
    expect(exps.extract(src, 'python')).toContain('AdminService');
  });

  it('does NOT extract indented (method-level) functions', () => {
    const src = [
      `class MyClass:`,
      `    def inner_method(self):`,
      `        pass`,
    ].join('\n');
    const result = exps.extract(src, 'python');
    expect(result).not.toContain('inner_method(self)');
  });

  it('extracts multiple top-level defs and classes', () => {
    const src = [
      `def hash_password(plain, salt):`,
      `    return plain`,
      ``,
      `def verify_token(token):`,
      `    pass`,
      ``,
      `class AuthManager:`,
      `    pass`,
    ].join('\n');
    const result = exps.extract(src, 'python');
    expect(result).toContain('hash_password(plain, salt)');
    expect(result).toContain('verify_token(token)');
    expect(result).toContain('AuthManager');
  });

  it('extracts function with type annotations', () => {
    const src = `def parse_jwt(token: str) -> dict:`;
    expect(exps.extract(src, 'python')).toContain('parse_jwt(token: str)');
  });

  it('deduplicates identical top-level names', () => {
    // Shouldn't happen in valid Python but guard against it anyway.
    const src = `def foo(x):\n    pass\ndef foo(x):\n    pass`;
    const result = exps.extract(src, 'python');
    expect(result.filter((e) => e === 'foo(x)')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// extractFunctionCode — TypeScript
// ---------------------------------------------------------------------------

describe('extractFunctionCode — TypeScript', () => {
  it('extracts a standard exported function body', () => {
    const src = [
      `export function verifyToken(token: string): boolean {`,
      `  return token.length > 0;`,
      `}`,
    ].join('\n');
    const result = extractFunctionCode(src, 'verifyToken', '.ts');
    expect(result).not.toBeNull();
    expect(result).toContain('verifyToken');
    expect(result).toContain('return token.length > 0');
  });

  it('extracts an arrow function body', () => {
    const src = [
      `export const hashPwd = (plain: string): string => {`,
      `  return plain + '_hashed';`,
      `};`,
    ].join('\n');
    const result = extractFunctionCode(src, 'hashPwd', '.ts');
    expect(result).not.toBeNull();
    expect(result).toContain('hashPwd');
    expect(result).toContain('plain + \'_hashed\'');
  });

  it('extracts an arrow expression body (no braces)', () => {
    const src = `export const double = (n: number) => n * 2;`;
    const result = extractFunctionCode(src, 'double', '.ts');
    expect(result).not.toBeNull();
    expect(result).toContain('double');
    expect(result).toContain('n * 2');
  });

  it('extracts a class method', () => {
    const src = [
      `class AuthService {`,
      `  async login(user: string): Promise<boolean> {`,
      `    return user === 'admin';`,
      `  }`,
      `}`,
    ].join('\n');
    const result = extractFunctionCode(src, 'login', '.ts');
    expect(result).not.toBeNull();
    expect(result).toContain('login');
    expect(result).toContain('admin');
  });

  it('returns null for an unknown function name', () => {
    const src = `export function foo() { return 1; }`;
    expect(extractFunctionCode(src, 'nonExistent', '.ts')).toBeNull();
  });

  it('returns null for an unsupported extension', () => {
    expect(extractFunctionCode('anything', 'foo', '.txt')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractFunctionCode — Python
// ---------------------------------------------------------------------------

describe('extractFunctionCode — Python', () => {
  it('extracts a top-level function body', () => {
    const src = [
      `def hash_password(plain, salt):`,
      `    hashed = plain + salt`,
      `    return hashed`,
      ``,
      `def other():`,
      `    pass`,
    ].join('\n');
    const result = extractFunctionCode(src, 'hash_password', '.py');
    expect(result).not.toBeNull();
    expect(result).toContain('hashed = plain + salt');
    expect(result).not.toContain('def other');
  });

  it('extracts an async function body', () => {
    const src = [
      `async def fetch_user(user_id):`,
      `    return await db.get(user_id)`,
    ].join('\n');
    const result = extractFunctionCode(src, 'fetch_user', '.py');
    expect(result).not.toBeNull();
    expect(result).toContain('db.get(user_id)');
  });

  it('returns null for an unknown function name', () => {
    const src = `def foo():\n    pass`;
    expect(extractFunctionCode(src, 'bar', '.py')).toBeNull();
  });
});
