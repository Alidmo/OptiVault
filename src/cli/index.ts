#!/usr/bin/env node
import { program } from 'commander';
import { resolve } from 'path';

program
  .name('optivault')
  .description(
    'Zero-dependency AST-driven semantic router for Claude Code. ' +
    'Extracts repo structure via MCP protocol.'
  )
  .version('0.1.0');

program
  .command('init [dir]')
  .description('Scan codebase and write vault shadow notes')
  .option('-o, --output <path>', 'output directory (overrides optivault.json)')
  .action(async (dir = '.', options) => {
    const { getConfig } = await import('../config.js');
    const { runInit, migrateLegacyVault } = await import('../vault/init.js');

    const config = getConfig(resolve(dir));
    const outputDir = resolve(dir, options.output ?? config.vaultDir);

    await migrateLegacyVault(resolve(dir), outputDir);
    await runInit(resolve(dir), outputDir);
  });

program
  .command('watch [dir]')
  .description('Watch for file changes and update shadow notes incrementally')
  .option('-o, --output <path>', 'output directory (overrides optivault.json)')
  .action(async (dir = '.', options) => {
    const { getConfig } = await import('../config.js');
    const { migrateLegacyVault } = await import('../vault/init.js');
    const { runWatch } = await import('../vault/watch.js');

    const config = getConfig(resolve(dir));
    const outputDir = resolve(dir, options.output ?? config.vaultDir);

    await migrateLegacyVault(resolve(dir), outputDir);
    await runWatch(resolve(dir), outputDir);
  });

program
  .command('mcp')
  .description('Start the MCP server with 4 semantic routing tools')
  .option('-o, --vault <path>', 'vault directory (overrides optivault.json)')
  .option('-s, --source <path>', 'source directory for read_function_code and sync_file_context tools')
  .action(async (options) => {
    const { getConfig } = await import('../config.js');
    const { migrateLegacyVault } = await import('../vault/init.js');
    const { startMcpServer } = await import('../mcp/server.js');

    const cwd = process.cwd();
    const config = getConfig(cwd);
    const vaultDir = resolve(options.vault ?? config.vaultDir);
    const sourceDir = options.source ? resolve(options.source) : undefined;

    await migrateLegacyVault(cwd, vaultDir);
    await startMcpServer(vaultDir, sourceDir);
  });

program.parse();
