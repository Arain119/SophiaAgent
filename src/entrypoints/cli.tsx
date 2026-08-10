#!/usr/bin/env bun
// Performance shim MUST be the first import — it replaces globalThis.performance
// with a JS-backed implementation before React/OTel capture the native reference.
// Without this, JSC's C++ Vector grows without bound in long-running sessions.
import '../utils/performanceShim.js';

// Runtime fallback for MACRO.* when not injected by build/dev defines.
// This happens when running cli.tsx directly (not via `bun run dev` or built dist/).
if (typeof globalThis.MACRO === 'undefined') {
  (globalThis as any).MACRO = {
    VERSION: process.env.SOPHIA_VERSION || '0.1.0',
    BUILD_TIME: new Date().toISOString(),
    FEEDBACK_CHANNEL: '',
    ISSUES_EXPLAINER: '',
    NATIVE_PACKAGE_URL: '',
    PACKAGE_URL: '',
    VERSION_CHANGELOG: '',
  };
}

// Bugfix for corepack auto-pinning, which adds yarnpkg to peoples' package.jsons
// eslint-disable-next-line custom-rules/no-top-level-side-effects
process.env.COREPACK_ENABLE_AUTO_PIN = '0';

/**
 * Bootstrap entrypoint - checks for special flags before loading the full CLI.
 * All imports are dynamic to minimize module evaluation for fast paths.
 * Fast-path for --version has zero imports beyond this file.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Fast-path for --version/-v: zero module loading needed
  if (args.length === 1 && (args[0] === '--version' || args[0] === '-v' || args[0] === '-V')) {
    // MACRO.VERSION is inlined at build time
    console.log(`${MACRO.VERSION} (Sophia Agent)`);
    return;
  }

  // For all other paths, load the startup profiler
  const { profileCheckpoint } = await import('../utils/startupProfiler.js');
  profileCheckpoint('cli_entry');

  // Fast-path for --worktree --tmux: exec into tmux before loading full CLI
  const hasTmuxFlag = args.includes('--tmux') || args.includes('--tmux=classic');
  if (
    hasTmuxFlag &&
    (args.includes('-w') || args.includes('--worktree') || args.some(a => a.startsWith('--worktree=')))
  ) {
    profileCheckpoint('cli_tmux_worktree_fast_path');
    const { enableConfigs } = await import('../utils/config.js');
    enableConfigs();
    const { isWorktreeModeEnabled } = await import('../utils/worktreeModeEnabled.js');
    if (isWorktreeModeEnabled()) {
      const { execIntoTmuxWorktree } = await import('../utils/worktree.js');
      const result = await execIntoTmuxWorktree(args);
      if (result.handled) {
        return;
      }
      // If not handled (e.g., error), fall through to normal CLI
      if (result.error) {
        const { exitWithError } = await import('../utils/process.js');
        exitWithError(result.error);
      }
    }
  }

  // Redirect common update flag mistakes to the update subcommand
  if (args.length === 1 && (args[0] === '--update' || args[0] === '--upgrade')) {
    process.argv = [process.argv[0]!, process.argv[1]!, 'update'];
  }

  // --bare: set SIMPLE early so gates fire during module eval / commander
  // option building (not just inside the action handler).
  if (args.includes('--bare')) {
    process.env.SOPHIA_SIMPLE = '1';
  }

  // No special flags detected, load and run the full CLI
  const { startCapturingEarlyInput } = await import('../utils/earlyInput.js');
  startCapturingEarlyInput();
  profileCheckpoint('cli_before_main_import');
  const { main: cliMain } = await import('../main.jsx');
  profileCheckpoint('cli_after_main_import');
  await cliMain();
  profileCheckpoint('cli_after_main_complete');
}

// eslint-disable-next-line custom-rules/no-top-level-side-effects
await main();
