import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { THEME_OPTIONS, isDarkTheme } from './theme.ts';

const css = readFileSync(new URL('../app/catppuccin.css', import.meta.url), 'utf8');
const flavours = ['latte', 'frappe', 'macchiato', 'mocha'];
const tokens = [
  'bg',
  'bg-panel',
  'bg-hover',
  'bg-selected',
  'border',
  'text',
  'text-muted',
  'text-dim',
  'accent',
  'accent-hover',
  'accent-contrast',
  'user-bg',
  'assistant-bg',
  'tool-bg',
  'bg-subtle'
];

function luminance(hex) {
  const rgb = hex.match(/[a-f\d]{2}/gi).map((v) => {
    const s = parseInt(v, 16) / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('all four Catppuccin flavours are registered, translated and fully styled', () => {
  const locales = ['en', 'zh-CN', 'zh-TW'].map((locale) =>
    readFileSync(new URL(`./i18n/messages/${locale}.ts`, import.meta.url), 'utf8')
  );
  for (const flavour of flavours) {
    const id = `catppuccin-${flavour}`;
    const option = THEME_OPTIONS.find((option) => option.id === id);
    assert.ok(option, id);
    assert.equal(isDarkTheme(id), flavour !== 'latte');
    for (const locale of locales)
      assert.ok(
        locale.includes(`'${option.label}'`) || locale.includes(`"${option.label}"`),
        option.label
      );
    assert.match(css, new RegExp(`html\\[data-theme=['"]${id}['"]\\]`), 'must override html.dark');
    const block = css.match(new RegExp(`\\[data-theme=['"]${id}['"]\\] \\{([^}]+)\\}`))[1];
    assert.ok(block.includes(`color-scheme: ${option.scheme}`));
    const values = Object.fromEntries(
      [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value])
    );
    for (const token of tokens) assert.ok(values[token], `${id}: ${token}`);
    for (const surface of ['bg', 'bg-panel', 'assistant-bg', 'tool-bg', 'user-bg']) {
      for (const text of ['text', 'text-muted', 'text-dim', 'accent']) {
        assert.ok(contrast(values[text], values[surface]) >= 4.5, `${id}: ${text} on ${surface}`);
      }
    }
    assert.ok(contrast(values.accent, values['accent-contrast']) >= 4.5, `${id}: accent button`);
    assert.ok(
      contrast(values['accent-hover'], values['accent-contrast']) >= 4.5,
      `${id}: hovered accent button`
    );
  }
  assert.match(
    readFileSync(new URL('../app/layout.tsx', import.meta.url), 'utf8'),
    /import ['"]\.\/catppuccin\.css['"]/
  );
});
