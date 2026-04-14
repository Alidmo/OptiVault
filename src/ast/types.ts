/**
 * Language Plugin Interface
 *
 * Each language implementation must provide methods to extract
 * dependencies and exports from source code.
 */
export interface LanguagePlugin {
  /** File extensions this plugin handles (e.g. ['.ts', '.tsx', '.js']) */
  extensions: string[];

  /** Extract dependency names from source code */
  extractDeps(source: string): string[];

  /** Extract export signatures from source code */
  extractExports(source: string): string[];

  /**
   * Extract the full source code of a specific function/method by name.
   * Returns null if the function is not found or extraction fails.
   */
  extractFunctionCode?(source: string, functionName: string): string | null;

  /**
   * Extract the module-level purpose from source code.
   * Returns the first meaningful line of a module docstring or leading comment block.
   * Returns null if no purpose can be determined.
   */
  extractModulePurpose?(source: string): string | null;

  /**
   * Determine if this file is a program entry point.
   * Checks for language-specific entry point signatures (e.g., `if __name__ == "__main__":`,
   * `index.ts` filenames, `export default function main()`).
   */
  isEntryPoint?(source: string, filePath: string): boolean;
}
