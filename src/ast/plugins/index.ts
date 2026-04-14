/**
 * Plugin Auto-Registration
 *
 * Import this module to automatically register all built-in language plugins.
 * This enables the registry to handle TypeScript, Python, Java, Kotlin, and PHP
 * sources by default.
 */

import { registerPlugin } from '../registry.js';
import { typescriptPlugin } from './typescript.js';
import { pythonPlugin } from './python.js';
import { javaPlugin } from './java.js';
import { kotlinPlugin } from './kotlin.js';
import { phpPlugin } from './php.js';

// Auto-register built-in plugins
registerPlugin(typescriptPlugin);
registerPlugin(pythonPlugin);
registerPlugin(javaPlugin);
registerPlugin(kotlinPlugin);
registerPlugin(phpPlugin);

// Export the plugins for reference
export { typescriptPlugin, pythonPlugin, javaPlugin, kotlinPlugin, phpPlugin };
