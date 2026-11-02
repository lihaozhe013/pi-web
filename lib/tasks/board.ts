/**
 * Pure helpers for the task board. Keeping them out of the component makes the
 * ordering and question rules testable without a browser.
 */
import { ASK_USER_OTHER_LABEL } from '../ask-user-labels';
import type { ExtensionUiRequest } from '../types';
import type { OrchestratorStatus, TaskConfig, TaskRecord, TaskRunRecord } from './types';

export interface TaskQueuePayload {
  tasks: TaskRecord[];
  runs: TaskRunRecord[];
  orchestrator: OrchestratorStatus;
  config: TaskConfig;
}

export interface TaskGroups {
  running: TaskRecord[];
  queued: TaskRecord[];
  blocked: TaskRecord[];
  done: TaskRecord[];
}

export function isTaskLocked(task: Pick<TaskRecord, 'status'>): boolean {
  return task.status === 'IN_PROGRESS';
}

/** The queue board groups every status into four readable sections. */
export function groupTasks(tasks: TaskRecord[]): TaskGroups {
  const groups: TaskGroups = { running: [], queued: [], blocked: [], done: [] };
  for (const task of tasks) {
    if (task.status === 'IN_PROGRESS') groups.running.push(task);
    else if (task.status === 'PENDING') groups.queued.push(task);
    else if (task.status === 'DONE') groups.done.push(task);
    else groups.blocked.push(task);
  }
  const byRank = (a: TaskRecord, b: TaskRecord) => a.rank - b.rank || a.id - b.id;
  groups.queued.sort(byRank);
  return groups;
}

/**
 * The pending order after moving one task. Returns null when the task is not
 * pending or the move does nothing, so the caller sends no request.
 */
export function reorderPending(
  tasks: TaskRecord[],
  taskId: number,
  direction: 'up' | 'down'
): number[] | null {
  const pending = tasks
    .filter((task) => task.status === 'PENDING')
    .sort((a, b) => a.rank - b.rank || a.id - b.id);
  const index = pending.findIndex((task) => task.id === taskId);
  if (index < 0) return null;
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= pending.length) return null;
  const ordered = pending.map((task) => task.id);
  const [moved] = ordered.splice(index, 1);
  ordered.splice(target, 0, moved);
  return ordered;
}

/**
 * What the queue does next, in one sentence the board can show beside the
 * controls. Derived from stored state only; nothing is inferred from timing.
 */
export function queueControl(status: OrchestratorStatus): 'start' | 'pause' | 'resume' | 'abort' {
  if (status.state === 'RUNNING') {
    return status.activeTaskId === null ? 'pause' : 'abort';
  }
  if (status.state === 'PAUSED') return 'resume';
  return 'start';
}

/**
 * An `ask_user` question rendered by the existing AskUserPanel. Its request
 * shape is the same one the chat host uses, so the panel is not duplicated.
 */
export function questionRequestFor(task: TaskRecord): ExtensionUiRequest | null {
  const question = task.pendingQuestion;
  if (!question) return null;
  return {
    type: 'extension_ui_request',
    id: `task-${task.id}-${question.requestId}`,
    method: question.options.length > 0 ? 'select' : 'input',
    title: question.question,
    options: question.options.length > 0 ? [...question.options, ASK_USER_OTHER_LABEL] : undefined,
    question: { options: question.options }
  } as ExtensionUiRequest;
}

/**
 * Where the detail pane belongs. The side column needs desktop room; the sheet
 * needs an explicit open because it covers the board. A draft opens either one
 * before any task exists, which is how the very first task gets made.
 */
export function detailPlacement(options: {
  overlay: boolean;
  hasTask: boolean;
  hasDraft: boolean;
  sheetOpen: boolean;
}): 'side' | 'sheet' | 'none' {
  if (!options.hasTask && !options.hasDraft) return 'none';
  if (!options.overlay) return 'side';
  return options.sheetOpen || options.hasDraft ? 'sheet' : 'none';
}

/**
 * The ids between two rows, inclusive, in the order they are shown. A target
 * that is not in the list (a filtered or removed row) selects only itself.
 */
export function rangeSelection(order: number[], fromId: number, toId: number): number[] {
  const from = order.indexOf(fromId);
  const to = order.indexOf(toId);
  if (from < 0 || to < 0) return [toId];
  return order.slice(Math.min(from, to), Math.max(from, to) + 1);
}

/** Ids of the tasks a "remove completed" action would delete. */
export function completedTaskIds(tasks: Pick<TaskRecord, 'id' | 'status'>[]): number[] {
  return tasks.filter((task) => task.status === 'DONE').map((task) => task.id);
}

export function taskElapsedMs(task: TaskRecord, now = Date.now()): number | null {
  const start = task.runStartedAt ?? task.updatedAt;
  const end = task.finishedAt ?? (task.status === 'IN_PROGRESS' ? null : task.updatedAt);
  const startMs = Date.parse(start);
  if (!Number.isFinite(startMs)) return null;
  const endMs = end ? Date.parse(end) : now;
  if (!Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startMs);
}

/** A task runs its verification commands only when the list is not empty. */
export function hasVerification(task: TaskRecord, config: TaskConfig): boolean {
  return (task.verifyCommands ?? config.verifyCommands).length > 0;
}
