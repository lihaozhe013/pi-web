import test from 'node:test';
import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const {
  GOAL_ENTRY_TYPES,
  GOAL_STATUS_KEY,
  MAX_GOAL_OBJECTIVE_CHARS,
  formatGoalBridge,
  goalCommand,
  goalPhase,
  goalToggleAction,
  isGoalEntry,
  isGoalSurfaceKey,
  lastUserObjective,
  parseGoalBridge,
  readGoalFacts
} = await createJiti(import.meta.url).import('./goal-driver.ts');

const setGoal = (status, objective = 'Add CSV export', customType = 'pi-better-goal') => ({
  type: 'custom',
  customType,
  data: { version: 1, kind: 'set', source: 'command', goal: { status, objective }, at: 1 }
});
const clearGoal = (customType = 'pi-better-goal') => ({
  type: 'custom',
  customType,
  data: { version: 1, kind: 'clear', source: 'command', clearedGoalId: 'goal_1', at: 2 }
});
const userMessage = (content) => ({ type: 'message', message: { role: 'user', content } });

test('uses the status key and entry types the packages write', () => {
  assert.equal(GOAL_STATUS_KEY, 'pi-web-goal');
  assert.deepEqual([...GOAL_ENTRY_TYPES], ['pi-better-goal', 'pi-codex-goal']);
  assert.equal(isGoalEntry({ type: 'custom', customType: 'pi-better-goal' }), true);
  assert.equal(isGoalEntry({ type: 'custom', customType: 'pi-codex-goal' }), true);
  assert.equal(isGoalEntry({ type: 'custom', customType: 'pi-web-goal' }), false);
  assert.equal(isGoalEntry({ type: 'message' }), false);
});

test('reads the latest goal and lets a clear retract it', () => {
  assert.equal(readGoalFacts([]), undefined);
  const goal = readGoalFacts([setGoal('active')]);
  assert.deepEqual(goal, { status: 'active', objective: 'Add CSV export' });

  // The newest record wins, in either direction.
  assert.equal(readGoalFacts([setGoal('active'), clearGoal()])?.status, undefined);
  assert.equal(readGoalFacts([setGoal('active'), clearGoal()]), undefined);
  assert.deepEqual(readGoalFacts([clearGoal(), setGoal('paused')]), {
    status: 'paused',
    objective: 'Add CSV export'
  });
});

test('ignores the package records that say nothing about the goal', () => {
  const continuation = {
    type: 'custom',
    customType: 'pi-better-goal',
    data: { version: 1, kind: 'continuation-state', state: {}, at: 3 }
  };
  const permission = {
    type: 'custom',
    customType: 'pi-better-goal',
    data: { version: 1, kind: 'permission', goalId: 'goal_1' }
  };
  const other = {
    type: 'custom',
    customType: 'pi-web-stream-speed',
    data: { tokensPerSecond: 12 }
  };
  assert.deepEqual(
    readGoalFacts([setGoal('complete'), continuation, permission, other])?.status,
    'complete'
  );
  // A continuation record alone never invents a goal.
  assert.equal(readGoalFacts([continuation]), undefined);
});

test('reads a goal written by the package the bridge replaced', () => {
  const counted = {
    type: 'custom',
    customType: 'pi-better-goal',
    data: {
      version: 1,
      kind: 'set',
      goal: {
        status: 'paused',
        objective: 'Add CSV export',
        tokenBudget: 2000,
        usage: { tokensUsed: 500, activeSeconds: 12 }
      }
    }
  };
  assert.deepEqual(readGoalFacts([counted]), {
    status: 'paused',
    objective: 'Add CSV export',
    tokensUsed: 500,
    tokenBudget: 2000
  });
  // A package that reports nothing leaves the numbers out instead of showing
  // zeros, and the budget the package writes as null stays null: no budget.
  assert.deepEqual(readGoalFacts([setGoal('active')]), {
    status: 'active',
    objective: 'Add CSV export'
  });
  const unbudgeted = {
    type: 'custom',
    customType: 'pi-better-goal',
    data: {
      kind: 'set',
      goal: { status: 'active', objective: 'Add CSV export', tokenBudget: null }
    }
  };
  assert.deepEqual(readGoalFacts([unbudgeted]), {
    status: 'active',
    objective: 'Add CSV export',
    tokenBudget: null
  });

  assert.deepEqual(readGoalFacts([setGoal('active', 'Ship it', 'pi-codex-goal')]), {
    status: 'active',
    objective: 'Ship it'
  });
  // A clear from either package still retracts the goal it followed.
  assert.equal(readGoalFacts([setGoal('active'), clearGoal('pi-codex-goal')]), undefined);
});

test('an unreadable record is absent instead of guessed', () => {
  const cases = [
    { type: 'custom', customType: 'pi-better-goal' },
    { type: 'custom', customType: 'pi-better-goal', data: null },
    { type: 'custom', customType: 'pi-better-goal', data: { kind: 'set' } },
    { type: 'custom', customType: 'pi-better-goal', data: { kind: 'set', goal: { status: '' } } },
    { type: 'custom', customType: 'pi-better-goal', data: { kind: 'set', goal: { status: 7 } } }
  ];
  for (const entry of cases) assert.equal(readGoalFacts([entry]), undefined, JSON.stringify(entry));
});

test('maps the package status onto the dialog three phases', () => {
  assert.equal(goalPhase(undefined), undefined);
  assert.equal(goalPhase({ status: 'active', objective: '' }), 'running');
  assert.equal(goalPhase({ status: 'paused', objective: '' }), 'waiting');
  assert.equal(goalPhase({ status: 'budgetLimited', objective: '' }), 'waiting');
  assert.equal(goalPhase({ status: 'complete', objective: '' }), 'done');
  // A status word a later package adds still leaves a usable entry.
  assert.equal(goalPhase({ status: 'cancelled', objective: '' }), 'waiting');
});

test('one click per phase, and the command each phase sends', () => {
  assert.equal(goalToggleAction(undefined), 'start');
  assert.equal(goalToggleAction({ status: 'active', objective: '' }), 'pause');
  assert.equal(goalToggleAction({ status: 'paused', objective: '' }), 'resume');
  assert.equal(goalToggleAction({ status: 'budgetLimited', objective: '' }), 'resume');
  assert.equal(goalToggleAction({ status: 'complete', objective: '' }), 'clear');

  assert.equal(goalCommand('start', 'Add CSV export'), '/goal Add CSV export');
  assert.equal(goalCommand('pause'), '/goal pause');
  assert.equal(goalCommand('resume'), '/goal resume');
  assert.equal(goalCommand('complete'), '/goal complete');
  assert.equal(goalCommand('clear'), '/goal clear');
});

test('the start objective is the last message the person wrote', () => {
  assert.equal(lastUserObjective([]), undefined);
  assert.equal(
    lastUserObjective([
      userMessage('first'),
      { type: 'message', message: { role: 'assistant', content: 'ok' } }
    ]),
    'first'
  );
  assert.equal(
    lastUserObjective([
      userMessage('older'),
      userMessage('Add CSV export'),
      { type: 'message', message: { role: 'assistant', content: 'working' } }
    ]),
    'Add CSV export'
  );
  // Content blocks are joined, and a slash command is not an objective.
  assert.equal(
    lastUserObjective([
      userMessage([
        { type: 'text', text: 'Add CSV' },
        { type: 'text', text: 'export' }
      ])
    ]),
    'Add CSV\nexport'
  );
  assert.equal(lastUserObjective([userMessage('older'), userMessage('/compact')]), 'older');
  assert.equal(lastUserObjective([userMessage('   ')]), undefined);
  assert.equal(lastUserObjective([userMessage('/goal pause')]), undefined);
  assert.equal(lastUserObjective([{ type: 'message', message: { role: 'user' } }]), undefined);

  const long = 'x'.repeat(MAX_GOAL_OBJECTIVE_CHARS + 50);
  assert.equal(lastUserObjective([userMessage(long)])?.length, MAX_GOAL_OBJECTIVE_CHARS);
});

test('junk on the branch is skipped, not thrown on', () => {
  assert.equal(readGoalFacts([null, undefined, 7, 'x', [], setGoal('active')])?.status, 'active');
  assert.equal(
    lastUserObjective([null, { type: 'message' }, userMessage('Add CSV export')]),
    'Add CSV export'
  );
  assert.equal(isGoalEntry(null), false);
  assert.equal(isGoalEntry({ type: 'custom', customType: 'pi-better-goal' }), true);
});

test('the bridge owns the surfaces the package would also show', () => {
  for (const key of [GOAL_STATUS_KEY, 'pi-better-goal', 'codex-goal'])
    assert.equal(isGoalSurfaceKey(key), true, key);
  for (const key of ['pi-goal', 'mcp', '']) assert.equal(isGoalSurfaceKey(key), false, key);
});

test('the published status round-trips and survives junk', () => {
  assert.equal(formatGoalBridge({ available: false }), '{"available":false}');
  assert.deepEqual(parseGoalBridge(formatGoalBridge({ available: false })), { available: false });
  assert.deepEqual(
    parseGoalBridge(
      formatGoalBridge({ available: true, goal: { status: 'paused', objective: 'Ship' } })
    ),
    { available: true, goal: { status: 'paused', objective: 'Ship' } }
  );

  assert.equal(parseGoalBridge(undefined), undefined);
  assert.equal(parseGoalBridge(''), undefined);
  assert.equal(parseGoalBridge('null'), undefined);
  assert.equal(parseGoalBridge('[]'), undefined);
  assert.deepEqual(parseGoalBridge('{"available":true,"goal":{"status":""}}'), { available: true });
  assert.deepEqual(parseGoalBridge('{"available":"yes"}'), { available: false });
});
