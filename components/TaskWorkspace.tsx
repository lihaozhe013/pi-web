'use client';

/**
 * The task workspace: the queue board, the task editor, and the live activity of
 * the running task.
 *
 * It is one workspace of the app, reachable with `?mode=tasks`. Nothing here is
 * imported by the conversation; the workspace reads and writes the queue through
 * the seven `/api/tasks` routes and renders a task's session as an ordinary Pi
 * session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import { useMediaQuery } from '@/hooks/useIsMobile';
import { AskUserPanel } from './AskUserPanel';
import {
  detailPlacement,
  groupTasks,
  hasVerification,
  isTaskLocked,
  questionRequestFor,
  reorderPending,
  taskElapsedMs,
  type TaskQueuePayload
} from '@/lib/tasks/board';
import type { TaskRecord, TaskStatus } from '@/lib/tasks/types';

export interface TaskWorkspaceProps {
  /** Opens the task's ordinary Pi session in the chat view. */
  onOpenSession?: (sessionId: string) => void;
  /** `?task=<id>`: the task a deep link opens. */
  initialTaskId?: number | null;
  /** Test seam and first paint: the payload the first poll would return. */
  initialData?: TaskQueuePayload | null;
  /** Test seam: suspended polling. */
  polling?: boolean;
}

type Draft =
  | { mode: 'new' }
  | { mode: 'edit'; taskId: number }
  | null;

interface TaskFormState {
  title: string;
  description: string;
  cwd: string;
  verifyCommands: string;
  allowAskUser: 'default' | 'yes' | 'no';
  autoCommit: 'default' | 'yes' | 'no';
}

const EMPTY_FORM: TaskFormState = {
  title: '',
  description: '',
  cwd: '',
  verifyCommands: '',
  allowAskUser: 'default',
  autoCommit: 'default'
};

function taskForm(task: TaskRecord): TaskFormState {
  return {
    title: task.title,
    description: task.description ?? '',
    cwd: task.cwd,
    verifyCommands: (task.verifyCommands ?? []).join('\n'),
    allowAskUser:
      task.allowAskUser === null || task.allowAskUser === undefined
        ? 'default'
        : task.allowAskUser
          ? 'yes'
          : 'no',
    autoCommit:
      task.autoCommit === null || task.autoCommit === undefined
        ? 'default'
        : task.autoCommit
          ? 'yes'
          : 'no'
  };
}

function elapsedText(ms: number | null): string {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

const STATUS_ORDER: Record<TaskStatus, number> = {
  IN_PROGRESS: 0,
  PENDING: 1,
  BLOCKED: 2,
  FAILED: 3,
  DONE: 4
};

function statusTone(status: TaskStatus): string {
  if (status === 'IN_PROGRESS') return 'var(--accent)';
  if (status === 'DONE') return 'var(--success, #16a34a)';
  if (status === 'BLOCKED') return 'var(--warning, #d97706)';
  if (status === 'FAILED') return 'var(--danger, #dc2626)';
  return 'var(--text-dim)';
}

export function TaskWorkspace({
  onOpenSession,
  initialTaskId = null,
  initialData = null,
  polling = true
}: TaskWorkspaceProps) {
  const { t } = useI18n();
  // Matches the stylesheet: at or below 900px the detail covers the board.
  const overlayDetail = useMediaQuery('(max-width: 900px)');
  const [payload, setPayload] = useState<TaskQueuePayload | null>(initialData);
  const [selectedId, setSelectedId] = useState<number | null>(initialTaskId);
  const [sheetOpen, setSheetOpen] = useState(initialTaskId !== null);
  const [draft, setDraft] = useState<Draft>(null);
  const [form, setForm] = useState<TaskFormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const rowRefs = useRef(new Map<number, HTMLButtonElement>());
  const pendingFocusId = useRef<number | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const sheetReturnFocus = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/tasks', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = (await response.json()) as TaskQueuePayload;
      setPayload(data);
      setError(null);
      return data;
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : String(refreshError));
      return null;
    }
  }, []);

  const status = payload?.orchestrator ?? null;
  const tasks = useMemo(() => payload?.tasks ?? [], [payload]);
  const runningTask = tasks.find((task) => task.status === 'IN_PROGRESS') ?? null;
  const questionPending = Boolean(runningTask?.pendingQuestion);
  const interval = runningTask || questionPending ? 1_000 : 5_000;

  // Polling: fast while work happens, slow otherwise, suspended with the page.
  useEffect(() => {
    if (!polling) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (delay: number) => {
      timer = setTimeout(tick, delay);
    };
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') {
        schedule(interval);
        return;
      }
      await refresh();
      if (!stopped) schedule(interval);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !stopped) {
        if (timer) clearTimeout(timer);
        void tick();
      }
    };
    void tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [interval, polling, refresh]);

  // The live tail of the running task, read from the server's bounded buffer.
  useEffect(() => {
    if (!polling || !runningTask) {
      setOutput('');
      return;
    }
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      if (stopped) return;
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(tick, 2_000);
        return;
      }
      try {
        const response = await fetch(`/api/tasks/${runningTask.id}/output`, { cache: 'no-store' });
        if (response.ok) {
          const data = (await response.json()) as { output?: string };
          setOutput(data.output ?? '');
        }
      } catch {
        // The next tick retries; the board keeps showing the queue.
      }
      if (!stopped) timer = setTimeout(tick, 1_000);
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [polling, runningTask]);

  const groups = useMemo(() => groupTasks(tasks), [tasks]);
  const selected = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? runningTask ?? tasks[0] ?? null,
    [runningTask, selectedId, tasks]
  );
  const questionRequest = selected ? questionRequestFor(selected) : null;
  // A draft must place the pane even with an empty board, and on a phone the
  // sheet opens only when asked, so closing it does not reopen on the fallback.
  const placement = detailPlacement({
    overlay: overlayDetail,
    hasTask: selected !== null,
    hasDraft: draft !== null,
    sheetOpen
  });

  const focusTask = useCallback((taskId: number | null) => {
    pendingFocusId.current = taskId;
  }, []);

  useEffect(() => {
    const id = pendingFocusId.current;
    if (id === null) return;
    const element = rowRefs.current.get(id);
    if (element) {
      element.focus();
      pendingFocusId.current = null;
    }
    // A reorder repaints the rows; focus returns after that paint.
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- tasks is the repaint signal.
  }, [tasks]);

  const call = useCallback(
    async (input: string, init: RequestInit): Promise<unknown | null> => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(input, {
          ...init,
          headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
        });
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
          [key: string]: unknown;
        };
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        await refresh();
        return data;
      } catch (callError) {
        setError(callError instanceof Error ? callError.message : String(callError));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  // The sheet covers the board, so it remembers the control that opened it and
  // hands focus back there; a phone keyboard user is never left on the body.
  const openSheet = useCallback(() => {
    if (typeof document !== 'undefined') {
      sheetReturnFocus.current = document.activeElement as HTMLElement | null;
    }
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSelectedId(null);
    setDraft(null);
    setSheetOpen(false);
    const target = sheetReturnFocus.current;
    sheetReturnFocus.current = null;
    if (target?.isConnected) requestAnimationFrame(() => target.focus());
  }, []);

  const startNewTask = useCallback(() => {
    const cwd = selected?.cwd ?? runningTask?.cwd ?? '';
    setForm({ ...EMPTY_FORM, cwd });
    setDraft({ mode: 'new' });
    openSheet();
  }, [openSheet, runningTask?.cwd, selected?.cwd]);

  const startEdit = useCallback(
    (task: TaskRecord) => {
      if (isTaskLocked(task)) return;
      setForm(taskForm(task));
      setDraft({ mode: 'edit', taskId: task.id });
      setSelectedId(task.id);
      openSheet();
    },
    [openSheet]
  );

  const closeDraft = useCallback(() => {
    setDraft(null);
    setError(null);
  }, []);

  // A modal dialog takes focus and answers Escape even while focus is still on
  // the board behind it. An open draft focuses its own title field instead.
  useEffect(() => {
    if (placement !== 'sheet' || draft) return;
    sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeSheet();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeSheet, draft, placement]);

  const saveDraft = useCallback(async () => {
    const verifyCommands = form.verifyCommands
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const body: Record<string, unknown> = {
      title: form.title,
      description: form.description || null,
      cwd: form.cwd,
      verify_commands: verifyCommands,
      allow_ask_user: form.allowAskUser === 'default' ? null : form.allowAskUser === 'yes',
      auto_commit: form.autoCommit === 'default' ? null : form.autoCommit === 'yes'
    };
    if (draft?.mode === 'new') {
      const result = (await call('/api/tasks', {
        method: 'POST',
        body: JSON.stringify(body)
      })) as { task?: TaskRecord } | null;
      if (result?.task) {
        setSelectedId(result.task.id);
        setDraft(null);
        setSheetOpen(true);
      }
      return;
    }
    if (draft?.mode === 'edit') {
      const result = (await call(`/api/tasks/${draft.taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'update', ...body })
      })) as { task?: TaskRecord } | null;
      if (result?.task) setDraft(null);
    }
  }, [call, draft, form]);

  const removeTask = useCallback(
    async (task: TaskRecord) => {
      if (isTaskLocked(task)) return;
      const result = await call(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (result) {
        if (selectedId === task.id) {
          setSelectedId(null);
          setSheetOpen(false);
        }
        if (draft?.mode === 'edit' && draft.taskId === task.id) setDraft(null);
      }
    },
    [call, draft, selectedId]
  );

  const moveTask = useCallback(
    async (task: TaskRecord, direction: 'up' | 'down') => {
      if (isTaskLocked(task)) return;
      const ordered = reorderPending(tasks, task.id, direction);
      if (!ordered) return;
      setSelectedId(task.id);
      focusTask(task.id);
      await call(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'move', direction })
      });
    },
    [call, focusTask, tasks]
  );

  const control = useCallback(
    async (action: 'start' | 'pause' | 'resume' | 'abort') => {
      await call('/api/tasks/control', {
        method: 'POST',
        body: JSON.stringify({ action })
      });
    },
    [call]
  );

  const answerQuestion = useCallback(
    async (
      response: { value: string } | { cancelled: true }
    ): Promise<void> => {
      if (!selected) return;
      const result = await call(`/api/tasks/${selected.id}/answer`, {
        method: 'POST',
        body: JSON.stringify(
          'value' in response ? { answer: response.value } : { cancelled: true }
        )
      });
      if (!result) throw new Error('the answer was not accepted');
    },
    [call, selected]
  );

  /** The strip asks for the running task, which may not be the selected one. */
  const answerFor = useCallback(
    async (task: TaskRecord, response: { value: string } | { cancelled: true }): Promise<void> => {
      const result = await call(`/api/tasks/${task.id}/answer`, {
        method: 'POST',
        body: JSON.stringify(
          'value' in response ? { answer: response.value } : { cancelled: true }
        )
      });
      if (!result) throw new Error('the answer was not accepted');
    },
    [call]
  );

  const onRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, task: TaskRecord) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        void moveTask(task, 'up');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        void moveTask(task, 'down');
      } else if (event.key === 'Enter') {
        event.preventDefault();
        startEdit(task);
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        void removeTask(task);
      }
    },
    [moveTask, removeTask, startEdit]
  );

  const statusLabel = (value: TaskStatus): string => {
    if (value === 'IN_PROGRESS') return t('tasks.status.inProgress');
    if (value === 'PENDING') return t('tasks.status.pending');
    if (value === 'DONE') return t('tasks.status.done');
    if (value === 'BLOCKED') return t('tasks.status.blocked');
    return t('tasks.status.failed');
  };

  const activityLabel = status?.activity
    ? t(`tasks.activity.${status.activity.kind}`) +
      (status.activity.detail ? ` · ${status.activity.detail}` : '')
    : null;

  const renderRow = (task: TaskRecord) => {
    const locked = isTaskLocked(task);
    const active = selected?.id === task.id;
    return (
      <button
        key={task.id}
        ref={(element) => {
          if (element) rowRefs.current.set(task.id, element);
          else rowRefs.current.delete(task.id);
        }}
        type="button"
        className="task-row"
        data-active={active}
        data-status={task.status}
        aria-current={active ? 'true' : undefined}
        aria-label={`${statusLabel(task.status)}: ${task.title}`}
        title={
          locked
            ? t('tasks.lockedExplanation')
            : `${t('tasks.reorderHint')} · ${t('tasks.editHint')}`
        }
        onClick={() => {
          setSelectedId(task.id);
          setDraft(null);
          openSheet();
        }}
        onDoubleClick={() => startEdit(task)}
        onKeyDown={(event) => onRowKeyDown(event, task)}
      >
        <span
          className="task-row-marker"
          style={{ background: statusTone(task.status) }}
          aria-hidden="true"
        />
        <span className="task-row-body">
          <span className="task-row-title">{task.title}</span>
          <span className="task-row-meta">
            <span className="task-row-cwd">{task.cwd}</span>
            <span>
              {t('tasks.attempts', { count: task.attempts })} ·{' '}
              {elapsedText(taskElapsedMs(task))}
            </span>
          </span>
        </span>
        <span className="task-row-status">{statusLabel(task.status)}</span>
      </button>
    );
  };

  const groupSection = (key: 'running' | 'queued' | 'blocked' | 'done', list: TaskRecord[]) => {
    if (list.length === 0) return null;
    return (
      <section className="task-group" key={key} aria-label={t(`tasks.group.${key}`)}>
        <h3 className="task-group-title">
          {t(`tasks.group.${key}`)}
          <span className="task-group-count">{list.length}</span>
        </h3>
        <div className="task-group-list">{list.map(renderRow)}</div>
      </section>
    );
  };

  return (
    <div className="task-workspace">
      <div className="task-topbar">
        <span className="task-topbar-title">{t('tasks.board')}</span>
        {status && (
          <span className="task-topbar-state" data-state={status.state}>
            {t(`tasks.queueState.${status.state.toLowerCase()}`)}
          </span>
        )}
        <div className="task-topbar-actions">
          {status?.state === 'RUNNING' ? (
            <button
              type="button"
              className="task-control"
              disabled={busy}
              onClick={() => void control('pause')}
            >
              {t('tasks.pause')}
            </button>
          ) : (
            <button
              type="button"
              className="task-control is-primary"
              disabled={busy || status?.state === 'PAUSED'}
              onClick={() => void control('start')}
            >
              {t('tasks.start')}
            </button>
          )}
          <button
            type="button"
            className="task-control"
            data-task-action="resume"
            disabled={busy || status?.state !== 'PAUSED'}
            onClick={() => void control('resume')}
          >
            {t('tasks.resume')}
          </button>
          <button
            type="button"
            className="task-control is-danger"
            disabled={busy || !runningTask}
            onClick={() => void control('abort')}
          >
            {t('tasks.abort')}
          </button>
          <button
            type="button"
            className="task-control is-primary"
            disabled={busy}
            onClick={startNewTask}
          >
            {t('tasks.new')}
          </button>
        </div>
      </div>

      {status?.pausedReason && status.state === 'PAUSED' && (
        <div className="task-banner" role="status">
          {t('tasks.pausedReason')}: {status.pausedReason}
        </div>
      )}
      {error && (
        <div className="task-banner is-error" role="alert">
          {error}
        </div>
      )}
      {/* The same panel the chat composer uses: a waiting question is answered
          from here without opening the detail column. */}
      {runningTask?.pendingQuestion && questionRequestFor(runningTask) && (
        <div className="task-question-strip">
          <AskUserPanel
            key={`strip-${runningTask.id}-${runningTask.pendingQuestion.requestId}`}
            request={questionRequestFor(runningTask) as never}
            waitingCount={0}
            onRespond={(_request, response) => answerFor(runningTask, response)}
            onReturnFocus={() => {}}
          />
        </div>
      )}

      <div className="task-body">
        <div className="task-list-column">
          <div className="task-list-heading">
            <span>{t('tasks.group.queued')}</span>
            <span className="task-group-count">{groups.queued.length}</span>
          </div>
          <div className="task-list-scroll">
            {tasks.length === 0 ? (
              <p className="task-empty">{t('tasks.empty')}</p>
            ) : (
              <>
                {groupSection('running', groups.running)}
                {groupSection('queued', groups.queued)}
                {groupSection('blocked', groups.blocked)}
                {groupSection('done', groups.done)}
              </>
            )}
          </div>
        </div>

        <main className="task-board" aria-label={t('tasks.board')}>
          {tasks.length === 0 ? (
            <div className="task-board-empty">
              <p>{t('tasks.empty')}</p>
              <button type="button" className="task-control is-primary" onClick={startNewTask}>
                {t('tasks.new')}
              </button>
            </div>
          ) : (
            tasks
              .slice()
              .sort(
                (a, b) =>
                  STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.rank - b.rank || a.id - b.id
              )
              .map(renderRow)
          )}
          <p className="task-keyboard-hint">{t('tasks.reorderHint')}</p>
        </main>

        {placement === 'side' && (
          <aside className="task-detail" aria-label={t('tasks.detail')}>
            {renderDetail()}
          </aside>
        )}
      </div>

      {placement === 'sheet' && (
        <div
          ref={sheetRef}
          tabIndex={-1}
          className="task-detail-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={t('tasks.detail')}
        >
          <button type="button" className="task-sheet-close" onClick={closeSheet}>
            {t('tasks.close')}
          </button>
          <div className="task-detail">{renderDetail()}</div>
        </div>
      )}
    </div>
  );

  function renderDetail() {
    // The new-task form is the one detail pane that exists before a task does.
    if (draft) return renderForm();
    if (!selected) return null;
    const locked = isTaskLocked(selected);
    return (
      <>
        <h2 className="task-detail-title">{selected.title}</h2>
        <p className="task-detail-status" data-status={selected.status}>
          <span className="task-row-marker" style={{ background: statusTone(selected.status) }} />
          {statusLabel(selected.status)}
          {selected.attempts > 0 && ` · ${t('tasks.attempts', { count: selected.attempts })}`}
        </p>
        {selected.description && <p className="task-detail-text">{selected.description}</p>}
        <dl className="task-facts">
          <dt>{t('tasks.cwdLabel')}</dt>
          <dd className="task-mono">{selected.cwd}</dd>
          {selected.resultSummary && (
            <>
              <dt>{t('tasks.result')}</dt>
              <dd className="task-mono task-summary">{selected.resultSummary}</dd>
            </>
          )}
          {selected.verifyOutput && (
            <>
              <dt>{t('tasks.verifyOutput')}</dt>
              <dd className="task-mono task-summary">{selected.verifyOutput}</dd>
            </>
          )}
          {selected.commitSha && (
            <>
              <dt>{t('tasks.commit')}</dt>
              <dd className="task-mono">{selected.commitSha.slice(0, 12)}</dd>
            </>
          )}
          <dt>{t('tasks.verification')}</dt>
          <dd>
            {payload && hasVerification(selected, payload.config)
              ? (selected.verifyCommands ?? payload.config.verifyCommands).join(' · ')
              : t('tasks.noVerification')}
          </dd>
          {selected.sessionId && (
            <>
              <dt>{t('tasks.session')}</dt>
              <dd>
                <button
                  type="button"
                  className="task-link"
                  onClick={() => onOpenSession?.(selected.sessionId as string)}
                >
                  {t('tasks.openSession')}
                </button>
              </dd>
            </>
          )}
        </dl>
        {selected.pendingQuestion && questionRequest && (
          <AskUserPanel
            key={questionRequest.id}
            request={questionRequest as never}
            waitingCount={0}
            onRespond={(_request, response) => answerQuestion(response)}
            onReturnFocus={() => {}}
          />
        )}
        {runningTask?.id === selected.id && activityLabel && (
          <p className="task-activity" role="status">
            <span className="task-activity-dot" aria-hidden="true" />
            {activityLabel}
          </p>
        )}
        {selected.status === 'IN_PROGRESS' && output && (
          <details className="task-tail" open>
            <summary>{t('tasks.liveTail')}</summary>
            <pre className="task-mono">{output.slice(-4_000)}</pre>
          </details>
        )}
        <div className="task-detail-actions">
          <button
            type="button"
            className="task-control"
            data-task-action="edit"
            disabled={locked || busy}
            title={locked ? t('tasks.lockedExplanation') : undefined}
            onClick={() => startEdit(selected)}
          >
            {t('tasks.edit')}
          </button>
          {(selected.status === 'BLOCKED' || selected.status === 'FAILED') && (
            <button
              type="button"
              className="task-control"
              disabled={busy}
              onClick={() =>
                void call(`/api/tasks/${selected.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ action: 'retry' })
                })
              }
            >
              {t('tasks.retry')}
            </button>
          )}
          {selected.status !== 'DONE' && (
            <button
              type="button"
              className="task-control"
              disabled={locked || busy}
              onClick={() =>
                void call(`/api/tasks/${selected.id}`, {
                  method: 'PATCH',
                  body: JSON.stringify({ action: 'markDone' })
                })
              }
            >
              {t('tasks.markDone')}
            </button>
          )}
          <button
            type="button"
            className="task-control is-danger"
            data-task-action="delete"
            disabled={locked || busy}
            title={locked ? t('tasks.lockedExplanation') : undefined}
            onClick={() => void removeTask(selected)}
          >
            {t('tasks.delete')}
          </button>
        </div>
      </>
    );
  }

  function renderForm() {
    return (
      <form
        className="task-form"
        onSubmit={(event) => {
          event.preventDefault();
          void saveDraft();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            closeDraft();
          }
        }}
      >
        <h2 className="task-detail-title">
          {draft?.mode === 'new' ? t('tasks.new') : t('tasks.edit')}
        </h2>
        <label className="task-field">
          <span>{t('tasks.titleLabel')}</span>
          <input
            value={form.title}
            required
            autoFocus
            onChange={(event) => setForm({ ...form, title: event.target.value })}
          />
        </label>
        <label className="task-field">
          <span>{t('tasks.descriptionLabel')}</span>
          <textarea
            rows={4}
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </label>
        <label className="task-field">
          <span>{t('tasks.cwdLabel')}</span>
          <input
            className="task-mono"
            value={form.cwd}
            required
            onChange={(event) => setForm({ ...form, cwd: event.target.value })}
          />
          <span className="task-hint">{t('tasks.cwdHint')}</span>
        </label>
        <label className="task-field">
          <span>{t('tasks.verifyCommandsLabel')}</span>
          <textarea
            className="task-mono"
            rows={3}
            placeholder={t('tasks.verifyCommandsHint')}
            value={form.verifyCommands}
            onChange={(event) => setForm({ ...form, verifyCommands: event.target.value })}
          />
        </label>
        <label className="task-field">
          <span>{t('tasks.allowAskUser')}</span>
          <select
            value={form.allowAskUser}
            onChange={(event) =>
              setForm({ ...form, allowAskUser: event.target.value as TaskFormState['allowAskUser'] })
            }
          >
            <option value="default">{t('tasks.inherit')}</option>
            <option value="yes">{t('tasks.enabled')}</option>
            <option value="no">{t('tasks.disabled')}</option>
          </select>
        </label>
        <label className="task-field">
          <span>{t('tasks.autoCommit')}</span>
          <select
            value={form.autoCommit}
            onChange={(event) =>
              setForm({ ...form, autoCommit: event.target.value as TaskFormState['autoCommit'] })
            }
          >
            <option value="default">{t('tasks.inherit')}</option>
            <option value="yes">{t('tasks.enabled')}</option>
            <option value="no">{t('tasks.disabled')}</option>
          </select>
        </label>
        <div className="task-detail-actions">
          <button type="submit" className="task-control is-primary" disabled={busy}>
            {t('tasks.save')}
          </button>
          <button type="button" className="task-control" onClick={closeDraft} disabled={busy}>
            {t('tasks.cancel')}
          </button>
        </div>
      </form>
    );
  }
}
