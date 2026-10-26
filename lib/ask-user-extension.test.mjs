import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { ASK_USER_OTHER_LABEL, ASK_USER_TOOL_NAME, createAskUserExtension } =
  await jiti.import('./ask-user-extension.ts');

function registeredTool() {
  let tool;
  const pi = { registerTool: (definition) => (tool = definition) };
  createAskUserExtension().factory(pi);
  assert.ok(tool, 'the extension registers its tool');
  return tool;
}

function uiContext(ui, { hasUI = true } = {}) {
  return { hasUI, ui };
}

function text(result) {
  return result.content.map((block) => block.text).join('\n');
}

test('the question tool is model-only and sequential', () => {
  const tool = registeredTool();
  assert.equal(tool.name, ASK_USER_TOOL_NAME);
  assert.equal(tool.exposure, 'model-only');
  assert.equal(tool.executionMode, 'sequential');
  assert.ok(tool.promptGuidelines.length > 0);
});

test('a selected option is reported as the answer', async () => {
  const tool = registeredTool();
  const calls = [];
  const result = await tool.execute(
    'call-1',
    { question: 'Which layout?', options: ['Sidebar', 'Sidebar', ' Tabs '] },
    undefined,
    undefined,
    uiContext({
      select: async (title, options) => {
        calls.push(['select', title, options]);
        return 'Tabs';
      },
      input: async () => assert.fail('a chosen option needs no text field')
    })
  );

  assert.deepEqual(calls, [['select', 'Which layout?', ['Sidebar', 'Tabs', ASK_USER_OTHER_LABEL]]]);
  assert.match(text(result), /The user selected: Tabs/);
  assert.deepEqual(result.details, {
    question: 'Which layout?',
    options: ['Sidebar', 'Tabs'],
    answer: 'Tabs',
    answerSource: 'option'
  });
});

test('choosing the free-form option asks for text and returns it', async () => {
  const tool = registeredTool();
  const calls = [];
  const result = await tool.execute(
    'call-1',
    { question: 'Which layout?', options: ['Sidebar'] },
    undefined,
    undefined,
    uiContext({
      select: async () => ASK_USER_OTHER_LABEL,
      input: async (title, placeholder) => {
        calls.push(['input', title, placeholder]);
        return '  A drawer  ';
      }
    })
  );

  assert.deepEqual(calls, [['input', 'Which layout?', '']]);
  assert.match(text(result), /The user wrote: A drawer/);
  assert.equal(result.details.answer, 'A drawer');
  assert.equal(result.details.answerSource, 'typed');
});

test('an open question uses the text field directly', async () => {
  const tool = registeredTool();
  const result = await tool.execute(
    'call-1',
    { question: 'What should it do?' },
    undefined,
    undefined,
    uiContext({
      select: async () => assert.fail('no options means no selector'),
      input: async () => 'Rename sessions'
    })
  );

  assert.match(text(result), /The user wrote: Rename sessions/);
  assert.deepEqual(result.details.options, []);
});

test('a dismissed dialog is not an answer', async () => {
  const tool = registeredTool();
  const result = await tool.execute(
    'call-1',
    { question: 'Which layout?', options: ['Sidebar'] },
    undefined,
    undefined,
    uiContext({ select: async () => undefined, input: async () => assert.fail('cancelled') })
  );

  assert.match(text(result), /dismissed the question without answering/);
  assert.equal(result.details.answer, null);

  const emptyText = await tool.execute(
    'call-2',
    { question: 'Which layout?' },
    undefined,
    undefined,
    uiContext({ select: async () => undefined, input: async () => '   ' })
  );
  assert.match(text(emptyText), /dismissed the question/);
  assert.equal(emptyText.details.answer, null);
});

test('without a UI the tool tells the model to continue', async () => {
  const tool = registeredTool();
  const result = await tool.execute(
    'call-1',
    { question: 'Which layout?', options: ['Sidebar'] },
    undefined,
    undefined,
    uiContext({ select: async () => assert.fail('no UI') }, { hasUI: false })
  );

  assert.match(text(result), /no interactive UI/);
  assert.equal(result.details.answer, null);
});

test('an empty question is refused instead of opening an empty dialog', async () => {
  const tool = registeredTool();
  const result = await tool.execute(
    'call-1',
    { question: '   ' },
    undefined,
    undefined,
    uiContext({ input: async () => assert.fail('no dialog') })
  );

  assert.match(text(result), /non-empty question/);
});
