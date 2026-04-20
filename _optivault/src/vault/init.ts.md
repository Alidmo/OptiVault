---
tgt: D:\VS Code Projects\OptiVault\src\vault\init.ts
purpose: "Vault Writer"
dep: [[parser]], [[formatter]], [[config]]
exp: [walkDir(
  dir: string,
  extraSkipDirs: ReadonlySet<string> = new Set(), processFile(filePath: string), writeRepoMap(
  outputDir: string,
  allParsed: ParseResult[],
  baseDir: string
), generateClaudeMd(dir: string, vaultDir: string), migrateLegacyVault(
  projectDir: string,
  resolvedOutputDir: string
), runInit(dir: string, outputDir: string), VaultRegistry]
---
> Vault Writer
## Inputs
Imports:: [[parser]], [[formatter]], [[config]]
## Outputs
Provides:: `walkDir(
  dir: string,
  extraSkipDirs: ReadonlySet<string> = new Set()`
Provides:: `processFile(filePath: string)`
Provides:: `writeRepoMap(
  outputDir: string,
  allParsed: ParseResult[],
  baseDir: string
)`
Provides:: `generateClaudeMd(dir: string, vaultDir: string)`
Provides:: `migrateLegacyVault(
  projectDir: string,
  resolvedOutputDir: string
)`
Provides:: `runInit(dir: string, outputDir: string)`
Provides:: `VaultRegistry`