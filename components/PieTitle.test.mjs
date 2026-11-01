import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { BRAND_TEXT, PieTitle } = await jiti.import('./PieTitle.tsx');
const { getLocalePlugin } = await jiti.import('@/lib/i18n/registry.ts');

const css = await readFile(new URL('../app/sidebar.css', import.meta.url), 'utf8');

/** A rule's declarations (its first rule for the selector). */
function rule(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} not found`);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

test("the brand is the app's name in a button that opens About", async () => {
  assert.equal(BRAND_TEXT, 'Pie');

  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PieTitle))
  );
  // About is closed until a click, so no dialog is rendered.
  assert.equal(
    html,
    '<button type="button" class="sidebar-brand" aria-label="About Pie" title="About Pie"' +
      ' aria-haspopup="dialog" aria-expanded="false">' +
      '<span class="sidebar-brand-text">Pie</span>' +
      '</button>'
  );
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /style=/, "no inline styles: its look is app/sidebar.css's");
  assert.doesNotMatch(html, /role="dialog"/);
  // Every language names the button for the page it opens.
  for (const locale of ['en', 'zh-CN', 'zh-TW']) {
    const label = getLocalePlugin(locale).messages['sidebar.brandLabel'];
    assert.match(label, /Pie/, `${locale}: ${label}`);
  }
});

test('the brand sits in the chevron column and offers a visible hover and focus', () => {
  const brand = rule('.sidebar-brand');
  // Its content in the chevron column: the tree's 6px inset and a toggle's 5px.
  const [marginLeft] = brand
    .match(/margin: 0 0 0 (\d+)px;/)
    .slice(1)
    .map(Number);
  const [paddingLeft] = brand
    .match(/padding: \d+px (\d+)px;/)
    .slice(1)
    .map(Number);
  assert.equal(marginLeft + paddingLeft, 6 + 5);
  assert.match(brand, /(?:^|\s)cursor: pointer;/);

  // The wordmark: the app's name, never wrapped or cut.
  const text = rule('.sidebar-brand-text');
  assert.match(text, /(?:^|\s)display: block;/);
  assert.match(text, /(?:^|\s)white-space: nowrap;/);

  // Clickable state and keyboard focus.
  assert.match(css, /\.sidebar-brand:hover \{\s*background: var\(--bg-hover\);\s*\}/);
  assert.match(css, /\.sidebar-brand:focus-visible \{\s*outline: 2px solid var\(--accent\);/);
  // The brand is never cut, and no longer shrinks into a version string.
  assert.doesNotMatch(css, /\.sidebar-brand\.is-version/);
  assert.doesNotMatch(css, /\.sidebar-header\[data-fit='2'\] \.sidebar-brand/);
});
