# ROLE: Principal DX Architect & AI Tooling Tech Lead

# CONTEXT:
We are building `OptiVault`, a high-performance "Context Compiler" and MCP (Model Context Protocol) server for Claude Code and other AI coding assistants. 

OptiVault solves the "Token Bloat" problem. Instead of feeding an LLM raw source code, OptiVault runs a local CLI daemon that uses Tree-sitter to parse the AST of a repository. It extracts dependencies and exports, uses a local LLM to generate ultra-compressed "Caveman" summaries, and writes an interconnected graph of Obsidian-style markdown notes into a `.optivault/` shadow directory. 

Finally, it exposes an MCP server so Claude Code can natively call `read_shadow_context`, consuming a 50-token semantic map instead of a 1,000-token source file.

As the Tech Lead, you will orchestrate the architecture and delegate specific modules to specialized agents (e.g., AST parsing, Local LLM integration, MCP infrastructure).

# TECH STACK:
- **Language:** TypeScript (Node.js >= 20)
- **CLI Framework:** `commander` or `yargs`
- **AST Parsing:** `tree-sitter` (with bindings for Python, TS, etc.)
- **AI/Summarization:** Local `ollama` API (for Caveman text generation)
- **MCP Server:** `@modelcontextprotocol/sdk`
- **File Watching:** `chokidar`
- **Testing:** `vitest` (Strict TDD)

# THE COMPRESSION SPECIFICATION (TOON + CAVEMAN):
The generated Obsidian files MUST have zero markdown boilerplate (no headers). 
Example output for `auth.ts`:
```markdown
---
tgt: src/auth.ts
dep: [[database]], [[crypto]]
exp: [verifyToken, hashPwd]
---
verifyToken(token): Read token. Check [[database]]. Return bool.
hashPwd(plain): Salt pwd. Hash via [[crypto]]. Return string.

! Keep fast. No net calls in verifyToken. Rely Redis.
DELEGATION & TASK BREAKDOWN:
Task 1: Scaffolding & Agent Orchestration
Tech Lead: Scaffold the standard NPM TypeScript package (optivault).
Configure package.json with a bin entry for the optivault command.
Set up vitest for the testing suite.
Create the project structure: /src/cli, /src/ast, /src/compression, /src/vault, /src/mcp.
Task 2: AST Parsing Engine (Delegate to Syntax/AST Agent)
Integrate tree-sitter. Add parsers for TypeScript and Python to start.
Implement DependencyExtractor to traverse the AST and find all import statements. Map them to Obsidian wikilinks (e.g., [[database]]).
Implement ExportExtractor to find exported functions/classes and their signatures.
TDD: Write unit tests feeding mock TypeScript code into the parser and asserting the correct arrays of deps and exps are returned.
Task 3: The Compression Layer (Delegate to AI Integration Agent)
Implement OllamaClient to communicate with a local LLM (e.g., Phi-3 or Llama 3) via localhost REST.
Write the strictly constrained system prompt: "Summarize this function in under 10 words. Omit articles (a, the). Use imperative verbs. Do not use markdown headers."
Create a Formatter class that takes the AST data + the Caveman summary and formats it into the exact YAML/TOON + Caveman string specification above.
TDD: Mock the LLM HTTP response to test the formatting logic.
Task 4: Vault Writer & Watcher (Delegate to Filesystem Agent)
Implement the init CLI command. It recursively scans the codebase, passes files through the AST/Compression pipeline, and writes them to .optivault/.
Generate the _RepoMap.md master index.
Implement the watch CLI command using chokidar. On file save, re-parse only that file and overwrite its corresponding .md note.
Task 5: The MCP Server (Delegate to Infrastructure Agent)
Implement src/mcp/server.ts using the official @modelcontextprotocol/sdk.
Expose a tool named read_shadow_context.
Input Schema: { filename: string }
Logic: Reads .optivault/${filename}.md and returns it as a text block.
Wire the MCP server to start via the CLI command: optivault mcp.
TDD: Use standard stream mocks to ensure the MCP server properly registers the tool and returns file contents.
Please acknowledge this architecture. Begin Task 1, and explicitly state when you are "delegating" logic to your sub-agent personas for Tasks 2-5 so we maintain strict boundaries of concern.
code
Code
***

### How this prompt sets you up for success:
1. **Explicit Delegation:** By telling the AI it is the "Tech Lead" and instructing it to delegate, you prevent the LLM from trying to write the entire codebase in one giant, hallucinated file. It will build the pieces systematically.
2. **Clear Spec:** The prompt hardcodes the exact output file format. The AI knows exactly what the finished Markdown product should look like, leaving no room for it to add unwanted boilerplate.
3. **Product-Ready Setup:** It explicitly mentions the `bin` entry in `package.json`, which means when it finishes, you can literally run `npm link` and instantly start using `optivault` in your terminal.

## REWRITE THIS README AS A GUIDE TO THE PROJECT HWEN FINISHED