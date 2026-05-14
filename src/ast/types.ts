/**
 * A granular code entity (function, class, route, …) extracted from a file.
 * Used by the SQLite graph store to model intra-file structure beyond the
 * coarser file-level dependency graph.
 */
export interface Entity {
  kind: 'function' | 'class' | 'route';
  name: string;
  /** Parent type name for inheritance — e.g. `extends AbstractController`. */
  extendsName?: string;
}

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

  /**
   * Extract granular entities (functions, classes, routes) declared in this
   * file. Returned entities become first-class nodes in the SQLite graph
   * store, enabling intra-file structural traversal (e.g. EXTENDS edges).
   * Plugins that have not yet implemented this method may omit it; the
   * dispatcher treats the absence as an empty list.
   */
  extractEntities?(source: string): Entity[];
}
