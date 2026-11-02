/**
 * Session ids the queue is currently driving.
 *
 * This is the only module the chat runtime knows about. The agent route asks it
 * before accepting a prompt, so two writers never append to one session file.
 * A queue-less build loses the protection and keeps the client-side notice.
 */

const KEY: symbol = Symbol.for('pie:task-active-sessions');

function registry(): Set<string> {
  const host = globalThis as typeof globalThis & { [KEY]?: Set<string> };
  return (host[KEY] ??= new Set());
}

export function markTaskSessionActive(sessionId: string): void {
  if (sessionId) registry().add(sessionId);
}

export function clearTaskSessionActive(sessionId: string): void {
  registry().delete(sessionId);
}

export function isTaskSessionActive(sessionId: string): boolean {
  return registry().has(sessionId);
}

export function activeTaskSessionIds(): string[] {
  return [...registry()];
}
