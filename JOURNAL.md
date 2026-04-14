[MOC-001] Map of Content: OptiVault
Tags: #architecture #llm #mcp #tooling #index
Status: Ongoing Project
OptiVault is a static context compiler and Model Context Protocol (MCP) server that solves LLM context window bloat by transforming raw source code into an AST-driven semantic graph.
Core Index:
The Problem: [[Z-001]] LLM Token Waste & Hallucination
The Solution: [[Z-002]] AST-Driven Semantic Routing (vs. RAG)
The Interface: [[Z-003]] Obsidian Dual-Compatibility
The Architecture: [[Z-004]] Language-Agnostic Plugin System
The Automation: [[Z-005]] The Skill Autopilot Loop
The Edge Cases: [[Z-006]] Real-World FS & Worktrees
The Synergy: [[Z-007]] Output Compression (Caveman)
🗃️ [Z-001] LLM Token Waste & Hallucination
Tags: #problem-statement #tokens #legacy-code
Related: [[Z-002]], [[Z-007]]
Concept:
Coding agents (like Claude Code) waste massive amounts of tokens by using standard cat or grep on raw files. In legacy codebases (15+ years old), feeding thousands of lines of boilerplate just to change one function causes "attention dilution" and hallucinations.
Conclusion: We must compress input context before it reaches the LLM.
🗃️ [Z-002] AST-Driven Semantic Routing (vs. RAG)
Tags: #architecture #ast #tree-sitter
Related: [[Z-001]], [[Z-004]]
Concept:
Instead of vector-based RAG (which loses exact logical relationships), OptiVault uses Tree-sitter to build a deterministic Abstract Syntax Tree (AST).
Execution:
We pivoted away from using a local LLM (Ollama) for summarization because it was too slow. Instead, the AST extracts exact Function Signatures and Dependencies.
Claude uses MCP tools to drill down hierarchically:
read_repo_map (Global architecture)
read_file_skeleton (Exports and deps only)
read_function_code (Targeted extraction of a single function body)
🗃️ [Z-003] Obsidian Dual-Compatibility
Tags: #ux #obsidian #knowledge-graph
Related: [[Z-006]]
Concept:
The shadow context is written as physical Markdown files so it acts as both an AI index and a human-readable knowledge graph.
Execution:
Files are linked using standard Obsidian [[wikilinks]].
Pivot: Obsidian ignores hidden .dot folders natively. We refactored the default directory name from .optivault to _optivault via dynamic configuration (optivault.json), ensuring it populates Obsidian's Graph View instantly while remaining a background cache.
🗃️ [Z-004] Language-Agnostic Plugin System
Tags: #refactor #design-pattern #extensibility
Related: [[Z-002]]
Concept:
To scale beyond TypeScript and Python, the AST engine was refactored from a procedural if/else block into a Strategy/Plugin Registry.
Execution:
LanguagePlugin interface dictates extractDeps and extractExports.
Plugins are registered dynamically based on file extensions.
This allows the open-source community to drop in new plugins (Go, Rust, PHP) without touching the core engine. Achieved with 77/77 passing tests.
🗃️ [Z-005] The Skill Autopilot Loop
Tags: #agentic-workflow #claude-code #mcp
Related: [[Z-001]]
Concept:
If Claude modifies a file, the OptiVault shadow context becomes stale. We needed an "Active Protocol."
Execution:
optivault init generates a CLAUDE.md file in the project root.
The CLAUDE.md explicitly commands Claude to use MCP tools instead of cat, and mandates calling sync_file_context immediately after writing code.
Result: A self-healing, zero-latency feedback loop where Claude maintains its own documentation.
🗃️[Z-006] Real-World FS & Worktrees
Tags: #filesystem #edge-cases #git
Related: [[Z-003]]
Concept:
A tool must survive real-world developer environments, including monorepos, massive dependencies, and concurrent agent sessions.
Execution:
Exclusions: Hardcoded skips for .venv, node_modules, vendor, etc., preventing the AST parser from hanging on third-party libraries.
Worktrees/Submodules: OptiVault's "dumb" localized state (writing _optivault directly to the CWD instead of a global SQLite DB) makes it perfectly safe for Git Worktrees. Concurrent Claude instances will never cross-contaminate their context graphs.
🗃️ [Z-007] Output Compression (The Caveman Synergy)
Tags: #marketing #benchmarks #tokenomics
Related: [[Z-001]], [[Z-005]]
Concept:
OptiVault provides Input Compression (AST Skeletons). When paired with Julius Brussee's Caveman skill (Output Compression), you get a "Zero-Fat AI Developer."
Execution:
Added directives in the generated CLAUDE.md to instruct the AI to speak in terse, filler-free structures.
Next Steps: Execute benchmarking script to plot Input vs. Output token costs, visualizing the ~94% reduction to use for social media marketing (Reddit/Twitter/LinkedIn) to drive open-source adoption.
🗃️ [Z-008] Semantic Graph Upgrade — Purpose, Entry Points & Dataview
Tags: #knowledge-graph #obsidian #dataview #ast #epic-1
Related: [[Z-003]], [[Z-004]]
Date: 2026-04-14
Concept:
Flat TOON skeletons lacked hierarchy. An LLM reading a vault note had no immediate answer to: "What does this file do?" or "Where does execution start?" Obsidian's graph view was undirected. This epic promotes the vault from a token-compressed mirror into a true, LLM-navigable semantic graph.
Execution:
LanguagePlugin interface extended with extractModulePurpose and isEntryPoint methods.
TypeScript plugin: extracts leading JSDoc, block comments, or // comment blocks as the file purpose. Detects entry points by filename stem (index, main, app, server, entry, bootstrap) and source patterns (app.listen, createServer, export default function main).
Python plugin: extracts module docstrings (triple-quote) or leading # comment blocks. Detects entry points by if __name__ == "__main__": and filename stem.
ParseResult extended with optional purpose?: string and isEntryPoint?: true fields.
formatVaultNote revamped: purpose lands in YAML frontmatter and as a > blockquote at the top of the body (LLM reads it first). Entry-point files get type: entrypoint and tags: [entry-point] in frontmatter. ## Signatures → ## Inputs (Imports:: wikilinks) + ## Outputs (Provides:: signatures) — Dataview-compatible directed graph edges.
readVaultNote updated with backward compatibility: reads both old ## Signatures / - `sig` and new ## Outputs / Provides:: `sig` cache formats.
🗃️ [Z-009] Karpathy Zero-Fat Protocol Integration
Tags: #prompt-engineering #behavioral #mcp #epic-2
Related: [[Z-005]], [[Z-007]]
Date: 2026-04-14
Concept:
The generated CLAUDE.md was functional but not opinionated enough. Andrej Karpathy's behavioral principles (Think Before Coding, Simplicity First, Surgical Changes, Goal-Driven Execution) directly solve the LLM "over-engineering reflex" and map perfectly onto OptiVault's tool hierarchy.
Execution:
generateClaudeMd template expanded with four named sections: Core Behavioral Principles (Karpathy Protocol), OptiVault MCP Tool Protocol (existing rules), Verification Loop (3-step mandate: Read → Write+Verify → Sync), and Output Compression (Caveman Protocol). Explicit penalty statement for full-file reads when surgical reads are possible.
MCP tool descriptions updated: read_function_code emphasises "surgically extract", "minimum viable read"; sync_file_context framed as "Step 3 of the verification loop", "Never skip this."
New MCP tool read_tests_for_file: given a source file, returns the corresponding test file using TS (.test.ts, .spec.ts, __tests__/) and Python (test_*.py, tests/) conventions. Closes the verification loop by making test-driven confirmation a one-tool operation.
Test suite: 77 → 143 tests (all passing). New coverage: extractModulePurpose (TS + Python), detectEntryPoint (TS + Python), formatVaultNote purpose/entry-point/Dataview fields, read_tests_for_file MCP tool, getTestFileCandidates path generation.