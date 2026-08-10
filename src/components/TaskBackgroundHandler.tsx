import { useCallback } from 'react';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import { backgroundAll, hasForegroundTasks } from '../tasks/LocalShellTask/LocalShellTask.js';
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js';
import { isEnvTruthy } from '../utils/envUtils.js';

/** Handles Ctrl+B for running Bash and Agent tasks. */
export function TaskBackgroundHandler(): null {
  const setAppState = useSetAppState();
  const appStateStore = useAppStateStore();
  const hasForeground = useAppState(hasForegroundTasks);

  const handleBackground = useCallback(() => {
    if (isEnvTruthy(process.env.SOPHIA_DISABLE_BACKGROUND_TASKS)) return;
    if (!hasForegroundTasks(appStateStore.getState())) return;

    backgroundAll(() => appStateStore.getState(), setAppState);
    if (!getGlobalConfig().hasUsedBackgroundTask) {
      saveGlobalConfig(config => (config.hasUsedBackgroundTask ? config : { ...config, hasUsedBackgroundTask: true }));
    }
  }, [appStateStore, setAppState]);

  useKeybinding('task:background', handleBackground, {
    context: 'Task',
    isActive: hasForeground,
  });

  return null;
}
