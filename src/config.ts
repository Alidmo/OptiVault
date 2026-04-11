/**
 * OptiVault Configuration Loader
 *
 * Reads `optivault.json` from the project root.
 * Falls back to sensible defaults when the file is absent or malformed.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The default vault directory name (Obsidian-compatible, no leading dot). */
export const DEFAULT_VAULT_DIR = '_optivault';

/** The legacy vault directory name created by earlier OptiVault versions. */
export const LEGACY_VAULT_DIR = '.optivault';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OptiVaultConfig {
  /** Directory name (relative to project root) where the vault is stored. */
  vaultDir: string;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load OptiVault configuration for a given project root.
 *
 * Resolution order:
 *  1. `<cwd>/optivault.json` — user-provided config
 *  2. Built-in defaults (`_optivault`)
 *
 * Malformed JSON or missing keys fall back to defaults silently.
 */
export function getConfig(cwd: string): OptiVaultConfig {
  const configPath = join(cwd, 'optivault.json');

  try {
    const raw = readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<OptiVaultConfig>;

    if (typeof parsed.vaultDir === 'string' && parsed.vaultDir.trim().length > 0) {
      return { vaultDir: parsed.vaultDir.trim() };
    }
  } catch {
    // File not found, permission error, or JSON parse failure — use defaults.
  }

  return { vaultDir: DEFAULT_VAULT_DIR };
}
