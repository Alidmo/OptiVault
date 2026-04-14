/**
 * C# Language Plugin
 *
 * Extracts dependencies and exports from C# source.
 * Handles: .cs
 */

import type { LanguagePlugin } from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// External namespace filter
// ---------------------------------------------------------------------------

/**
 * Root C# namespaces that are always external (BCL, popular frameworks).
 */
const CSHARP_EXTERNAL_PREFIXES = new Set([
  // .NET BCL
  'System',
  'Microsoft',
  'Windows',
  // NuGet ecosystem
  'Newtonsoft',
  'Serilog',
  'NLog',
  'log4net',
  'AutoMapper',
  'FluentValidation',
  'FluentAssertions',
  'NUnit',
  'xUnit',
  'Moq',
  'NSubstitute',
  'MediatR',
  'Polly',
  'Dapper',
  'Humanizer',
  'Hangfire',
  'Quartz',
  'StackExchange',
  'RabbitMQ',
  'MassTransit',
  'Azure',
  'Amazon',
  'Google',
  'MongoDB',
  'Npgsql',
  'MySql',
  'Oracle',
  'EntityFramework',
  'Castle',
  'Autofac',
  'Unity',         // IoC container, not game engine
  'Ninject',
  'SimpleInjector',
  'Bogus',
  'Faker',
  'CsvHelper',
  'NPOI',
  'EPPlus',
]);

function isExternalCSharpNamespace(ns: string): boolean {
  const root = ns.split('.')[0];
  return CSHARP_EXTERNAL_PREFIXES.has(root ?? ns);
}

// ---------------------------------------------------------------------------
// Extraction Logic
// ---------------------------------------------------------------------------

/**
 * Extract project-local `using` statements.
 *
 * Handles:
 *  - `using MyApp.Services;`
 *  - `using MyAlias = MyApp.Utils;`
 *  - `using static MyApp.Constants;`
 *  - `global using MyApp.Models;`
 */
function extractCSharpDeps(source: string): string[] {
  const deps: string[] = [];

  const usingPat = /^[ \t]*(?:global\s+)?using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = usingPat.exec(source)) !== null) {
    const ns = m[1];
    if (isExternalCSharpNamespace(ns)) continue;
    // Use the last segment as the wikilink name
    const parts = ns.split('.');
    const dep = parts[parts.length - 1] ?? ns;
    deps.push(dep);
  }

  return dedupe(deps);
}

/**
 * Extract top-level type declarations from C# source.
 *
 * Handles:
 *  - `class Foo` / `abstract class Foo` / `sealed class Foo` / `partial class Foo`
 *  - `interface IFoo`
 *  - `struct Point`
 *  - `enum Status`
 *  - `record Person` / `record struct Point`
 *  - `delegate ReturnType Name(params)`
 */
function extractCSharpExports(source: string): string[] {
  const exports: string[] = [];

  const typePat =
    /^[ \t]*(?:(?:public|internal|private|protected|static|abstract|sealed|partial|readonly|unsafe|new)\s+)*(?:class|interface|struct|enum|record(?:\s+struct)?|delegate\s+\S+)\s+(\w+)/gm;
  let m: RegExpExecArray | null;
  while ((m = typePat.exec(source)) !== null) {
    exports.push(m[1]);
  }

  return dedupe(exports);
}

// ---------------------------------------------------------------------------
// Function Code Extraction
// ---------------------------------------------------------------------------

function extractCSharpFunctionCode(source: string, functionName: string): string | null {
  const esc = escapeRegex(functionName);
  const pat = new RegExp(
    `^([ \\t]*)(?:(?:public|private|protected|internal|static|async|virtual|override|abstract|sealed|extern|unsafe|partial)\\s+)*[\\w<>\\[\\]?.]+\\s+${esc}\\s*(?:<[^>]*>\\s*)?\\(`,
    'm',
  );
  const m = pat.exec(source);
  if (!m) return null;

  const slice = source.slice(m.index);
  const braceIdx = slice.indexOf('{');
  if (braceIdx === -1) {
    // Expression-bodied member: => expr;
    const arrowIdx = slice.indexOf('=>');
    if (arrowIdx === -1) return null;
    const semi = slice.indexOf(';', arrowIdx);
    return slice.slice(0, semi === -1 ? undefined : semi + 1).trim();
  }

  let depth = 0;
  let end = -1;
  for (let i = braceIdx; i < slice.length; i++) {
    if (slice[i] === '{') depth++;
    else if (slice[i] === '}') {
      if (--depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return null;
  return slice.slice(0, end + 1).trim();
}

// ---------------------------------------------------------------------------
// Module Purpose Extraction
// ---------------------------------------------------------------------------

function extractCSharpModulePurpose(source: string): string | null {
  // XML doc summary: /// <summary>...</summary>
  const xmlDocMatch = /^((?:[ \t]*\/\/\/[^\n]*\n)+)/m.exec(source);
  if (xmlDocMatch) {
    const summaryMatch = /<summary>([\s\S]*?)<\/summary>/.exec(xmlDocMatch[1]);
    if (summaryMatch) {
      const lines = summaryMatch[1]
        .split('\n')
        .map((l) => l.replace(/^[ \t]*\/\/\/\s?/, '').trim())
        .filter((l) => l.length > 0);
      if (lines.length > 0) return lines[0];
    }
    // Fall back to first /// line content
    const lines = xmlDocMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\/\s?/, '').replace(/<[^>]+>/g, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Block comment: /* ... */
  const blockMatch = /^[ \t]*\/\*([\s\S]*?)\*\//m.exec(source);
  if (blockMatch) {
    const lines = blockMatch[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  // Leading // comment block
  const lineMatch = /^((?:[ \t]*\/\/[^\n]*\n)+)/.exec(source);
  if (lineMatch) {
    const lines = lineMatch[1]
      .split('\n')
      .map((l) => l.replace(/^[ \t]*\/\/\s?/, '').trim())
      .filter((l) => l.length > 0);
    if (lines.length > 0) return lines[0];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Entry Point Detection
// ---------------------------------------------------------------------------

function isCSharpEntryPoint(source: string, filePath: string): boolean {
  // Traditional Main method
  if (/static\s+(?:async\s+)?(?:void|Task|int)\s+Main\s*\(/.test(source)) return true;
  // Top-level statements (C# 9+): file has no class/namespace wrapping the entry logic
  // Heuristic: file is named Program.cs
  const basename = filePath.replace(/\\/g, '/').split('/').pop() ?? '';
  const stem = basename.replace(/\.[^/.]+$/, '').toLowerCase();
  if (['program', 'main', 'app', 'startup', 'bootstrap'].includes(stem)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Plugin Implementation
// ---------------------------------------------------------------------------

export const csharpPlugin: LanguagePlugin = {
  extensions: ['.cs'],
  extractDeps: extractCSharpDeps,
  extractExports: extractCSharpExports,
  extractFunctionCode: extractCSharpFunctionCode,
  extractModulePurpose: extractCSharpModulePurpose,
  isEntryPoint: isCSharpEntryPoint,
};
