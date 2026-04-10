# OptiVault

**Context Compiler & MCP Server for Claude Code and AI Assistants**

OptiVault solves the "token bloat" problem. Instead of feeding your entire codebase into an LLM, OptiVault scans your repository, extracts dependencies and exports, generates ultra-compressed "Caveman" summaries, and writes them as interconnected Obsidian markdown notes. Claude Code can then natively query these compressed shadows via the MCP server, consuming **50 tokens instead of 1,000 per file**.

---

## Quick Start

### 1. Prerequisites

- **Node.js** ≥ 20 ([download](https://nodejs.org/))
- **npm** (comes with Node.js)
- **Ollama** (optional, for AI summaries; [download](https://ollama.ai)) — if not running, OptiVault degrades gracefully

### 2. Install OptiVault

```bash
cd /path/to/openvault
npm install
npm run build
npm link
```

The `npm link` step makes `optivault` available globally. You can now run it from anywhere:

```bash
optivault init /path/to/your/project
optivault watch /path/to/your/project
optivault mcp
```

### 3. Set Up Ollama for Summaries (Optional)

If you want Caveman AI summaries:

1. Download & install [Ollama](https://ollama.ai)
2. Start the Ollama service:
   ```bash
   ollama serve
   ```
3. In another terminal, pull a lightweight model:
   ```bash
   ollama pull phi3  # or llama2, mistral, etc.
   ```
4. OptiVault will auto-detect Ollama at `http://localhost:11434` and generate summaries

**Without Ollama:** OptiVault still extracts deps/exports and writes the TOON frontmatter—just no caveman lines. This is perfectly fine for initial indexing.

### 4. Install Obsidian

1. Download & install [Obsidian](https://obsidian.md/)
2. Create a new vault or open an existing one
3. In Obsidian's file browser, open the `.optivault/` folder that OptiVault generates

Now your compressed notes are linked and queryable in Obsidian's knowledge graph.

---

## Usage

### Scan a Project

```bash
optivault init ~/my-project
```

This:
- Walks `~/my-project` recursively, finding `.ts`, `.tsx`, `.js`, `.mjs`, `.py` files
- Extracts dependencies and exports from each file
- Calls Ollama (if running) for 10-word summaries
- Writes `.md` notes to `~/my-project/.optivault/`
- Generates `_RepoMap.md` — a master index of all files, exports, and dependencies

**Example output:**

```
.optivault/
├── src/
│   ├── auth.ts.md
│   ├── database.ts.md
│   └── utils.py.md
└── _RepoMap.md
```

Each `.md` file looks like:

```
---
tgt: src/auth.ts
dep: [[database]], [[crypto]]
exp: [verifyToken, hashPwd]
---
verifyToken(token): Read token. Check [[database]]. Return bool.
hashPwd(plain): Salt pwd. Hash via [[crypto]]. Return string.
```

### Watch for Changes

```bash
optivault watch ~/my-project
```

Stays running and re-indexes files as you save them. Perfect for development workflows.

### Use with Obsidian

1. Open Obsidian
2. Open settings → **File & Links** → enable **"Use [[wikilinks]]"**
3. In the file explorer, navigate to `.optivault/`
4. Click any note to see:
   - Frontmatter showing **dependencies** and **exports**
   - Caveman summaries (if Ollama is running)
   - Wikilinks to related files via `[[database]]`, `[[crypto]]`, etc.
5. Use **Graph View** to visualize the entire repo as a knowledge graph

---

## Use with Claude Code

### Register the MCP Server

OptiVault exposes a **Model Context Protocol (MCP) server** with a `read_shadow_context` tool.

**In Claude Code settings** (`~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "optivault": {
      "command": "optivault",
      "args": ["mcp", "--vault", "/path/to/project/.optivault"]
    }
  }
}
```

### Use in Claude Code

Once registered, Claude can call the `read_shadow_context` tool:

```
You: "What does src/auth.ts export?"

Claude: *I'll check the shadow context for that file.*

Claude calls: read_shadow_context(filename: "src/auth.ts")

Returns:
---
tgt: src/auth.ts
dep: [[database]], [[crypto]]
exp: [verifyToken, hashPwd]
---
verifyToken(token): Read token. Check [[database]]. Return bool.
hashPwd(plain): Salt pwd. Hash via [[crypto]]. Return string.
```

Instead of reading the raw 500+ line `auth.ts` file (consuming 1,000 tokens), Claude gets a 50-token summary. Perfect for large codebases.

---

## CLI Reference

### `optivault init [dir] [options]`

Generate shadow context for a codebase.

```bash
optivault init ~/my-project --output ~/my-project/.optivault
```

**Options:**
- `-o, --output <path>` — where to write `.md` files (default: `.optivault`)

### `optivault watch [dir] [options]`

Watch for file changes and update notes incrementally.

```bash
optivault watch ~/my-project
```

Press `Ctrl+C` to stop. Re-indexes only changed files—much faster than `init` on every save.

### `optivault mcp [options]`

Start the MCP server. Reads from `.optivault/` and serves `read_shadow_context`.

```bash
optivault mcp --vault ~/my-project/.optivault
```

**Options:**
- `-o, --vault <path>` — vault directory to read from (default: `.optivault`)

---

## Architecture

OptiVault is built as a **plugin-based comment compiler**:

- **AST Plugins** — Extract deps/exports for any language (TypeScript, Python, extensible to Go, Rust, etc.)
- **Compression Layer** — Call local LLM (Ollama) for 10-word summaries
- **Vault Writer** — Recursive scan, pipeline, incremental writes
- **MCP Server** — Stdio-based Model Context Protocol server for Claude Code integration

### Extending to New Languages

Add a new language by creating a plugin:

```typescript
// src/ast/plugins/go.ts
import type { LanguagePlugin } from '../types.js';

export const goPlugin: LanguagePlugin = {
  extensions: ['.go'],
  extractDeps: (source) => { /* extract imports */ },
  extractExports: (source) => { /* extract exported funcs */ },
};
```

Then register it in `src/ast/plugins/index.ts`:

```typescript
registerPlugin(goPlugin);
```

---

## Testing

```bash
npm test          # Run full test suite (77 tests)
npm test:watch    # Continuous watch mode
npm run build     # TypeScript compilation
npm run lint      # Type check
```

---

## Performance

- **Initial scan** (1,000 files): ~10-30 seconds (depends on Ollama)
- **Watch mode** (single file change): ~100-500ms (depends on file size)
- **Token savings**: ~95% reduction per file (1,000 tokens → 50 tokens)

---

## Troubleshooting

### "No extractor plugin for extension: .go"
OptiVault doesn't support that language yet. Add a language plugin (see "Extending to New Languages" above).

### Ollama errors / "ECONNREFUSED"
Ollama isn't running or not listening on `http://localhost:11434`. OptiVault will skip summaries and still write the TOON frontmatter. Start Ollama in another terminal and re-run `optivault init`.

### `.md` files aren't updating in Obsidian
Toggle Obsidian's **File & Links** settings or press `Cmd+Shift+R` (Mac) / `Ctrl+Shift+R` (Windows) to refresh the vault.

### "npm: command not found"
Node.js isn't installed. Download from [nodejs.org](https://nodejs.org/).

---

## Contributing

OptiVault is open for contributions. The codebase is strictly typed (TypeScript) and TDD-driven (vitest).

To add a feature:

1. Write a test in the relevant `*.test.ts`
2. Implement the feature
3. Ensure all 77 tests pass: `npm test`
4. Submit a PR

---

## License

MIT

---

## Next Steps

- Scan your first project: `optivault init ~/my-project`
- Open `.optivault/_RepoMap.md` in Obsidian
- Register the MCP server in Claude Code settings
- Ask Claude: "What does this file export?"

Enjoy ultra-compressed context!
