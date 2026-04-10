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
}
