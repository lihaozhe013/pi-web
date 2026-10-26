import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { toolCodeLanguageReady, tokenizeToolCode } = await jiti.import('@/lib/tool-code-highlight');
const { loadPrismLanguages } = await jiti.import('@/lib/prism-languages');

function text(nodes) {
  return nodes
    .map((node) => (node.type === 'text' ? node.value : text(node.children ?? [])))
    .join('');
}

test('an unknown language is not tokenized until a grammar exists for it', () => {
  assert.equal(toolCodeLanguageReady(undefined), false);
  assert.equal(toolCodeLanguageReady('no-such-language'), false);
  assert.equal(tokenizeToolCode('const a = 1', 'no-such-language'), null);
});

test('code becomes tokens that still read as the text that was given', async () => {
  await loadPrismLanguages();
  assert.equal(toolCodeLanguageReady('typescript'), true);

  const source = 'const a: number = 1; // one\n';
  const nodes = tokenizeToolCode(source, 'typescript');
  assert.ok(nodes && nodes.length > 0);
  assert.equal(text(nodes), source);

  const classes = JSON.stringify(nodes);
  assert.match(classes, /"keyword"/);
  assert.match(classes, /"comment"/);
});

test('markup in a file is tokenized, never trusted as markup', async () => {
  await loadPrismLanguages();
  const nodes = tokenizeToolCode('<script>alert(1)</script>', 'markup');
  assert.ok(nodes);
  // Only elements with class names come back; every other node is plain text.
  for (const node of nodes) {
    if (node.type === 'text') continue;
    assert.equal(node.tagName, 'span');
    assert.deepEqual(node.properties?.className?.slice(0, 1), ['token']);
  }
  assert.equal(text(nodes), '<script>alert(1)</script>');
});
