import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createJiti } from 'jiti';

// Next inlines the build's values from next.config.ts's `env`; a Node test
// stands in for that with the environment before the module is imported.
process.env.NEXT_PUBLIC_APP_VERSION = '0.1.0';
process.env.NEXT_PUBLIC_APP_COMMIT = '1c02256b9e2f1a0c3d4e5f60718293a4b5c6d7e8';
process.env.NEXT_PUBLIC_PI_VERSION = '1.4.0';

const jiti = createJiti(import.meta.url, { jsx: { runtime: 'automatic' }, tsconfigPaths: true });
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');
const {
  ABOUT_LOGO_SIZE,
  ABOUT_LOGO_SRC,
  APP_LICENSE,
  APP_REPOSITORY_URL,
  AboutDialog,
  BUILD_COMMIT,
  BUILD_PI_VERSION,
  BUILD_VERSION,
  PI_REPOSITORY_URL
} = await jiti.import('./AboutDialog.tsx');

const css = await readFile(new URL('../app/about.css', import.meta.url), 'utf8');
const layout = await readFile(new URL('../app/layout.tsx', import.meta.url), 'utf8');

const html = renderToStaticMarkup(
  React.createElement(I18nProvider, null, React.createElement(AboutDialog, { onClose: () => {} }))
);

test('About shows the logo, the build version with its commit, and the Pi release', async () => {
  assert.equal(BUILD_VERSION, '0.1.0');
  assert.equal(BUILD_PI_VERSION, '1.4.0');
  assert.equal(BUILD_COMMIT.startsWith('1c02256'), true);

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-label="About Pie"/);
  assert.ok(html.includes(`class="about-logo"`));
  assert.ok(html.includes(`src="${ABOUT_LOGO_SRC}"`));
  assert.ok(html.includes(`width="${ABOUT_LOGO_SIZE}"`));
  assert.match(html, /<h3 class="about-name">Pie<\/h3>/);
  assert.match(html, /A minimal web GUI for the Pi coding agent\./);
  // The version, with the short commit as build metadata in parentheses.
  assert.match(html, /0\.1\.0<\/span> \(<span class="about-version-commit">1c02256<\/span>\)/);
  assert.match(html, /<dt>Pi agent<\/dt><dd>1\.4\.0<\/dd>/);
  assert.match(html, new RegExp(`<dt>License</dt><dd>${APP_LICENSE}</dd>`));
  // One centered column of text: no cards or frames of its own.
  assert.doesNotMatch(html, /about-hero/);
  // The dialog's own look is app/about.css's (the shared modal shell sizes itself).
  assert.doesNotMatch(html.slice(html.indexOf('<div class="about-dialog"')), /style=/);

  const logo = await readFile(new URL(`../public${ABOUT_LOGO_SRC}`, import.meta.url));
  assert.ok(logo.length > 0);
});

test('About links to the project and to Pi, opening in a new tab', () => {
  for (const url of [APP_REPOSITORY_URL, PI_REPOSITORY_URL]) {
    assert.ok(url.startsWith('https://github.com/'), url);
    assert.ok(
      html.includes(`href="${url}" target="_blank" rel="noreferrer noopener"`),
      `${url} opens in a new tab`
    );
  }
  assert.equal(APP_REPOSITORY_URL, 'https://github.com/lihaozhe013/pie');
  assert.equal(PI_REPOSITORY_URL, 'https://github.com/earendil-works/pi');
});

test('About is styled from the shared theme and stays usable on narrow screens', () => {
  // The dialog's own sheet is part of the app's global styles.
  assert.match(layout, /import '\.\/about\.css';/);
  // Semantic theme variables only, and the per-build commit dimmed.
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.match(css, /\.about-version-commit \{\s*color: var\(--text-dim\);\s*\}/);
  assert.match(css, /\.about-logo \{[\s\S]*?width: 64px;/);
  // A traditional about panel: no gradients, frames or shadows of its own.
  const declarations = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(declarations, /gradient|box-shadow/);
  assert.doesNotMatch(declarations, /\.about-(hero|versions?|facts)[^{]*\{[^}]*border:/);
  // Keyboard focus stays visible, motion is optional, and phones get one column.
  assert.match(css, /\.about-link:focus-visible \{\s*outline: 2px solid var\(--accent\);/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?transition: none;/);
  assert.match(css, /@media \(max-width: 420px\) \{[\s\S]*?\.about-links \{/);
});
