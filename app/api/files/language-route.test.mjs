import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server.js';
import { createJiti } from 'jiti';
import { refractor } from 'refractor/all';
import { astNodes, declarationName, nodeText, parseSource } from '../../../lib/source-testing.mjs';

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pi-web-files-language-')));
process.env.PI_CODING_AGENT_DIR = path.join(root, 'agent');
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  interopDefault: true,
  moduleCache: false
});
const { GET } = await jiti.import('./[...path]/route.ts');
const { allowFileRoot } = await jiti.import('../../../lib/allowed-roots.ts');
allowFileRoot(root);

// A route exports only its handlers, so the extensions it maps come from its source.
const source = fs.readFileSync(new URL('./[...path]/route.ts', import.meta.url), 'utf8');
const extensionMap = astNodes(parseSource(source, 'route.ts')).find(
  (node) => node.type === 'VariableDeclarator' && declarationName(node) === 'EXT_TO_LANGUAGE'
)?.init;
assert.ok(extensionMap?.type === 'ObjectExpression', 'EXT_TO_LANGUAGE not found');
// PDF and Word files are streamed by ?type=read, never shown as source.
const textExtensions = extensionMap.properties
  .map((property) => nodeText(source, property.key))
  .filter((ext) => ext !== 'pdf' && ext !== 'docx');
assert.ok(
  textExtensions.includes('ts') && textExtensions.every(Boolean),
  'EXT_TO_LANGUAGE keys not read'
);

async function languageOf(name) {
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, 'x\n');
  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  const response = await GET(new NextRequest('http://localhost/api/files/x?type=read'), {
    params: Promise.resolve({ path: segments })
  });
  assert.equal(response.status, 200, name);
  return (await response.json()).language;
}

test('every language a source file gets is a Prism grammar, or text', async () => {
  // PrismLight renders an unknown name as plain text, so a typo shows no error.
  const names = [
    ...textExtensions.map((ext) => `sample.${ext}`),
    'Dockerfile',
    'Makefile',
    '.env.local'
  ];
  for (const name of names) {
    const language = await languageOf(name);
    if (language !== 'text')
      assert.equal(refractor.registered(language), true, `${name}: ${language}`);
  }
});

test('only HTML and Markdown files take a language that opens their Preview', async () => {
  const preview = [];
  for (const ext of textExtensions) {
    if (['html', 'markdown'].includes(await languageOf(`sample.${ext}`))) preview.push(ext);
  }
  assert.deepEqual(preview.sort(), ['htm', 'html', 'md', 'mdx']);
  for (const ext of ['vue', 'svelte', 'astro'])
    assert.equal(await languageOf(`App.${ext}`), 'markup');
});

test('JSX gets its tags colored and an ambiguous extension stays plain', async () => {
  for (const name of ['App.tsx', 'App.jsx']) {
    const tree = refractor.highlight('const a = <a href="x">t</a>;', await languageOf(name));
    const classes = JSON.stringify(tree);
    assert.match(classes, /"tag"/, name);
    assert.match(classes, /"attr-name"/, name);
  }
  assert.equal(await languageOf('analysis.R'), 'r');
  assert.equal(await languageOf('plot.m'), 'text');
});
