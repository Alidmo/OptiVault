/**
 * Plugin Auto-Registration
 *
 * Import this module to automatically register all built-in language plugins.
 * Supported: TypeScript/JS, Python, Java, Kotlin, PHP, C/C++, C#, Go, Rust.
 */

import { registerPlugin } from '../registry.js';
import { typescriptPlugin } from './typescript.js';
import { pythonPlugin } from './python.js';
import { javaPlugin } from './java.js';
import { kotlinPlugin } from './kotlin.js';
import { phpPlugin } from './php.js';
import { cppPlugin } from './cpp.js';
import { csharpPlugin } from './csharp.js';
import { goPlugin } from './go.js';
import { rustPlugin } from './rust.js';

// Auto-register built-in plugins
registerPlugin(typescriptPlugin);
registerPlugin(pythonPlugin);
registerPlugin(javaPlugin);
registerPlugin(kotlinPlugin);
registerPlugin(phpPlugin);
registerPlugin(cppPlugin);
registerPlugin(csharpPlugin);
registerPlugin(goPlugin);
registerPlugin(rustPlugin);

// Export the plugins for reference
export {
  typescriptPlugin, pythonPlugin,
  javaPlugin, kotlinPlugin, phpPlugin,
  cppPlugin, csharpPlugin, goPlugin, rustPlugin,
};
