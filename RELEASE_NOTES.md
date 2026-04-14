# OptiVault — Release Notes

---

## v0.3.0 — Multi-Language Expansion + Clean Graphs

### What's New

#### Java, Kotlin, and PHP Support

OptiVault now indexes five languages out of the box.

| Language | Extensions | Entry-Point Detection |
|---|---|---|
| TypeScript / JavaScript | `.ts` `.tsx` `.js` `.mjs` `.jsx` | `index.*`, `main.*`, `app.listen()`, `createServer()` |
| Python | `.py` | `if __name__ == "__main__":`, `main.py` |
| **Java** | `.java` | `public static void main(String`, `@SpringBootApplication` |
| **Kotlin** | `.kt` `.kts` | `fun main(`, `@SpringBootApplication` |
| **PHP** | `.php` | `index.php`, `app.php`, `$app->run()` |

All three new plugins implement the full plugin interface: dependency extraction, export extraction, function-body extraction, module-purpose extraction, and entry-point detection. Zero changes to core code — pure plugin additions.

#### Dep Graph Noise Elimination

The Obsidian graph no longer fills with orphaned framework and stdlib nodes.

**TypeScript / JavaScript:** only relative imports (`./module`, `../util`) become wikilinks. External npm packages (`express`, `bcryptjs`, `@scope/pkg`) are silently dropped — they have no vault note and never will.

**Python:** a ~180-entry blocklist covers the full stdlib (`os`, `sys`, `json`, `math`, `asyncio`, `pathlib`, …) and the most common third-party packages (`torch`, `numpy`, `pandas`, `fastapi`, `django`, `redis`, `pydantic`, `pytest`, `click`, …). Project-internal absolute imports (`from myapp.models import User`) are preserved as graph edges. Relative imports always pass through.

Before: the SINN project graph had `torch`, `os`, `json`, `yaml`, `redis`, `argparse` as high-inbound orphan nodes. After: those nodes are gone — only project-internal modules appear.

---

### What Changed

#### Plugin Interface (no breaking changes)

The `LanguagePlugin` interface gained two optional methods in the previous release. All three new plugins implement them:

```typescript
extractModulePurpose?(source: string): string | null;
isEntryPoint?(source: string, filePath: string): boolean;
```

#### `normalizeInput` in `extractor.ts`

Language-name aliases extended: `java → .java`, `kotlin → .kt`, `php → .php`, `javascript → .js`. Existing `typescript` and `python` aliases unchanged.

#### `SUPPORTED_EXTENSIONS` in `init.ts`

Now includes `.java`, `.kt`, `.kts`, `.php`. Running `optivault init` on a project with these files will index them automatically.

---

### Test Suite

| Release | Tests |
|---|---|
| v0.1.0 (initial) | 77 |
| v0.2.0 (Semantic Graph + Karpathy Protocol) | 143 |
| **v0.3.0** | **169** |

New tests cover: Python stdlib/third-party exclusion, relative-import passthrough, internal-package preservation, Java/Kotlin/PHP dep filtering, export extraction, and entry-point detection for all three new languages.

---

## v0.2.0 — Semantic Graph + Karpathy Protocol

### What's New

#### Semantic Graph (Epic 1)

Vault notes upgraded from flat token-compressed mirrors to a navigable semantic graph.

- **Module purpose** extracted from leading docstrings (`"""…"""`, `/** … */`), block comments, or line comments — written to YAML frontmatter and as a `>` blockquote at the top of every note. An LLM reading the vault gets the one-line answer to "what does this file do?" before touching any code.
- **Entry-point detection** — files identified as program entry points (by filename stem or source patterns) get `type: entrypoint` and `tags: [entry-point]` in frontmatter. Graph View now shows the execution topology at a glance.
- **Dataview-compatible directed edges** — `## Signatures` replaced by `## Inputs` / `## Outputs` sections using Dataview inline fields (`Imports:: [[dep]]`, `Provides:: \`signature\``). Edges in the Obsidian graph are now semantically directed.
- **Backward compatibility** — `readVaultNote` reads both old (`## Signatures` / `- \`sig\``) and new (`## Outputs` / `Provides::`) formats without reindexing.

#### Karpathy Zero-Fat Protocol (Epic 2)

The generated `CLAUDE.md` now enforces four behavioral pillars:

1. **Think Before Coding** — `read_repo_map` → `read_file_skeleton` → `read_function_code` before touching anything.
2. **Simplicity First** — minimum code, no speculative abstractions.
3. **Surgical Changes** — target the exact function; never rewrite a 500-line file when a 5-line edit works.
4. **Goal-Driven Execution** — state the goal and the test before writing; run the tests after.

The 3-step verification loop is now mandatory: **Read → Write + Verify → Sync**.

#### New MCP Tool: `read_tests_for_file`

Given a source file, returns the corresponding test file using TS (`.test.ts`, `.spec.ts`, `__tests__/`) and Python (`test_*.py`, `tests/`) conventions. Closes the loop: Claude can confirm correctness with one tool call instead of searching.

---

## v0.1.0 — Initial Release

- Zero-dependency AST context compiler — pure TypeScript regex extraction, no Ollama, no API calls.
- 4-tool MCP semantic router: `read_repo_map`, `read_file_skeleton`, `read_function_code`, `sync_file_context`.
- TypeScript/JavaScript and Python plugins.
- `optivault init` — recursive walk, mtime caching, vault note generation, `_RepoMap.md`, `CLAUDE.md` injection, `.gitignore` patching.
- `optivault watch` — chokidar-based incremental re-index.
- Plugin architecture — `LanguagePlugin` interface; register a new language in ~50 lines.
- `_optivault` default vault dir — visible in Obsidian natively (no leading dot).
- Auto-migration from legacy `.optivault` directories.
- 77 passing tests.
