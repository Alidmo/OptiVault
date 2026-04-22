---
tgt: D:\VS Code Projects\OptiVault\src\mcp\server.ts
purpose: "MCP Server — Semantic Router for Claude Code"
type: entrypoint
tags: [entry-point]
dep: [[parser]], [[function-extractor]], [[formatter]], [[init]]
exp: [getTestFileCandidates(filename: string), normalizeGraphKey(key: string), buildDepGraph(repoMapContent: string), traverseGraph(
  adjacency: Map<string, string[]>,
  from: string,
  depth: number
), startMcpServer(vaultDir: string, sourceDir?: string), DepGraph]
---
> MCP Server — Semantic Router for Claude Code
## Inputs
Imports:: [[parser]], [[function-extractor]], [[formatter]], [[init]]
## Outputs
Provides:: `getTestFileCandidates(filename: string)`
Provides:: `normalizeGraphKey(key: string)`
Provides:: `buildDepGraph(repoMapContent: string)`
Provides:: `traverseGraph(
  adjacency: Map<string, string[]>,
  from: string,
  depth: number
)`
Provides:: `startMcpServer(vaultDir: string, sourceDir?: string)`
Provides:: `DepGraph`