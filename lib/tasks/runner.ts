/**
 * One task attempt in one child process.
 *
 * The runner owns the conversation with a single Pi CLI child: it sends the
 * prompt, tracks what the child is doing for the board, answers an `ask_user`
 * question on the person's behalf, and reports one outcome. It does not touch the
 * database or the queue; the orchestrator does that around it.
 */
import type { spawn } from 'node:child_process';
import { ASK_USER_OTHER_LABEL } from '../ask-user-labels';
import {
  buildTaskChildCommand,
  TaskRpcSession,
  type TaskChildCommand
} from './rpc-session';
import type { TaskActivity, TaskActivityKind, TaskAnswerInput, PendingQuestion } from './types';

export type TaskRunStatus = 'succeeded' | 'failed' | 'timeout' | 'aborted';

export interface TaskRunOutcome {
  status: TaskRunStatus;
  exitCode: number | null;
  /** A short human-readable report for the board. */
  summary: string;
  outputTail: string;
  sessionId: string;
}

export interface TaskRunRequest {
  taskId: number;
  prompt: string;
  cwd: string;
  sessionId: string;
  sessionName: string;
  projectTrusted: boolean;
  askUserExtensionPath?: string | null;
  timeoutMs: number;
  /** Tests supply a fixture child instead of the installed CLI. */
  childCommand?: TaskChildCommand;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  spawnFn?: typeof spawn;
  now?: () => Date;
  onActivity?: (activity: TaskActivity) => void;
  onQuestion?: (question: PendingQuestion | null) => void;
  onOutput?: (tail: string) => void;
}

export interface TaskRunHandle {
  session: TaskRpcSession;
  result: Promise<TaskRunOutcome>;
  answer(input: TaskAnswerInput): Promise<void>;
  abort(): Promise<void>;
  activity(): TaskActivity | null;
  output(): string;
}

const SUMMARY_LIMIT = 4_000;
const TOOL_READ = new Set(['read', 'ls', 'grep', 'find', 'glob']);
const TOOL_WRITE = new Set(['write', 'edit', 'apply_patch', 'patch']);
const TIMEOUT = Symbol('timeout');

class NoPendingQuestionError extends Error {
  readonly code = 'no_pending_question';
  constructor() {
    super('The task has no pending question');
    this.name = 'NoPendingQuestionError';
  }
}

function assistantText(message: unknown): string {
  if (!message || typeof message !== 'object') return '';
  const record = message as { role?: unknown; content?: unknown };
  if (record.role !== 'assistant' || !Array.isArray(record.content)) return '';
  return record.content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        Boolean(block) &&
        typeof block === 'object' &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
    )
    .map((block) => block.text)
    .join('\n')
    .trim();
}

function toolDetail(name: string, args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const record = args as Record<string, unknown>;
  void name;
  for (const key of ['file_path', 'filePath', 'path', 'command', 'pattern', 'query']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim().slice(0, 160);
    }
  }
  return null;
}

function activityKindForTool(name: string): TaskActivityKind {
  if (TOOL_WRITE.has(name)) return 'writing';
  if (TOOL_READ.has(name)) return 'reading';
  return 'running';
}

export function startTaskRun(request: TaskRunRequest): TaskRunHandle {
  const now = request.now ?? (() => new Date());
  const command =
    request.childCommand ??
    buildTaskChildCommand({
      cwd: request.cwd,
      sessionId: request.sessionId,
      sessionName: request.sessionName,
      projectTrusted: request.projectTrusted,
      askUserExtensionPath: request.askUserExtensionPath ?? null
    });

  const session = new TaskRpcSession({
    command,
    cwd: request.cwd,
    env: request.env,
    platform: request.platform,
    spawnFn: request.spawnFn
  });

  let latestActivity: TaskActivity | null = null;
  let pendingQuestion: PendingQuestion | null = null;
  let typedAnswer: string | null = null;
  let abortRequested = false;
  let lastAssistantText = '';
  let outputTail = '';

  const setActivity = (kind: TaskActivityKind, detail: string | null) => {
    latestActivity = { taskId: request.taskId, kind, detail, at: now().toISOString() };
    try {
      request.onActivity?.(latestActivity);
    } catch {
      // A board callback must not break the run.
    }
  };

  const setQuestion = (question: PendingQuestion | null) => {
    pendingQuestion = question;
    try {
      request.onQuestion?.(question);
    } catch {
      // A board callback must not break the run.
    }
  };

  const appendTail = (text: string) => {
    if (!text) return;
    session.appendTail(text);
    outputTail = session.getTail();
    try {
      request.onOutput?.(outputTail);
    } catch {
      // A board callback must not break the run.
    }
  };

  const respond = (id: string, payload: Record<string, unknown>) => {
    void session.sendRaw({ type: 'extension_ui_response', id, ...payload }).catch(() => {
      // The child may have exited; nothing left to answer.
    });
  };

  const handleUiRequest = (record: Record<string, unknown>) => {
    const id = typeof record.id === 'string' ? record.id : null;
    if (!id) return;
    const method = record.method;
    const title = typeof record.title === 'string' ? record.title : '';
    if (method === 'select') {
      const options = Array.isArray(record.options)
        ? record.options.filter((option): option is string => typeof option === 'string')
        : [];
      if (options.includes(ASK_USER_OTHER_LABEL)) {
        setQuestion({
          requestId: id,
          question: title,
          options: options.filter((option) => option !== ASK_USER_OTHER_LABEL),
          awaitingInput: false,
          askedAt: now().toISOString()
        });
        appendTail(`\n[question] ${title}\n`);
        return;
      }
      // A dialog nobody can answer in an unattended run is dismissed, never guessed.
      respond(id, { cancelled: true });
      return;
    }
    if (method === 'input') {
      if (typedAnswer !== null) {
        const answer = typedAnswer;
        typedAnswer = null;
        respond(id, { value: answer });
        setQuestion(null);
        return;
      }
      setQuestion({
        requestId: id,
        question: title,
        options: [],
        awaitingInput: false,
        askedAt: now().toISOString()
      });
      appendTail(`\n[question] ${title}\n`);
      return;
    }
    if (method === 'confirm' || method === 'editor') {
      respond(id, { cancelled: true });
    }
    // notify, setStatus, setWidget and setTitle are fire-and-forget: ignore them.
  };

  session.onRecord((record) => {
    const type = record.type;
    if (type === 'extension_ui_request') {
      handleUiRequest(record);
      return;
    }
    if (type === 'agent_start') {
      setActivity('waiting', null);
      return;
    }
    if (type === 'message_start') {
      const message = record.message as { role?: unknown } | undefined;
      if (message?.role === 'assistant') setActivity('waiting', null);
      return;
    }
    if (type === 'message_update') {
      const update = record.assistantMessageEvent as
        | { type?: unknown; delta?: unknown; toolCall?: { toolName?: unknown } }
        | undefined;
      const updateType =
        update && typeof update.type === 'string' ? update.type : undefined;
      if (updateType && updateType.startsWith('thinking')) {
        setActivity('thinking', null);
      } else if (updateType && updateType.startsWith('text')) {
        setActivity('thinking', null);
        if (typeof update?.delta === 'string') appendTail(update.delta);
      } else if (updateType === 'toolcall_end') {
        const name = update?.toolCall?.toolName;
        if (typeof name === 'string') setActivity(activityKindForTool(name), name);
      }
      return;
    }
    if (type === 'tool_execution_start') {
      const name = typeof record.toolName === 'string' ? record.toolName : 'tool';
      setActivity(activityKindForTool(name), toolDetail(name, record.args));
      appendTail(`\n[${name}] ${toolDetail(name, record.args) ?? ''}\n`);
      return;
    }
    if (type === 'message_end') {
      const text = assistantText(record.message);
      if (text) {
        lastAssistantText = text;
        appendTail(`\n${text}\n`);
      }
      setActivity('waiting', null);
      return;
    }
    if (type === 'agent_end') {
      setActivity('waiting', null);
    }
  });

  const result = (async (): Promise<TaskRunOutcome> => {
    try {
      session.start();
    } catch (error) {
      return {
        status: 'failed',
        exitCode: null,
        summary: error instanceof Error ? error.message : String(error),
        outputTail,
        sessionId: request.sessionId
      };
    }
    setActivity('starting', null);
    try {
      const response = await session.prompt(request.prompt);
      const data = response.data as { disposition?: unknown } | undefined;
      if (response.success !== true) {
        return {
          status: 'failed',
          exitCode: null,
          summary: `Pi rejected the prompt: ${String(response.error ?? 'unknown error')}`,
          outputTail,
          sessionId: request.sessionId
        };
      }
      if (data?.disposition === 'handled') {
        await session.close();
        return {
          status: 'failed',
          exitCode: session.exitCode,
          summary: 'The prompt was handled by an extension instead of starting a run',
          outputTail,
          sessionId: request.sessionId
        };
      }
    } catch (error) {
      await session.close();
      return {
        status: abortRequested ? 'aborted' : 'failed',
        exitCode: session.exitCode,
        summary: maskStop(abortRequested, errorMessage(error, session)),
        outputTail,
        sessionId: request.sessionId
      };
    }

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), Math.max(request.timeoutMs, 0));
      timer.unref?.();
    });
    const settled = await Promise.race([session.waitForSettled().catch((error) => error), timeout]);
    if (timer) clearTimeout(timer);

    if (settled === TIMEOUT) {
      await session.abort();
      return {
        status: 'timeout',
        exitCode: session.exitCode,
        summary: `The task did not finish within ${Math.round(request.timeoutMs / 60000)} minutes`,
        outputTail,
        sessionId: request.sessionId
      };
    }
    if (settled instanceof Error) {
      const wasStopped = abortRequested || session.stopWasRequested;
      await session.close();
      return {
        status: wasStopped ? 'aborted' : 'failed',
        exitCode: session.exitCode,
        summary: maskStop(abortRequested, settled.message),
        outputTail,
        sessionId: request.sessionId
      };
    }
    if (settled.aborted && abortRequested) {
      await session.close();
      return {
        status: 'aborted',
        exitCode: session.exitCode,
        summary: 'aborted by user',
        outputTail,
        sessionId: request.sessionId
      };
    }

    // Pi stays alive in RPC mode until stdin closes, so an orderly shutdown both
    // ends the process and gives the exit status this outcome reports.
    await session.close();
    const exitCode = session.exitCode;
    if (abortRequested) {
      return {
        status: 'aborted',
        exitCode,
        summary: 'aborted by user',
        outputTail,
        sessionId: request.sessionId
      };
    }
    if (exitCode !== 0) {
      return {
        status: 'failed',
        exitCode,
        summary: `The Pi process exited with code ${exitCode ?? 'null'}${settled.aborted ? ' after an abort' : ''}`,
        outputTail,
        sessionId: request.sessionId
      };
    }
    return {
      status: 'succeeded',
      exitCode,
      summary: clipSummary(lastAssistantText || 'The task finished without a final message'),
      outputTail,
      sessionId: request.sessionId
    };
  })();

  return {
    session,
    result,
    async answer(input: TaskAnswerInput): Promise<void> {
      const question = pendingQuestion;
      if (!question || question.awaitingInput) throw new NoPendingQuestionError();
      const answer = typeof input.answer === 'string' ? input.answer.trim() : '';
      if (input.cancelled) {
        respond(question.requestId, { cancelled: true });
        setQuestion(null);
        appendTail('\n[question] dismissed\n');
        return;
      }
      if (!answer) throw new Error('An answer is required');
      if (question.options.includes(answer)) {
        respond(question.requestId, { value: answer });
        setQuestion(null);
        appendTail(`\n[answer] ${answer}\n`);
        return;
      }
      if (question.options.length === 0) {
        respond(question.requestId, { value: answer });
        setQuestion(null);
        appendTail(`\n[answer] ${answer}\n`);
        return;
      }
      // The typed answer takes the same two steps the TUI uses: choose the
      // sentinel, then answer the follow-up input request with the text.
      typedAnswer = answer;
      setQuestion({ ...question, awaitingInput: true });
      respond(question.requestId, { value: ASK_USER_OTHER_LABEL });
      appendTail(`\n[answer] ${answer}\n`);
    },
    async abort(): Promise<void> {
      abortRequested = true;
      await session.abort();
    },
    activity(): TaskActivity | null {
      return latestActivity;
    },
    output(): string {
      return outputTail;
    }
  };
}

function clipSummary(text: string): string {
  return text.length <= SUMMARY_LIMIT ? text : `${text.slice(0, SUMMARY_LIMIT)}…`;
}

function maskStop(abortRequested: boolean, message: string): string {
  return abortRequested ? 'aborted by user' : message;
}

function errorMessage(error: unknown, session: TaskRpcSession): string {
  const message = error instanceof Error ? error.message : String(error);
  const stderr = session.stderr.trim();
  return stderr ? `${message}\n${stderr}` : message;
}
