/**
 * Queue defaults, read from `<agentDir>/pie-task-orchestrator.json`.
 *
 * Every field is optional. The file is written by the app or edited by the
 * person, never by a task, so the values are trusted configuration rather than
 * an input-validation boundary. Verification commands and auto-commit are the
 * only fields a single task may override.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getAgentDir } from '../session-reader';
import type { TaskConfig } from './types';

export const TASK_CONFIG_FILE = 'pie-task-orchestrator.json';

export const DEFAULT_TASK_CONFIG: TaskConfig = {
  verifyCommands: [],
  verifyTimeoutMs: 600_000,
  taskTimeoutMs: 3_600_000,
  allowAskUser: false,
  autoCommit: false,
  commitMessage: 'chore(task): #{id} {title}'
};

export function taskConfigPath(agentDir: string = getAgentDir()): string {
  return join(agentDir, TASK_CONFIG_FILE);
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback;
}

function commandList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const commands = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);
  return commands;
}

function boolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/**
 * Normalize a parsed configuration object. Unknown fields are dropped and a
 * malformed field falls back to its default instead of failing the queue.
 */
export function normalizeTaskConfig(raw: unknown): TaskConfig {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const commitMessage =
    typeof record.commitMessage === 'string' && record.commitMessage.trim()
      ? record.commitMessage
      : DEFAULT_TASK_CONFIG.commitMessage;
  return {
    verifyCommands: commandList(record.verifyCommands, DEFAULT_TASK_CONFIG.verifyCommands),
    verifyTimeoutMs: positiveInteger(
      record.verifyTimeoutMs,
      DEFAULT_TASK_CONFIG.verifyTimeoutMs
    ),
    taskTimeoutMs: positiveInteger(record.taskTimeoutMs, DEFAULT_TASK_CONFIG.taskTimeoutMs),
    allowAskUser: boolean(record.allowAskUser, DEFAULT_TASK_CONFIG.allowAskUser),
    autoCommit: boolean(record.autoCommit, DEFAULT_TASK_CONFIG.autoCommit),
    commitMessage
  };
}

export function readTaskConfig(agentDir: string = getAgentDir()): TaskConfig {
  const path = taskConfigPath(agentDir);
  if (!existsSync(path)) return { ...DEFAULT_TASK_CONFIG };
  try {
    return normalizeTaskConfig(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // An unreadable configuration must not stop the queue: defaults apply.
    return { ...DEFAULT_TASK_CONFIG };
  }
}

/** The effective policy of one task: its override, else the queue default. */
export function resolveTaskPolicy(
  config: TaskConfig,
  task: {
    allowAskUser: boolean | null;
    verifyCommands: string[] | null;
    autoCommit: boolean | null;
  }
): TaskConfig {
  return {
    ...config,
    allowAskUser: task.allowAskUser ?? config.allowAskUser,
    verifyCommands: task.verifyCommands ?? config.verifyCommands,
    autoCommit: task.autoCommit ?? config.autoCommit
  };
}

/** Expand the commit message template with the task's id and title. */
export function commitMessageFor(template: string, task: { id: number; title: string }): string {
  return template.replaceAll('{id}', String(task.id)).replaceAll('{title}', task.title);
}
