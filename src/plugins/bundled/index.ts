/**
 * Built-in Plugin Initialization
 *
 * Initializes built-in plugins that ship with the CLI and appear in the
 * Plugins section of /config for users to enable or disable.
 *
 * Use this only for features that users should be able to explicitly
 * enable or disable. Core model tools are registered independently.
 *
 * To add a new built-in plugin:
 * 1. Import registerBuiltinPlugin from '../builtinPlugins.js'
 * 2. Call registerBuiltinPlugin() with the plugin definition here
 */

/**
 * Initialize built-in plugins. Called during CLI startup.
 */
export function initBuiltinPlugins(): void {
  // Sophia ships no enabled-by-default plugins. User-installed plugins are
  // discovered through the normal marketplace and local plugin paths.
}
