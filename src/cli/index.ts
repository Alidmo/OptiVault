#!/usr/bin/env node
import { program } from 'commander';

program
  .name('optivault')
  .description('Context Compiler: converts codebases into compressed Obsidian shadow notes')
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
  .description('Start the MCP server exposing read_shadow_context')
  .option('-o, --vault <path>', 'vault directory', '.optivault')
  .action(async (options) => {
    const { startMcpServer } = await import('../mcp/server.js');
    await startMcpServer(options.vault);
  });

program.parse();
