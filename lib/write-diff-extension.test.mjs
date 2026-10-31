import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { buildWriteDiff, createWriteDiffExtension } = await jiti.import('./write-diff-extension.ts');
const { parseUnifiedPatch } = await jiti.import('./patch.ts');

function textOf(rows) {
  return rows
    .flatMap((row) => (row.type === 'line' ? [row.left.text, row.right.text] : []))
    .filter(Boolean)
    .join('\n');
}

test('buildWriteDiff keeps the old and new lines that changed', () => {
  const result = buildWriteDiff('src/a.ts', 'one\ntwo\n', 'one\nthree\n');
  assert.ok(result);
  const files = parseUnifiedPatch(result.patch);
  assert.ok(files);
  const text = textOf(files[0].rows);
  assert.match(text, /two/);
  assert.match(text, /three/);
  assert.equal(buildWriteDiff('a.ts', 'same\n', 'same\n'), null);
});

function handlersFor(extension) {
  const handlers = new Map();
  extension.factory({
    on(event, handler) {
      handlers.set(event, handler);
    }
  });
  return handlers;
}

test('a write result carries the patch its card renders', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-web-write-diff-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, 'a.ts'), 'one\ntwo\n');

  const handlers = handlersFor(createWriteDiffExtension());
  const call = {
    type: 'tool_call',
    toolName: 'write',
    toolCallId: 'write-1',
    input: { path: 'a.ts', content: 'one\nthree\n' }
  };
  await handlers.get('tool_call')(call, { cwd });
  const result = handlers.get('tool_result')(
    {
      type: 'tool_result',
      toolName: 'write',
      toolCallId: 'write-1',
      input: call.input,
      details: undefined,
      isError: false
    },
    { cwd }
  );

  assert.ok(result?.details?.patch);
  assert.equal(result.details.oldContent, undefined);
  assert.match(result.details.patch, /-two/);
  assert.match(result.details.patch, /\+three/);
});

test('a new file is an all-added patch and a failed write has no patch', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'pi-web-write-diff-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const handlers = handlersFor(createWriteDiffExtension());
  const input = { path: 'new.ts', content: 'first\nsecond\n' };
  await handlers.get('tool_call')(
    { type: 'tool_call', toolName: 'write', toolCallId: 'write-new', input },
    { cwd }
  );
  const created = handlers.get('tool_result')(
    {
      type: 'tool_result',
      toolName: 'write',
      toolCallId: 'write-new',
      input,
      details: undefined,
      isError: false
    },
    { cwd }
  );
  assert.match(created.details.patch, /\+first/);
  assert.match(created.details.patch, /\+second/);

  await handlers.get('tool_call')(
    { type: 'tool_call', toolName: 'write', toolCallId: 'write-failed', input },
    { cwd }
  );
  const failed = handlers.get('tool_result')(
    {
      type: 'tool_result',
      toolName: 'write',
      toolCallId: 'write-failed',
      input,
      details: undefined,
      isError: true
    },
    { cwd }
  );
  assert.equal(failed, undefined);
});
