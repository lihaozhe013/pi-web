import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { Script } from 'node:vm';
import { createJiti } from 'jiti';
import { astNodes, declarationName, nodeText, parseSource } from '../lib/source-testing.mjs';

const jiti = createJiti(import.meta.url);
const { dropMentionPaths, splitDroppedItems } = await jiti.import(
  '../lib/file-upload-client.ts'
);

const sourceText = readFileSync(new URL('./ChatWindow.tsx', import.meta.url), 'utf8');
const nodes = astNodes(parseSource(sourceText, 'ChatWindow.tsx'));

/** Runs one of ChatWindow's useCallback bodies against the given scope. */
function chatWindowCallback(name, context) {
  const declaration = nodes.find(
    (node) => node.type === 'VariableDeclarator' && declarationName(node) === name
  );
  assert.ok(declaration, `useCallback ${name} not found`);
  return new Script(
    stripTypeScriptTypes(`(${nodeText(sourceText, declaration.init.arguments[0])})`)
  ).runInNewContext(context);
}

const photo = new File(['x'], 'photo.png', { type: 'image/png' });
const report = new File(['x'], 'report.pdf', { type: 'application/pdf' });
const log = new File(['x'], 'server.log', { type: '' });

/** Picks files with the composer's attach button, through ChatWindow's real drop path. */
async function attach(files, { cwd = '/project', response } = {}) {
  const calls = { images: [], uploads: [], mentions: [], notices: [], refreshed: 0 };
  const scope = {
    session: null,
    newSessionCwd: cwd,
    chatInputRef: {
      current: {
        addImages: (images) => calls.images.push(...images),
        addFileMentions: (paths) => calls.mentions.push(...paths)
      }
    },
    addNotice: (notice) => calls.notices.push([notice.type, notice.message]),
    t: (key, vars) => (vars ? `${key} ${JSON.stringify(vars)}` : key),
    onFilesUploaded: () => {
      calls.refreshed += 1;
    },
    splitDroppedItems,
    dropMentionPaths,
    uploadFiles: async (target, uploads, strategy) => {
      calls.uploads.push([target, uploads.map((file) => file.name), strategy]);
      return response;
    }
  };
  scope.uploadDroppedFiles = chatWindowCallback('uploadDroppedFiles', scope);
  scope.onDrop = chatWindowCallback('onDrop', scope);
  chatWindowCallback('onAttachFiles', scope)(files);
  await new Promise((resolve) => setImmediate(resolve));
  return calls;
}

test('the attach button sends picked files down the chat drop path (#1101)', async () => {
  const mixed = await attach([photo, report, log], {
    response: { status: 207, data: { uploaded: ['report.pdf'], skipped: ['server.log'] } }
  });
  // Images attach to the prompt; the rest are uploaded like a drop: never replacing a file,
  // then attached as chips whose mentions the send spells out.
  assert.deepEqual(mixed.images, [photo]);
  assert.deepEqual(mixed.uploads, [['/project', ['report.pdf', 'server.log'], 'skip']]);
  assert.deepEqual(mixed.mentions, ['report.pdf', 'server.log']);
  assert.deepEqual(mixed.notices, [
    ['success', 'chat.dropUploaded {"count":1}'],
    ['warning', 'chat.dropAlreadyExists {"names":"server.log"}']
  ]);
  assert.equal(mixed.refreshed, 1);

  const imagesOnly = await attach([photo]);
  assert.deepEqual(imagesOnly.images, [photo]);
  assert.deepEqual(imagesOnly.uploads, []);
  assert.deepEqual(imagesOnly.notices, []);
});

test('without a working directory, picked files behave like a drop there (#1101)', async () => {
  const calls = await attach([photo, report], { cwd: null });
  assert.deepEqual(calls.images, [photo]);
  assert.deepEqual(calls.uploads, []);
  assert.deepEqual(calls.notices, [['warning', 'chat.dropNeedsCwd']]);
});
