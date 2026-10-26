import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const {
  PLAN_MODE_EXTENSION_NAME,
  PLAN_MODE_GUIDELINES,
  createPlanModeExtension,
  isPlanModeBlockedTool,
  planModeBlockReason
} = await jiti.import('./plan-mode-extension.ts');
const { WORK_MODE_TYPE } = await jiti.import('./work-mode.ts');

const PLAN_ENTRIES = [
  { type: 'custom', customType: WORK_MODE_TYPE, data: { version: 1, mode: 'plan' } }
];
const READ_ONLY_ENTRIES = [
  { type: 'custom', customType: WORK_MODE_TYPE, data: { version: 1, mode: null } }
];

function loadExtension() {
  const handlers = new Map();
  const pi = {
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    registerTool() {}
  };
  const extension = createPlanModeExtension();
  assert.equal(extension.name, PLAN_MODE_EXTENSION_NAME);
  extension.factory(pi);
  return handlers;
}

function context(entries) {
  return { sessionManager: { getEntries: () => entries } };
}

function promptEvent() {
  return {
    type: 'before_agent_start',
    messageType: 'user',
    prompt: 'plan this',
    systemPrompt: '',
    systemPromptOptions: {
      selectedTools: [],
      hiddenTools: [],
      toolSnippets: {},
      toolGuidelines: {},
      promptGuidelines: ['existing guideline'],
      appendSystemPrompt: '',
      sections: {},
      contextFiles: [],
      skills: [],
      cwd: '/repo'
    }
  };
}

test('writes are blocked in plan mode, reads and questions are not', () => {
  for (const name of [
    'bash',
    'powershell',
    'edit',
    'write',
    'apply_patch',
    'Agent',
    'steer_subagent'
  ]) {
    assert.equal(isPlanModeBlockedTool(name), true, name);
  }
  for (const name of ['read', 'grep', 'find', 'ls', 'ask_user', 'codemode', 'mcp__docs__search']) {
    assert.equal(isPlanModeBlockedTool(name), false, name);
  }
  assert.match(planModeBlockReason('write'), /Plan mode is read-only/);
});

test('the tool guard only acts while plan mode is on', () => {
  const handlers = loadExtension();
  const toolCall = handlers.get('tool_call');
  assert.ok(toolCall);

  assert.deepEqual(toolCall({ toolName: 'read', input: {} }, context(PLAN_ENTRIES)), undefined);
  const blocked = toolCall({ toolName: 'write', input: {} }, context(PLAN_ENTRIES));
  assert.equal(blocked.block, true);
  assert.match(blocked.reason, /"write" is blocked/);

  assert.equal(toolCall({ toolName: 'write', input: {} }, context(READ_ONLY_ENTRIES)), undefined);
  assert.equal(toolCall({ toolName: 'write', input: {} }, context([])), undefined);
});

test('plan guidelines are added to the prompt for every run while the mode is on', () => {
  const handlers = loadExtension();
  const beforeAgentStart = handlers.get('before_agent_start');
  assert.ok(beforeAgentStart);

  const event = promptEvent();
  beforeAgentStart(event, context(PLAN_ENTRIES));
  assert.deepEqual(event.systemPromptOptions.promptGuidelines, [
    'existing guideline',
    ...PLAN_MODE_GUIDELINES
  ]);

  const outside = promptEvent();
  beforeAgentStart(outside, context([]));
  assert.deepEqual(outside.systemPromptOptions.promptGuidelines, ['existing guideline']);
});
