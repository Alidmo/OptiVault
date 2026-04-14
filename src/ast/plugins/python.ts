/**
 * Python Language Plugin
 *
 * Extracts dependencies and exports from Python source.
 * Handles: .py
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Remove duplicate entries while preserving insertion order. */
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * Normalise a raw import path into a wikilink-friendly dep name.
 *
 * Rules applied in order:
 *  1. Strip a leading `@scope/` segment (scoped npm packages).
 *  2. Strip leading `./` or `../` sequences.
 *  3. Strip a trailing file extension (.ts, .tsx, .js, .mjs, .py, …).
 *  4. Take only the last path component (handles `foo/bar/baz` → `baz`).
 */
function normaliseDep(raw: string): string {
  let dep = raw.trim().replace(/^['"`]|['"`]$/g, ''); // remove surrounding quotes if any

  // Remove scoped package prefix: @scope/name → name
  dep = dep.replace(/^@[^/]+\//, '');

  // Remove leading relative path segments
  dep = dep.replace(/^(?:\.\.\/|\.\/)+/, '');

  // Take only the last path segment
  const segments = dep.split('/');
  dep = segments[segments.length - 1] ?? dep;

  // Strip known file extensions
  dep = dep.replace(/\.(ts|tsx|js|mjs|cjs|py)$/, '');

  return dep;
}

// ---------------------------------------------------------------------------
// External package filter
// ---------------------------------------------------------------------------

/**
 * Python standard-library modules + ubiquitous third-party packages.
 * Imports whose top-level name appears here are excluded from the dep graph
 * so they don't create orphaned nodes in Obsidian.
 * Project-internal absolute imports (e.g. `from myapp.models import User`)
 * are kept because their top-level name won't appear in this set.
 */
const PYTHON_EXTERNAL_PACKAGES = new Set([
  // ── Standard library ──────────────────────────────────────────────────────
  '__future__', 'abc', 'aifc', 'argparse', 'array', 'ast', 'asynchat',
  'asyncio', 'asyncore', 'atexit', 'audioop', 'base64', 'bdb', 'binascii',
  'bisect', 'builtins', 'bz2', 'calendar', 'cgi', 'cgitb', 'chunk', 'cmath',
  'cmd', 'code', 'codecs', 'codeop', 'collections', 'colorsys', 'compileall',
  'concurrent', 'configparser', 'contextlib', 'contextvars', 'copy', 'copyreg',
  'cProfile', 'csv', 'ctypes', 'curses', 'dataclasses', 'datetime', 'dbm',
  'decimal', 'difflib', 'dis', 'doctest', 'email', 'encodings', 'enum',
  'errno', 'faulthandler', 'filecmp', 'fileinput', 'fnmatch', 'fractions',
  'ftplib', 'functools', 'gc', 'getopt', 'getpass', 'gettext', 'glob',
  'grp', 'gzip', 'hashlib', 'heapq', 'hmac', 'html', 'http', 'idlelib',
  'imaplib', 'importlib', 'inspect', 'io', 'ipaddress', 'itertools', 'json',
  'keyword', 'lib2to3', 'linecache', 'locale', 'logging', 'lzma', 'mailbox',
  'math', 'mimetypes', 'mmap', 'modulefinder', 'multiprocessing', 'netrc',
  'numbers', 'operator', 'optparse', 'os', 'pathlib', 'pdb', 'pickle',
  'pickletools', 'pkgutil', 'platform', 'plistlib', 'poplib', 'pprint',
  'profile', 'pstats', 'pty', 'py_compile', 'pyclbr', 'pydoc', 'queue',
  'random', 're', 'readline', 'reprlib', 'resource', 'rlcompleter', 'runpy',
  'sched', 'secrets', 'select', 'selectors', 'shelve', 'shlex', 'shutil',
  'signal', 'site', 'smtpd', 'smtplib', 'socket', 'socketserver', 'sqlite3',
  'ssl', 'stat', 'statistics', 'string', 'stringprep', 'struct', 'subprocess',
  'sys', 'sysconfig', 'tabnanny', 'tarfile', 'telnetlib', 'tempfile', 'test',
  'textwrap', 'threading', 'time', 'timeit', 'tkinter', 'token', 'tokenize',
  'tomllib', 'trace', 'traceback', 'tracemalloc', 'types', 'typing',
  'unicodedata', 'unittest', 'urllib', 'uuid', 'venv', 'warnings', 'wave',
  'weakref', 'webbrowser', 'winreg', 'winsound', 'wsgiref', 'xml', 'xmlrpc',
  'zipapp', 'zipfile', 'zipimport', 'zlib', 'zoneinfo',
  // ── Common third-party ────────────────────────────────────────────────────
  'torch', 'torchvision', 'torchaudio', 'torchmetrics',
  'numpy', 'pandas', 'scipy', 'sklearn', 'matplotlib', 'seaborn', 'plotly',
  'tensorflow', 'keras', 'transformers', 'huggingface_hub', 'datasets',
  'tokenizers', 'accelerate', 'diffusers', 'tqdm', 'einops', 'timm',
  'fastapi', 'flask', 'django', 'starlette', 'uvicorn', 'gunicorn',
  'aiohttp', 'httpx', 'requests', 'websockets', 'httptools',
  'sqlalchemy', 'alembic', 'pymongo', 'motor', 'redis', 'celery', 'kombu',
  'boto3', 'botocore', 'pydantic', 'attrs', 'marshmallow',
  'click', 'typer', 'rich', 'colorama', 'loguru',
  'pytest', 'mock', 'hypothesis', 'faker', 'factory_boy',
  'yaml', 'toml', 'dotenv', 'decouple', 'dynaconf',
  'PIL', 'cv2', 'imageio', 'skimage',
  'cryptography', 'jwt', 'passlib', 'bcrypt',
  'telegram', 'telebot', 'aiogram',
  'openai', 'anthropic', 'groq', 'langchain', 'pinecone', 'chromadb',
  'psutil', 'docker', 'paramiko', 'fabric',
  'psycopg2', 'pymysql', 'asyncpg', 'aiomysql',
  'jinja2', 'babel', 'arrow', 'dateutil', 'pytz', 'pendulum',
  'grpc', 'protobuf', 'kafka', 'pika', 'nats',
  'networkx', 'sympy', 'statsmodels',
  'scrapy', 'bs4', 'lxml', 'selenium', 'playwright',
  'stripe', 'twilio', 'sendgrid',
  'sentry_sdk', 'prometheus_client', 'datadog',
  'locust', 'pytest_asyncio',
]);

/**
 * Return true when the top-level name of an import is an external package
 * (stdlib or well-known third-party).
 */
function isExternalPythonPackage(topLevel: string): boolean {
  return PYTHON_EXTERNAL_PACKAGES.has(topLevel);
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local import dependency names from Python source text.
 *
 * Rules:
 *  - Relative imports (`from .module import`, `from ..pkg import`) are ALWAYS
 *    included — they are guaranteed to reference project-local files.
 *  - Absolute `from X import` and `import X` statements are included only when
 *    X is NOT a known external package (stdlib or common third-party), so that
 *    internal absolute imports like `from myapp.models import User` still
 *    appear as graph edges while stdlib noise (`os`, `sys`, `json`) is filtered.
 */
function extractPythonDeps(source: string): string[] {
  const deps: string[] = [];

  // from [.relative.]module import ...
  const fromImport = /^[ \t]*from\s+([\w.]+)\s+import\b/gm;
  let m: RegExpExecArray | null;
  while ((m = fromImport.exec(source)) !== null) {
    const raw = m[1];
    if (raw.startsWith('.')) {
      // Relative import — always include
      const mod = raw.replace(/^\.+/, '');
      if (mod) deps.push(normaliseDep(mod));
    } else {
      // Absolute import — include only if not an external package
      const topLevel = raw.split('.')[0] ?? raw;
      if (!isExternalPythonPackage(topLevel)) {
        deps.push(normaliseDep(raw));
      }
    }
  }

  // import module [as alias] [, module2 [as alias2] ...]
  const plainImport = /^[ \t]*import\s+([\w,\s.]+?)(?:\s*#.*)?$/gm;
  while ((m = plainImport.exec(source)) !== null) {
    const names = m[1].split(',');
    for (const name of names) {
      const base = name.trim().split(/\s+as\s+/i)[0].trim();
      const topLevel = base.split('.')[0];
      if (topLevel && !isExternalPythonPackage(topLevel)) {
        deps.push(normaliseDep(topLevel));
      }
    }
  }

  return dedupe(deps);
}

/**
 * Extract top-level function/class definitions from Python source.
 *
 * Handles:
 *  - `def name(params):`
 *  - `async def name(params):`
 *  - `class Name:`  / `class Name(Base):`
 *
 * Only top-level definitions (zero indentation) are returned, since those
 * are the module's public API equivalents.
 */
function extractPythonExports(source: string): string[] {
  const exports: string[] = [];

  // Top-level def (no leading whitespace)
  const funcDef = /^(?:async\s+)?def\s+(\w+)\s*(\([^)]*\))\s*(?:->.*?)?:/gm;
  let m: RegExpExecArray | null;
  while ((m = funcDef.exec(source)) !== null) {
    // Verify there's no leading whitespace (top-level only)
    const lineStart = source.lastIndexOf('\n', m.index) + 1;
    const indent = m.index - lineStart;
    if (indent === 0) {
      const name = m[1];
      const params = m[2];
      exports.push(`${name}${params}`);
    }
  }

  // Top-level class
  const classDef = /^class\s+(\w+)/gm;
  while ((m = classDef.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

/** Escape a string for use in a RegExp. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract the full source of a named function or method from Python source.
 *
 * Handles top-level `def name(...)` and `async def name(...)`.
 * The function body ends when a non-blank line returns to the same or lower
 * indentation level as the `def` keyword.
 */
function extractPyFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  const pat = new RegExp(`^([ \\t]*)(?:async\\s+)?def\\s+${esc}\\s*\\(`, 'm');
  const m = pat.exec(source);
  if (!m) return null;

  const baseIndentLen = m[1].length;
  const lines = source.slice(m.index).split('\n');
  const out: string[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') { out.push(line); continue; }
    const indentLen = (line.match(/^([ \t]*)/)?.[1] ?? '').length;
    if (indentLen <= baseIndentLen) break; // back at or above def level — function ended
    out.push(line);
  }

  // Trim trailing blank lines
  while (out.length > 1 && out[out.length - 1].trim() === '') out.pop();
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Module Purpose Extraction
// ---------------------------------------------------------------------------

/**
 * Extract a one-line module purpose from Python source.
 *
 * Priority order:
 *  1. First non-empty line of a triple-double-quoted module docstring (`"""..."""`)
 *  2. First non-empty line of a triple-single-quoted module docstring (`'''...'''`)
 *  3. First meaningful line of a consecutive leading `#` comment block
 *
 * Returns null if no purpose can be determined.
 */
function extractPyModulePurpose(source: string): string | null {
  // Strip leading coding declarations / shebang lines before looking for docstring
  const stripped = source.replace(/^(#!.*\n|#.*coding.*\n)*/m, '');

  // Triple-double-quote docstring
  const tripleDoubleMatch = /^\s*"""([\s\S]*?)"""/.exec(stripped);
  if (tripleDoubleMatch) {
    const lines = tripleDoubleMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Triple-single-quote docstring
  const tripleSingleMatch = /^\s*'''([\s\S]*?)'''/.exec(stripped);
  if (tripleSingleMatch) {
    const lines = tripleSingleMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Consecutive leading # comment block (from original source)
  const commentBlock = /^((?:[ \t]*#[^\n]*\n)+)/.exec(source);
  if (commentBlock) {
    const lines = commentBlock[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*#\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry Point Detection
// ---------------------------------------------------------------------------

const PY_ENTRY_STEMS = new Set(['main', 'app', 'server', 'entry', '__main__', 'run', 'start']);

/**
 * Determine if a Python file is a program entry point.
 *
 * Checks:
 *  - Presence of `if __name__ == "__main__":` idiom
 *  - Filename stem matches common entry point names
 */
function isPyEntryPoint(source: string, filePath: string): boolean {
  if (/if\s+__name__\s*==\s*['"]__main__['"]\s*:/.test(source)) return true;

  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (PY_ENTRY_STEMS.has(stem)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const pythonPlugin: LanguagePlugin = {
  extensions: ['.py'],
  extractDeps: extractPythonDeps,
  extractExports: extractPythonExports,
  extractFunctionCode: extractPyFunctionCode,
  extractModulePurpose: extractPyModulePurpose,
  isEntryPoint: isPyEntryPoint,
};
