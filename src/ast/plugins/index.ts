/**
 * Plugin Auto-Registration
 *
 * Import this module to automatically register all built-in language plugins.
 * This enables the registry to handle TypeScript and Python sources by default.
 */

import { registerPlugin } from '../registry.js';
import { typescriptPlugin } from './typescript.js';
import { pythonPlugin } from './python.js';

// Auto-register built-in plugins
registerPlugin(typescriptPlugin);
registerPlugin(pythonPlugin);

// Export the plugins for reference
export { typescriptPlugin, pythonPlugin };
