/**
 * Plugin Registry
 *
 * Dynamic registry for language plugins, keyed by file extension.
 * Allows runtime lookup and future extensibility without modifying core parser code.
 */

import type { LanguagePlugin } from './types.js';

const pluginsByExtension = new Map<string, LanguagePlugin>();

/**
 * Register a language plugin globally.
 * The plugin will handle all files matching its declared extensions.
 */
export function registerPlugin(plugin: LanguagePlugin): void {
  for (const ext of plugin.extensions) {
    pluginsByExtension.set(ext, plugin);
  }
}

/**
 * Look up a plugin by file extension.
 * Returns the plugin if registered, null otherwise.
 */
export function getPlugin(ext: string): LanguagePlugin | null {
  return pluginsByExtension.get(ext) ?? null;
}

/**
 * List all registered file extensions.
 * Useful for validation and filtering input files.
 */
export function registeredExtensions(): string[] {
  return [...pluginsByExtension.keys()];
}
