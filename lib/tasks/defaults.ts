/**
 * The built-in queue defaults: client-safe, so the settings dialog can offer
 * "restore defaults" without reading the configuration file.
 */
import type { TaskConfig } from './types';

/** Numbers, not `null`: an unreadable value falls back to these, never to "no limit". */
export const DEFAULT_VERIFY_TIMEOUT_MS = 600_000;
export const DEFAULT_TASK_TIMEOUT_MS = 3_600_000;

export const TASK_CONFIG_DEFAULTS: TaskConfig = {
  model: null,
  verifyCommands: [],
  verifyTimeoutMs: DEFAULT_VERIFY_TIMEOUT_MS,
  taskTimeoutMs: DEFAULT_TASK_TIMEOUT_MS,
  allowAskUser: false,
  autoCommit: false,
  commitMessage: 'chore(task): #{id} {title}'
};
