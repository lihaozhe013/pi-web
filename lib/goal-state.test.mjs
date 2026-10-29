import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const {
  formatGoalStatus,
  goalActionLabelKey,
  goalCommand,
  isGoalRunning,
  readGoalFromEntries,
  readGoalStatus,
  GOAL_ENTRY_TYPE,
  GOAL_STATUS_KEY
} = await createJiti(import.meta.url).import('./goal-state.ts');

const goal = (overrides = {}) => ({
  version: 1,
  objective: 'Ship the parser fix',
  status: 'active',
  continuations: 2,
  startedAt: 1,
  baselineTokens: 100,
  ...overrides
});

const entry = (data) => ({ type: 'custom', customType: GOAL_ENTRY_TYPE, data });

test('reads the latest goal on the branch and honors a cleared entry', () => {
  assert.equal(readGoalFromEntries([]), undefined);
  assert.equal(readGoalFromEntries([{ type: 'message' }]), undefined);
  assert.equal(readGoalFromEntries([entry(goal())]).objective, 'Ship the parser fix');
  assert.equal(
    readGoalFromEntries([entry(goal()), entry(goal({ status: 'paused' }))]).status,
    'paused'
  );
  assert.equal(readGoalFromEntries([entry(goal()), entry(null)]), undefined);
  // Unreadable state is not a goal; the branch keeps whatever came before it out of view.
  assert.equal(readGoalFromEntries([entry({ version: 2, objective: 'x' })]), undefined);
  assert.equal(readGoalFromEntries([entry(goal({ objective: '  ' }))]), undefined);
});

test('goal status travels as JSON and an unreadable status is unknown', () => {
  assert.equal(formatGoalStatus(undefined), 'null');
  assert.equal(formatGoalStatus(goal()), JSON.stringify(goal()));
  assert.deepEqual(readGoalStatus([]), { known: false });
  assert.deepEqual(readGoalStatus([{ key: 'other', text: 'x' }]), { known: false });
  assert.deepEqual(readGoalStatus([{ key: GOAL_STATUS_KEY, text: 'null' }]), { known: true });
  assert.equal(
    readGoalStatus([{ key: GOAL_STATUS_KEY, text: formatGoalStatus(goal()) }]).goal.status,
    'active'
  );
  assert.deepEqual(readGoalStatus([{ key: GOAL_STATUS_KEY, text: 'Goal: active' }]), {
    known: false
  });
});

test('the dialog sends one command for the change it describes', () => {
  assert.equal(goalCommand(undefined, { objective: '', status: 'active' }), null);
  assert.equal(
    goalCommand(undefined, { objective: 'Fix tests', status: 'active' }),
    '/goal start Fix tests'
  );
  assert.equal(
    goalCommand(undefined, { objective: 'Fix tests', status: 'paused' }),
    '/goal start Fix tests'
  );

  const active = goal();
  assert.equal(goalCommand(active, { objective: active.objective, status: 'active' }), null);
  assert.equal(
    goalCommand(active, { objective: active.objective, status: 'paused' }),
    '/goal pause'
  );
  assert.equal(
    goalCommand(active, { objective: active.objective, status: 'completed' }),
    '/goal complete'
  );
  // A running goal keeps the objective it started with.
  assert.equal(goalCommand(active, { objective: 'Another', status: 'paused' }), null);
  assert.equal(goalCommand(active, { objective: '', status: 'paused' }), null);

  const paused = goal({ status: 'paused' });
  assert.equal(
    goalCommand(paused, { objective: paused.objective, status: 'active' }),
    '/goal resume'
  );
  assert.equal(
    goalCommand(paused, { objective: paused.objective, status: 'completed' }),
    '/goal complete'
  );
  assert.equal(
    goalCommand(paused, { objective: 'Another objective', status: 'paused' }),
    '/goal start Another objective'
  );

  const completed = goal({ status: 'completed' });
  assert.equal(
    goalCommand(completed, { objective: completed.objective, status: 'active' }),
    '/goal resume'
  );
  // Pausing a goal that is not running means nothing.
  assert.equal(goalCommand(completed, { objective: completed.objective, status: 'paused' }), null);

  const blocked = goal({ status: 'blocked' });
  assert.equal(
    goalCommand(blocked, { objective: blocked.objective, status: 'active' }),
    '/goal resume'
  );
});

test('the primary button names the change it applies', () => {
  assert.equal(
    goalActionLabelKey(undefined, { objective: '', status: 'active' }),
    'chat.goalStart'
  );
  const paused = goal({ status: 'paused' });
  assert.equal(
    goalActionLabelKey(paused, { objective: paused.objective, status: 'paused' }),
    'chat.goalApply'
  );
  assert.equal(
    goalActionLabelKey(paused, { objective: paused.objective, status: 'active' }),
    'chat.goalActionResume'
  );
  assert.equal(
    goalActionLabelKey(paused, { objective: 'New objective', status: 'paused' }),
    'chat.goalActionSave'
  );
  assert.equal(
    goalActionLabelKey(goal(), { objective: 'New objective', status: 'active' }),
    'chat.goalActionSave'
  );
  assert.equal(
    goalActionLabelKey(paused, { objective: paused.objective, status: 'completed' }),
    'chat.goalActionFinish'
  );
  assert.equal(
    goalActionLabelKey(goal(), { objective: goal().objective, status: 'paused' }),
    'chat.goalActionPause'
  );
});

test('only an active goal counts as running', () => {
  assert.equal(isGoalRunning(goal()), true);
  assert.equal(isGoalRunning(goal({ status: 'paused' })), false);
  assert.equal(isGoalRunning(undefined), false);
});
