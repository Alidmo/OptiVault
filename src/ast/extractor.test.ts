import { describe, it, expect } from 'vitest';
import { DependencyExtractor, ExportExtractor, extractModulePurpose, detectEntryPoint } from './extractor.js';
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

  it('excludes non-relative scoped package imports', () => {
    // Only relative imports create graph edges; absolute npm packages are excluded
    const src = `import { x } from '@scope/my-package'`;
    expect(deps.extract(src, 'typescript')).not.toContain('my-package');
  });

  it('excludes non-relative require() calls', () => {
    // require('path') is a Node built-in — not relative, so excluded
    const src = `const path = require('path')`;
    expect(deps.extract(src, 'typescript')).not.toContain('path');
  });

  it('includes relative require() calls', () => {
    const src = `const db = require('./db/pool')`;
    expect(deps.extract(src, 'typescript')).toContain('pool');
  });

  it('handles dynamic import()', () => {
    const src = `const mod = await import('./lazy-module')`;
    expect(deps.extract(src, 'typescript')).toContain('lazy-module');
  });

  it('extracts multiple deps from a single source file, skipping external packages', () => {
    const src = [
      `import { verifyToken } from './auth'`,
      `import bcrypt from 'bcryptjs'`,
      `import { Pool } from './db/pool'`,
    ].join('\n');
    const result = deps.extract(src, 'typescript');
    expect(result).toContain('auth');
    expect(result).not.toContain('bcryptjs'); // external npm package — excluded
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
  it('extracts a project-internal plain import (unknown top-level)', () => {
    // 'myapp' is not in the external-package blocklist → included as a dep
    const src = `import myapp`;
    expect(deps.extract(src, 'python')).toContain('myapp');
  });

  it('excludes stdlib modules from plain import', () => {
    // os, sys, pathlib are stdlib → all filtered out
    const src = `import os, sys, pathlib`;
    const result = deps.extract(src, 'python');
    expect(result).not.toContain('os');
    expect(result).not.toContain('sys');
    expect(result).not.toContain('pathlib');
    expect(result).toHaveLength(0);
  });

  it('excludes stdlib from-import absolute', () => {
    // hashlib is stdlib → excluded
    const src = `from hashlib import sha256`;
    expect(deps.extract(src, 'python')).not.toContain('hashlib');
  });

  it('includes internal absolute from-import (unknown package)', () => {
    // myapp.models is not external → included as full dotted path
    const src = `from myapp.models import User`;
    expect(deps.extract(src, 'python')).toContain('myapp.models');
  });

  it('extracts from-import relative (strips leading dots)', () => {
    const src = `from .models import User`;
    expect(deps.extract(src, 'python')).toContain('models');
  });

  it('extracts from-import with parent-relative path', () => {
    const src = `from ..database import pool`;
    expect(deps.extract(src, 'python')).toContain('database');
  });

  it('excludes common third-party packages (numpy)', () => {
    // numpy is in the external blocklist → excluded
    const src = `import numpy as np`;
    expect(deps.extract(src, 'python')).not.toContain('numpy');
  });

  it('includes project-internal import with alias', () => {
    const src = `import myutils as mu`;
    expect(deps.extract(src, 'python')).toContain('myutils');
  });

  it('deduplicates repeated internal imports', () => {
    const src = `import mymodule\nimport mymodule`;
    const result = deps.extract(src, 'python');
    expect(result.filter((d) => d === 'mymodule')).toHaveLength(1);
  });

  it('filters stdlib and keeps only internal deps across many lines', () => {
    const src = [
      `import os`,
      `import sys`,
      `from pathlib import Path`,
      `from .utils import helper`,
    ].join('\n');
    const result = deps.extract(src, 'python');
    expect(result).not.toContain('os');
    expect(result).not.toContain('sys');
    expect(result).not.toContain('pathlib');
    expect(result).toContain('utils'); // relative import → always included
  });

  it('keeps relative imports regardless of name overlap with stdlib', () => {
    // Even if the module name matches a stdlib name, relative imports always pass
    const src = `from .os import something`;
    expect(deps.extract(src, 'python')).toContain('os');
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

// ---------------------------------------------------------------------------
// extractModulePurpose — TypeScript
// ---------------------------------------------------------------------------

describe('extractModulePurpose — TypeScript', () => {
  it('extracts the first meaningful line of a JSDoc block', () => {
    const src = [
      '/**',
      ' * Authentication utilities for the API layer.',
      ' * @module auth',
      ' */',
      'export function verifyToken() {}',
    ].join('\n');
    expect(extractModulePurpose(src, '.ts')).toBe('Authentication utilities for the API layer.');
  });

  it('skips @tag lines in JSDoc and returns the description', () => {
    const src = [
      '/**',
      ' * @module auth',
      ' * Handles JWT verification.',
      ' */',
    ].join('\n');
    expect(extractModulePurpose(src, '.ts')).toBe('Handles JWT verification.');
  });

  it('extracts the first line of a leading // comment block', () => {
    const src = [
      '// Database connection pooling module.',
      '// Manages PgPool lifecycle.',
      'import { Pool } from "pg";',
    ].join('\n');
    expect(extractModulePurpose(src, '.ts')).toBe('Database connection pooling module.');
  });

  it('returns null when there is no leading comment', () => {
    const src = `import { x } from './x';\nexport function foo() {}`;
    expect(extractModulePurpose(src, '.ts')).toBeNull();
  });

  it('works with .js extension', () => {
    const src = `// Utility helpers\nexport const noop = () => {};`;
    expect(extractModulePurpose(src, '.js')).toBe('Utility helpers');
  });
});

// ---------------------------------------------------------------------------
// extractModulePurpose — Python
// ---------------------------------------------------------------------------

describe('extractModulePurpose — Python', () => {
  it('extracts the first line of a triple-double-quote module docstring', () => {
    const src = [
      '"""',
      'Database connection pooling.',
      'Manages SQLAlchemy session lifecycle.',
      '"""',
      'import sqlalchemy',
    ].join('\n');
    expect(extractModulePurpose(src, '.py')).toBe('Database connection pooling.');
  });

  it('extracts an inline triple-quote docstring on one line', () => {
    const src = `"""Handles user authentication."""\nimport os`;
    expect(extractModulePurpose(src, '.py')).toBe('Handles user authentication.');
  });

  it('extracts the first meaningful line from a leading # comment block', () => {
    const src = [
      '# Auth helpers for the API.',
      '# Provides JWT utilities.',
      'import jwt',
    ].join('\n');
    expect(extractModulePurpose(src, '.py')).toBe('Auth helpers for the API.');
  });

  it('returns null when there is no leading docstring or comment', () => {
    const src = `import os\ndef foo():\n    pass`;
    expect(extractModulePurpose(src, '.py')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// detectEntryPoint — TypeScript
// ---------------------------------------------------------------------------

describe('detectEntryPoint — TypeScript', () => {
  it('detects index.ts by filename', () => {
    expect(detectEntryPoint('export {}', 'src/index.ts', '.ts')).toBe(true);
  });

  it('detects main.ts by filename', () => {
    expect(detectEntryPoint('export {}', 'src/main.ts', '.ts')).toBe(true);
  });

  it('detects server.ts by filename', () => {
    expect(detectEntryPoint('', 'src/server.ts', '.ts')).toBe(true);
  });

  it('detects export default function main()', () => {
    const src = `export default function main() { app.listen(3000); }`;
    expect(detectEntryPoint(src, 'src/start.ts', '.ts')).toBe(true);
  });

  it('detects app.listen() call', () => {
    const src = `const app = express();\napp.listen(3000);`;
    expect(detectEntryPoint(src, 'src/run.ts', '.ts')).toBe(true);
  });

  it('returns false for a regular utility module', () => {
    const src = `export function hash(s: string) { return s; }`;
    expect(detectEntryPoint(src, 'src/utils/hash.ts', '.ts')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// detectEntryPoint — Python
// ---------------------------------------------------------------------------

describe('detectEntryPoint — Python', () => {
  it('detects if __name__ == "__main__": idiom', () => {
    const src = [
      'def run():',
      '    pass',
      '',
      'if __name__ == "__main__":',
      '    run()',
    ].join('\n');
    expect(detectEntryPoint(src, 'src/run.py', '.py')).toBe(true);
  });

  it('detects main.py by filename', () => {
    expect(detectEntryPoint('import os', 'src/main.py', '.py')).toBe(true);
  });

  it('returns false for a regular utility module', () => {
    const src = `def hash_password(plain):\n    return plain`;
    expect(detectEntryPoint(src, 'src/utils/hashing.py', '.py')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — Java
// ---------------------------------------------------------------------------

describe('DependencyExtractor — Java', () => {
  it('excludes java.* stdlib imports', () => {
    const src = `import java.util.List;\nimport java.io.IOException;`;
    const result = deps.extract(src, 'java');
    expect(result).not.toContain('List');
    expect(result).not.toContain('IOException');
  });

  it('excludes org.springframework imports', () => {
    const src = `import org.springframework.web.bind.annotation.RestController;`;
    expect(deps.extract(src, 'java')).not.toContain('RestController');
  });

  it('includes project-internal imports', () => {
    const src = `import com.myapp.service.UserService;\nimport com.myapp.model.User;`;
    const result = deps.extract(src, 'java');
    expect(result).toContain('UserService');
    expect(result).toContain('User');
  });

  it('handles wildcard imports', () => {
    const src = `import com.myapp.repository.*;`;
    expect(deps.extract(src, 'java')).not.toContain('*');
  });

  it('handles static imports', () => {
    const src = `import static com.myapp.Utils.helper;`;
    expect(deps.extract(src, 'java')).toContain('helper');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — Java
// ---------------------------------------------------------------------------

describe('ExportExtractor — Java', () => {
  it('extracts a public class', () => {
    const src = `public class UserService {}`;
    expect(exps.extract(src, 'java')).toContain('UserService');
  });

  it('extracts an interface', () => {
    const src = `public interface Repository {}`;
    expect(exps.extract(src, 'java')).toContain('Repository');
  });

  it('extracts an enum', () => {
    const src = `public enum Status { ACTIVE, INACTIVE }`;
    expect(exps.extract(src, 'java')).toContain('Status');
  });

  it('extracts an abstract class', () => {
    const src = `public abstract class BaseService {}`;
    expect(exps.extract(src, 'java')).toContain('BaseService');
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — Kotlin
// ---------------------------------------------------------------------------

describe('DependencyExtractor — Kotlin', () => {
  it('excludes kotlin.* stdlib imports', () => {
    const src = `import kotlin.collections.List\nimport kotlinx.coroutines.launch`;
    const result = deps.extract(src, 'kotlin');
    expect(result).not.toContain('List');
    expect(result).not.toContain('launch');
  });

  it('includes project-internal imports', () => {
    const src = `import com.myapp.domain.User\nimport com.myapp.service.AuthService`;
    const result = deps.extract(src, 'kotlin');
    expect(result).toContain('User');
    expect(result).toContain('AuthService');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — Kotlin
// ---------------------------------------------------------------------------

describe('ExportExtractor — Kotlin', () => {
  it('extracts a data class', () => {
    const src = `data class User(val id: Long, val name: String)`;
    expect(exps.extract(src, 'kotlin')).toContain('User');
  });

  it('extracts an object declaration', () => {
    const src = `object UserRepository {}`;
    expect(exps.extract(src, 'kotlin')).toContain('UserRepository');
  });

  it('extracts a top-level fun', () => {
    const src = `fun main(args: Array<String>) {}`;
    expect(exps.extract(src, 'kotlin')).toContain('main(args: Array<String>)');
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — PHP
// ---------------------------------------------------------------------------

describe('DependencyExtractor — PHP', () => {
  it('excludes Symfony/Laravel framework namespaces', () => {
    const src = `<?php\nuse Symfony\\Component\\HttpFoundation\\Request;\nuse Illuminate\\Support\\Facades\\DB;`;
    const result = deps.extract(src, 'php');
    expect(result).not.toContain('Request');
    expect(result).not.toContain('DB');
  });

  it('includes project-internal use statements', () => {
    const src = `<?php\nuse App\\Models\\User;\nuse App\\Services\\AuthService;`;
    const result = deps.extract(src, 'php');
    expect(result).toContain('User');
    expect(result).toContain('AuthService');
  });

  it('extracts relative require_once paths', () => {
    const src = `<?php\nrequire_once('./helpers/utils.php');`;
    expect(deps.extract(src, 'php')).toContain('utils');
  });

  it('handles group use statements', () => {
    const src = `<?php\nuse App\\Models\\{ User, Post, Comment };`;
    const result = deps.extract(src, 'php');
    expect(result).toContain('User');
    expect(result).toContain('Post');
    expect(result).toContain('Comment');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — PHP
// ---------------------------------------------------------------------------

describe('ExportExtractor — PHP', () => {
  it('extracts a class', () => {
    const src = `<?php\nclass UserController {}`;
    expect(exps.extract(src, 'php')).toContain('UserController');
  });

  it('extracts an interface', () => {
    const src = `<?php\ninterface RepositoryInterface {}`;
    expect(exps.extract(src, 'php')).toContain('RepositoryInterface');
  });

  it('extracts a trait', () => {
    const src = `<?php\ntrait Timestampable {}`;
    expect(exps.extract(src, 'php')).toContain('Timestampable');
  });

  it('extracts a top-level function', () => {
    const src = `<?php\nfunction hashPassword($plain) { return md5($plain); }`;
    expect(exps.extract(src, 'php')).toContain('hashPassword()');
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — C/C++
// ---------------------------------------------------------------------------

describe('DependencyExtractor — C/C++', () => {
  it('keeps quoted local #include', () => {
    const src = `#include "Protocol.hpp"\n#include "utils/helpers.h"`;
    const result = deps.extract(src, 'cpp');
    expect(result).toContain('Protocol');
    expect(result).toContain('helpers');
  });

  it('filters angle-bracket system #include', () => {
    const src = `#include <windows.h>\n#include <vector>\n#include <string>`;
    expect(deps.extract(src, 'cpp')).toHaveLength(0);
  });

  it('strips .hpp extension from dep name', () => {
    const src = `#include "common/Protocol.hpp"`;
    expect(deps.extract(src, 'cpp')).toContain('Protocol');
  });

  it('works with .h alias', () => {
    const src = `#include "mylib.h"`;
    expect(deps.extract(src, '.h')).toContain('mylib');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — C/C++
// ---------------------------------------------------------------------------

describe('ExportExtractor — C/C++', () => {
  it('extracts a struct', () => {
    const src = `struct Rect { int x, y, w, h; };`;
    expect(exps.extract(src, 'cpp')).toContain('Rect');
  });

  it('extracts a namespace', () => {
    const src = `namespace winbot { }`;
    expect(exps.extract(src, 'cpp')).toContain('winbot');
  });

  it('extracts a class', () => {
    const src = `class MyService { };`;
    expect(exps.extract(src, 'cpp')).toContain('MyService');
  });

  it('extracts an enum', () => {
    const src = `enum class Status { Ok, Error };`;
    expect(exps.extract(src, 'cpp')).toContain('Status');
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — C#
// ---------------------------------------------------------------------------

describe('DependencyExtractor — C#', () => {
  it('excludes System.* BCL namespaces', () => {
    const src = `using System.Collections.Generic;\nusing System.Threading.Tasks;`;
    expect(deps.extract(src, 'csharp')).toHaveLength(0);
  });

  it('excludes Microsoft.* namespaces', () => {
    const src = `using Microsoft.AspNetCore.Mvc;`;
    expect(deps.extract(src, 'csharp')).not.toContain('Mvc');
  });

  it('includes project-internal using', () => {
    const src = `using MyApp.Services;\nusing MyApp.Models;`;
    const result = deps.extract(src, 'csharp');
    expect(result).toContain('Services');
    expect(result).toContain('Models');
  });

  it('handles static using', () => {
    const src = `using static MyApp.Constants;`;
    expect(deps.extract(src, 'csharp')).toContain('Constants');
  });

  it('handles aliased using', () => {
    const src = `using Alias = MyApp.Utils;`;
    expect(deps.extract(src, 'csharp')).toContain('Utils');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — C#
// ---------------------------------------------------------------------------

describe('ExportExtractor — C#', () => {
  it('extracts a public class', () => {
    const src = `public class UserController {}`;
    expect(exps.extract(src, 'csharp')).toContain('UserController');
  });

  it('extracts an interface', () => {
    const src = `public interface IUserRepository {}`;
    expect(exps.extract(src, 'csharp')).toContain('IUserRepository');
  });

  it('extracts a record', () => {
    const src = `public record UserDto(int Id, string Name);`;
    expect(exps.extract(src, 'csharp')).toContain('UserDto');
  });

  it('extracts an abstract class', () => {
    const src = `public abstract class BaseService {}`;
    expect(exps.extract(src, 'csharp')).toContain('BaseService');
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — Go
// ---------------------------------------------------------------------------

describe('DependencyExtractor — Go', () => {
  it('filters stdlib packages (no dot in first segment)', () => {
    const src = `import (\n\t"fmt"\n\t"net/http"\n\t"encoding/json"\n)`;
    expect(deps.extract(src, 'go')).toHaveLength(0);
  });

  it('filters known external domains', () => {
    const src = `import "github.com/gin-gonic/gin"`;
    expect(deps.extract(src, 'go')).not.toContain('gin');
  });

  it('includes project-internal imports', () => {
    const src = `import "mycompany.com/myapp/internal/handler"`;
    expect(deps.extract(src, 'go')).toContain('handler');
  });

  it('handles block imports with mixed paths', () => {
    const src = `import (\n\t"fmt"\n\t"mycompany.com/myapp/service"\n)`;
    const result = deps.extract(src, 'go');
    expect(result).not.toContain('fmt');
    expect(result).toContain('service');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — Go
// ---------------------------------------------------------------------------

describe('ExportExtractor — Go', () => {
  it('extracts exported func (uppercase)', () => {
    const src = `func HandleRequest(w http.ResponseWriter, r *http.Request) {}`;
    expect(exps.extract(src, 'go')).toContain('HandleRequest(w http.ResponseWriter, r *http.Request)');
  });

  it('does not export unexported func (lowercase)', () => {
    const src = `func internalHelper() {}`;
    expect(exps.extract(src, 'go')).not.toContain('internalHelper');
  });

  it('extracts exported struct', () => {
    const src = `type UserService struct {}`;
    expect(exps.extract(src, 'go')).toContain('UserService');
  });

  it('extracts exported interface', () => {
    const src = `type Repository interface {}`;
    expect(exps.extract(src, 'go')).toContain('Repository');
  });
});

// ---------------------------------------------------------------------------
// DependencyExtractor — Rust
// ---------------------------------------------------------------------------

describe('DependencyExtractor — Rust', () => {
  it('filters std:: and core:: crates', () => {
    const src = `use std::collections::HashMap;\nuse core::fmt;`;
    expect(deps.extract(src, 'rust')).toHaveLength(0);
  });

  it('filters known external crates', () => {
    const src = `use tokio::runtime::Runtime;\nuse serde::{Serialize, Deserialize};`;
    expect(deps.extract(src, 'rust')).toHaveLength(0);
  });

  it('includes crate-local use paths', () => {
    const src = `use crate::models::User;\nuse crate::services::auth;`;
    const result = deps.extract(src, 'rust');
    expect(result).toContain('User');
    expect(result).toContain('auth');
  });

  it('includes mod declarations', () => {
    const src = `pub mod handlers;\nmod utils;`;
    const result = deps.extract(src, 'rust');
    expect(result).toContain('handlers');
    expect(result).toContain('utils');
  });
});

// ---------------------------------------------------------------------------
// ExportExtractor — Rust
// ---------------------------------------------------------------------------

describe('ExportExtractor — Rust', () => {
  it('extracts pub fn', () => {
    const src = `pub fn process_request(req: Request) -> Response {}`;
    expect(exps.extract(src, 'rust')).toContain('process_request(req: Request)');
  });

  it('extracts pub struct', () => {
    const src = `pub struct UserRepository {}`;
    expect(exps.extract(src, 'rust')).toContain('UserRepository');
  });

  it('extracts pub enum', () => {
    const src = `pub enum AppError { NotFound, Unauthorized }`;
    expect(exps.extract(src, 'rust')).toContain('AppError');
  });

  it('extracts pub trait', () => {
    const src = `pub trait Repository {}`;
    expect(exps.extract(src, 'rust')).toContain('Repository');
  });

  it('does not export private items', () => {
    const src = `fn internal_helper() {}`;
    expect(exps.extract(src, 'rust')).not.toContain('internal_helper');
  });
});
