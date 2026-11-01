import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' },
  tsconfigPaths: true
});
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { TurnWrittenFiles } = await jiti.import('./TurnWrittenFiles.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

function render(props) {
  return renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(TurnWrittenFiles, props))
  );
}

test('counts the files a turn wrote instead of naming them', () => {
  const html = render({
    files: [{ filePath: '/abs/out/report.html' }, { filePath: '/abs/out/data.json' }]
  });
  assert.match(html, /2 files changed/);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(html, /report\.html/);
});

test('renders nothing when no files were written', () => {
  assert.equal(render({ files: [] }), '');
});
