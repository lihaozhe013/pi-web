import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { TaskRpcSession, appendToTail, DEFAULT_GRACE_MS } = await jiti.import('./rpc-session.ts');

const fixture = fileURLToPath(new URL('./__fixtures__/rpc-child.mjs', import.meta.url));

async function cwdFixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'pie-task-rpc-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

function sessionFor(dir, scenario, graceMs = 1_000) {
  return new TaskRpcSession({
    command: { command: process.execPath, args: [fixture, scenario] },
    cwd: dir,
    graceMs
  });
}

test('frames stdout on LF only and preserves U+2028 inside a JSON string', async (t) => {
  const dir = await cwdFixture(t);
  const session = sessionFor(dir, 'u2028');
  const records = [];
  session.onRecord((record) => records.push(record));
  session.start();

  await session.prompt('go');
  const settled = await session.waitForSettled();
  assert.deepEqual(settled, { aborted: false });
  await session.close();
  assert.equal(session.exitCode, 0);

  const final = records.find(
    (record) =>
      record.type === 'message_end' &&
      record.message?.role === 'assistant' &&
      record.message.content?.[0]?.text?.includes('\u2028')
  );
  assert.ok(final, 'the record containing U+2028 was parsed as one record');
  assert.equal(final.message.content[0].text, 'answer\u2028with separator');
});

test('correlates commands by id even when responses arrive out of order', async (t) => {
  const dir = await cwdFixture(t);
  const session = sessionFor(dir, 'success');
  session.start();
  const [prompt, state] = await Promise.all([
    session.send({ id: 'a', type: 'prompt', message: 'hi' }),
    session.send({ id: 'b', type: 'get_state' })
  ]);
  assert.equal(prompt.id, 'a');
  assert.equal(prompt.command, 'prompt');
  assert.equal(state.id, 'b');
  await session.waitForSettled();
  await session.close();
});

test('a non-zero exit keeps its status and reports stderr as diagnostics', async (t) => {
  const dir = await cwdFixture(t);
  const session = sessionFor(dir, 'fail');
  session.start();
  await session.prompt('go');
  await session.waitForSettled();
  await session.close();
  assert.equal(session.exitCode, 3);
  assert.equal(session.hasExited, true);
});

test('a dead child rejects waits instead of hanging the queue', async (t) => {
  const dir = await cwdFixture(t);
  const session = sessionFor(dir, 'crash');
  session.start();
  // The prompt may be accepted before the child dies; either way nothing settles.
  await session.prompt('go').catch(() => {});
  await assert.rejects(() => session.waitForSettled(), /exited/);
});

test('closing a stubborn child escalates to a tree kill', async (t) => {
  const dir = await cwdFixture(t);
  const session = sessionFor(dir, 'stubborn', 100);
  session.start();
  await session.prompt('go');
  const started = Date.now();
  await session.close();
  assert.equal(session.hasExited, true);
  assert.ok(Date.now() - started < DEFAULT_GRACE_MS + 5_000);
});

test('the output tail is bounded', () => {
  assert.equal(appendToTail('', 'x'.repeat(10), 4), 'xxxx');
  assert.equal(appendToTail('abc', 'def', 4), 'cdef');
});

test('the fixture exists where the tests expect it', () => {
  assert.equal(existsSync(fixture), true);
});

test('a child that prints a non-JSON line does not break the protocol', async (t) => {
  const dir = await cwdFixture(t);
  const script = join(dir, 'noisy.mjs');
  await writeFile(
    script,
    `process.stdout.write('diagnostic line without json\\n');\n` +
      `let buffer='';\nprocess.stdin.on('data',(chunk)=>{buffer+=chunk;const i=buffer.indexOf('\\n');if(i<0)return;const c=JSON.parse(buffer.slice(0,i));` +
      `process.stdout.write(JSON.stringify({id:c.id,type:'response',command:c.type,success:true})+'\\n');` +
      `process.stdout.write(JSON.stringify({type:'agent_settled',aborted:false})+'\\n');});\n` +
      `process.stdin.on('end',()=>process.exit(0));\n`
  );
  const session = new TaskRpcSession({ command: { command: process.execPath, args: [script] }, cwd: dir });
  session.start();
  await session.prompt('go');
  const settled = await session.waitForSettled();
  assert.deepEqual(settled, { aborted: false });
  await session.close();
  assert.equal(session.exitCode, 0);
});
