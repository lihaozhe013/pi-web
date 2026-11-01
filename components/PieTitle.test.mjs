import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const { BRAND_ICON_SIZE, BRAND_ICON_SRC, PieTitle } = await jiti.import('./PieTitle.tsx');
const { getLocalePlugin } = await jiti.import('@/lib/i18n/registry.ts');

const css = await readFile(new URL('../app/sidebar.css', import.meta.url), 'utf8');

/** A rule's declarations (its first rule for the selector). */
function rule(selector) {
  const start = css.indexOf(`\n${selector} {`);
  assert.notEqual(start, -1, `${selector} not found`);
  return css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
}

test("the brand is the app's icon in a button that opens About", async () => {
  assert.equal(BRAND_ICON_SRC, '/icons/icon-192.png');
  assert.equal(BRAND_ICON_SIZE, 20);

  const html = renderToStaticMarkup(
    React.createElement(I18nProvider, null, React.createElement(PieTitle))
  );
  // React 19 hoists a preload for the img into the head; the button itself
  // follows. About is closed until a click, so no dialog is rendered.
  assert.equal(
    html,
    `<link rel="preload" as="image" href="${BRAND_ICON_SRC}"/>` +
      '<button type="button" class="sidebar-brand" aria-label="About Pie" title="About Pie"' +
      ' aria-haspopup="dialog" aria-expanded="false">' +
      `<img class="sidebar-brand-icon" src="${BRAND_ICON_SRC}" alt="" width="${BRAND_ICON_SIZE}" height="${BRAND_ICON_SIZE}"/>` +
      '</button>'
  );
  assert.doesNotMatch(html, /style=/, "no inline styles: its look is app/sidebar.css's");
  assert.doesNotMatch(html, /role="dialog"/);
  // The icon is the app's, and decorative: the button's name carries the meaning.
  const icon = await readFile(new URL(`../public${BRAND_ICON_SRC}`, import.meta.url));
  assert.ok(icon.length > 0);
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

  // The mark: the app icon, block in its square box (20px, the size the brand
  // renders it at).
  const icon = rule('.sidebar-brand-icon');
  assert.match(icon, /(?:^|\s)display: block;/);
  assert.match(icon, new RegExp(`width: ${BRAND_ICON_SIZE}px;`));
  assert.match(icon, new RegExp(`height: ${BRAND_ICON_SIZE}px;`));

  // Clickable state and keyboard focus.
  assert.match(css, /\.sidebar-brand:hover \{\s*background: var\(--bg-hover\);\s*\}/);
  assert.match(css, /\.sidebar-brand:focus-visible \{\s*outline: 2px solid var\(--accent\);/);
  // The old version-scramble styling is gone: the mark never becomes text.
  assert.doesNotMatch(css, /\.sidebar-brand\.is-version/);
  assert.doesNotMatch(css, /\.sidebar-header\[data-fit='2'\] \.sidebar-brand/);
});
