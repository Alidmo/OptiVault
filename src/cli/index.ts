#!/usr/bin/env node
import { program } from 'commander';

program
  .name('optivault')
  .description('Zero-dependency AST-driven semantic router for Claude Code. Extracts repo structure via MCP protocol.')
  .version('0.1.0');

program
  .command('init [dir]')
  .description('Scan codebase and write .optivault/ shadow notes')
  .option('-o, --output <path>', 'output directory', '.optivault')
  .action(async (dir = '.', options) => {
    const { runInit } = await import('../vault/init.js');
    await runInit(dir, options.output);
  });

program
  .command('watch [dir]')
  .description('Watch for file changes and update shadow notes incrementally')
  .option('-o, --output <path>', 'output directory', '.optivault')
  .action(async (dir = '.', options) => {
    const { runWatch } = await import('../vault/watch.js');
    await runWatch(dir, options.output);
  });

program
  .command('mcp')
  .description('Start the MCP server with 3 semantic routing tools')
  .option('-o, --vault <path>', 'vault directory', '.optivault')
  .option('-s, --source <path>', 'source directory for read_function_code tool', undefined)
  .action(async (options) => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(options.vault, options.source);
  });

program.parse();
