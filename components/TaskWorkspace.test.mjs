import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { TaskWorkspace } = await jiti.import('./TaskWorkspace.tsx');
const {
  completedTaskIds,
  detailPlacement,
  groupTasks,
  rangeSelection,
  reorderPending,
  questionRequestFor,
  isTaskLocked
} = await jiti.import('@/lib/tasks/board.ts');

const CONFIG = {
  verifyCommands: [],
  verifyTimeoutMs: 600000,
  taskTimeoutMs: 3600000,
  allowAskUser: false,
  autoCommit: false,
  commitMessage: 'chore(task): #{id} {title}'
};

function task(overrides = {}) {
  return {
    id: 1,
    title: 'Fix the gate',
    description: null,
    status: 'PENDING',
    rank: 10,
    cwd: '/repo',
    allowAskUser: null,
    verifyCommands: null,
    autoCommit: null,
    sessionId: null,
    claimedToken: null,
    pendingQuestion: null,
    attempts: 0,
    resultSummary: null,
    exitCode: null,
    verifyOutput: null,
    commitSha: null,
    runStartedAt: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    finishedAt: null,
    ...overrides
  };
}

function payload(tasks, overrides = {}) {
  return {
    tasks,
    runs: [],
    orchestrator: {
      state: 'PAUSED',
      pausedReason: null,
      activeTaskId: null,
      running: false,
      activity: null,
      ...overrides
    },
    config: CONFIG
  };
}

function render(data, options = {}) {
  return renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(TaskWorkspace, {
        initialData: data,
        polling: false,
        onOpenSession() {},
        ...options
      })
    )
  );
}

test('the board groups statuses into running, queued, blocked, and done', () => {
  const groups = groupTasks([
    task({ id: 1, status: 'PENDING', rank: 20 }),
    task({ id: 2, status: 'IN_PROGRESS' }),
    task({ id: 3, status: 'BLOCKED' }),
    task({ id: 4, status: 'FAILED' }),
    task({ id: 5, status: 'DONE' }),
    task({ id: 6, status: 'PENDING', rank: 10 })
  ]);
  assert.deepEqual(
    groups.running.map((entry) => entry.id),
    [2]
  );
  assert.deepEqual(
    groups.queued.map((entry) => entry.id),
    [6, 1]
  );
  assert.deepEqual(
    groups.blocked.map((entry) => entry.id),
    [3, 4]
  );
  assert.deepEqual(
    groups.done.map((entry) => entry.id),
    [5]
  );
});

test('keyboard reorder only rewrites the pending segment and stops at the ends', () => {
  const tasks = [
    task({ id: 1, status: 'PENDING', rank: 10 }),
    task({ id: 2, status: 'IN_PROGRESS', rank: 20 }),
    task({ id: 3, status: 'PENDING', rank: 30 })
  ];
  assert.deepEqual(reorderPending(tasks, 3, 'up'), [3, 1]);
  assert.equal(reorderPending(tasks, 1, 'up'), null);
  assert.equal(reorderPending(tasks, 3, 'down'), null);
  assert.equal(reorderPending(tasks, 2, 'up'), null);
});

test('a running task is locked and its controls are disabled', () => {
  const running = task({ status: 'IN_PROGRESS', attempts: 1 });
  assert.equal(isTaskLocked(running), true);
  // The detail is a sheet when the queue takes the center, so name the task to
  // open it: the list and the detail are both in the markup.
  const markup = render(payload([running], { state: 'RUNNING', activeTaskId: 1 }), {
    initialTaskId: 1
  });
  assert.match(markup, /aria-label="Running: Fix the gate"/);
  assert.match(markup, /data-task-action="edit" disabled=""/);
  assert.match(markup, /data-task-action="delete" disabled=""/);
  assert.match(markup, /A running task cannot be edited, deleted, or reordered/);
});

test('a pending task keeps its edit and delete controls usable', () => {
  const markup = render(payload([task()], { state: 'IDLE' }), { initialTaskId: 1 });
  assert.doesNotMatch(markup, /data-task-action="edit" disabled=""/);
  assert.doesNotMatch(markup, /data-task-action="delete" disabled=""/);
  assert.match(markup, /data-task-action="resume" disabled=""/);
});

test('a pending question renders through the existing AskUserPanel', () => {
  const asking = task({
    status: 'IN_PROGRESS',
    pendingQuestion: {
      requestId: 'q1',
      question: 'Which layout?',
      options: ['Sidebar', 'Tabs'],
      awaitingInput: false,
      askedAt: '2024-01-01T00:00:00.000Z'
    }
  });
  const markup = render(payload([asking], { state: 'RUNNING', activeTaskId: 1 }));
  assert.match(markup, /ask-user-panel/);
  assert.match(markup, /Which layout\?/);
  assert.match(markup, /Sidebar/);
  assert.match(markup, /Tabs/);

  const request = questionRequestFor(asking);
  assert.equal(request.method, 'select');
  assert.deepEqual(request.question.options, ['Sidebar', 'Tabs']);
  assert.equal(request.options.at(-1), 'Write my own answer…');
});

test('an empty queue still offers the new-task control', () => {
  const markup = render(payload([]));
  assert.match(markup, /No tasks yet/);
  assert.match(markup, /New task/);
});

test('the queue defaults are reachable from the board', () => {
  const markup = render(payload([task()]));
  assert.match(markup, /aria-label="Queue settings"/);
  assert.match(markup, /aria-haspopup="dialog"/);
});

test('every row offers its actions from a menu button', () => {
  const markup = render(payload([task(), task({ id: 2, title: 'Second', rank: 20 })]));
  // The queue is one list, so each task renders once.
  assert.equal((markup.match(/class="task-row"/g) ?? []).length, 2);
  assert.equal((markup.match(/aria-haspopup="menu"/g) ?? []).length, 2);
  assert.match(markup, /aria-label="Task actions"/);
  assert.match(markup, /class="task-row-shell"/);
});

test('a shift range covers the rows between the anchor and the target', () => {
  const order = [4, 7, 2, 9];
  assert.deepEqual(rangeSelection(order, 7, 9), [7, 2, 9]);
  assert.deepEqual(rangeSelection(order, 9, 7), [7, 2, 9]);
  assert.deepEqual(rangeSelection(order, 7, 7), [7]);
  // A row that is no longer in the list selects only itself.
  assert.deepEqual(rangeSelection(order, 7, 99), [99]);
});

test('remove completed only collects DONE tasks', () => {
  const tasks = [
    task(),
    task({ id: 2, status: 'DONE' }),
    task({ id: 3, status: 'BLOCKED' }),
    task({ id: 4, status: 'DONE' })
  ];
  assert.deepEqual(completedTaskIds(tasks), [2, 4]);
  assert.deepEqual(completedTaskIds([task()]), []);
});

test('completed tasks get one action that removes them together', () => {
  const markup = render(
    payload([task(), task({ id: 2, status: 'DONE' }), task({ id: 3, status: 'DONE', rank: 20 })])
  );
  assert.match(markup, /data-task-action="clear-completed"/);
  assert.match(markup, /aria-label="2 completed"/);
  // Nothing to sweep: the action stays out of the header.
  assert.doesNotMatch(render(payload([task()])), /clear-completed/);
});

test('a draft opens a detail pane even before the first task exists', () => {
  const empty = { overlay: false, hasTask: false, hasDraft: false, sheetOpen: false };
  assert.equal(detailPlacement(empty), 'none');
  // With no task to select, only the draft can produce the pane the form lives in.
  assert.equal(detailPlacement({ ...empty, hasDraft: true }), 'side');
  assert.equal(detailPlacement({ ...empty, hasDraft: true, overlay: true }), 'sheet');
});

test('a closed sheet stays closed while the selection falls back', () => {
  const phone = { overlay: true, hasTask: true, hasDraft: false, sheetOpen: false };
  assert.equal(detailPlacement(phone), 'none', 'the board stays readable on a phone');
  assert.equal(detailPlacement({ ...phone, sheetOpen: true }), 'sheet');
  assert.equal(
    detailPlacement({ ...phone, overlay: false }),
    'side',
    'the desktop column is always there'
  );
});

test('the detail renders a draft before it looks for a selected task', () => {
  const source = readFileSync(new URL('./TaskWorkspace.tsx', import.meta.url), 'utf8');
  const detail = source.slice(source.indexOf('function renderDetail()'));
  assert.ok(
    detail.indexOf('if (draft) return renderForm();') <
      detail.indexOf('if (!selected) return null;'),
    'a new-task draft has no selected task yet'
  );
});

test('the queue state and pause reason are visible', () => {
  const markup = render(
    payload([task()], { state: 'PAUSED', pausedReason: 'Verification failed (exit 1): bun test' })
  );
  assert.match(markup, /Queue paused/);
  assert.match(markup, /Verification failed/);
  assert.match(markup, /data-state="PAUSED"/);
});
