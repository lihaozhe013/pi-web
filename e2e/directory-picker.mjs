// Isolated coverage: real directory dialog, mocked filesystem, no personal sessions or server.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'pi-web-directory-'));
const artifacts = join(root, 'test-results/e2e');
mkdirSync(artifacts, { recursive: true });
let browser;
try {
  const entry = join(temporary, 'entry.tsx');
  const bundle = join(temporary, 'directory.js');
  writeFileSync(
    entry,
    `
    import React, { useState } from ${JSON.stringify(join(root, 'node_modules/react/index.js'))};
    import { createRoot } from ${JSON.stringify(join(root, 'node_modules/react-dom/client.js'))};
    import { I18nProvider } from ${JSON.stringify(join(root, 'hooks/useI18n.tsx'))};
    import { DirectoryPicker } from ${JSON.stringify(join(root, 'components/DirectoryPicker.tsx'))};
    window.picks = [];
    window.backCount = 0;
    function Harness() {
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      return <I18nProvider><button id="opener" onClick={() => setOpen(true)}>Choose project</button>
        <textarea aria-label="Draft" defaultValue="Keep my draft" />
        {open && <DirectoryPicker initialPath="/projects" busy={busy} error={error}
          onCancel={() => setOpen(false)}
          onSelect={path => { window.picks.push(path); setOpen(false); }}
          onBack={() => { window.backCount++; setOpen(false); }} />}
      </I18nProvider>;
    }
    createRoot(document.querySelector('#root')).render(<Harness />);
  `
  );
  const build = spawnSync(
    'bun',
    [
      'build',
      entry,
      '--target=browser',
      '--outfile',
      bundle,
      '--tsconfig-override',
      join(root, 'tsconfig.json'),
      '--jsx-import-source',
      join(root, 'node_modules/react')
    ],
    { cwd: root, encoding: 'utf8' }
  );
  assert.equal(build.status, 0, build.stdout + build.stderr);
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ locale: 'en-US' });
  let failCreate = false;
  let browseCount = 0;
  await page.route('http://directory.test/**', async (route) => {
    const url = new URL(route.request().url());
    const reply = (body, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body><div id="root"></div></body></html>'
      });
    if (route.request().method() === 'POST') {
      const { path, name } = route.request().postDataJSON();
      return failCreate
        ? reply({ error: 'Folder already exists' }, 409)
        : reply({ path: path + '/' + name });
    }
    browseCount++;
    const path = url.searchParams.get('path') || '/';
    if (path === '/missing') return reply({ error: 'Directory does not exist' }, 404);
    if (path === '/slow') await new Promise((resolve) => setTimeout(resolve, 250));
    if (path === '/projects')
      return reply({
        path,
        parentPath: '/',
        directories: [
          { name: 'alpha', path: '/projects/alpha' },
          { name: 'beta', path: '/projects/beta' },
          ...Array.from({ length: 30 }, (_, i) => ({
            name: `project-${i}`,
            path: `/projects/project-${i}`
          }))
        ]
      });
    return reply({ path, parentPath: '/', directories: [] });
  });
  await page.goto('http://directory.test/');
  const source = readFileSync(join(root, 'app/globals.css'), 'utf8');
  const theme = source.slice(
    source.indexOf(':root,'),
    source.indexOf('\n}', source.indexOf('html.dark,')) + 2
  );
  await page.addStyleTag({
    content:
      theme +
      readFileSync(join(root, 'app/directory-picker.css'), 'utf8') +
      `
    * { box-sizing: border-box; } body { margin: 0; font-family: sans-serif; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
  `
  });
  await page.addScriptTag({ path: bundle });
  const opener = page.getByRole('button', { name: 'Choose project' });
  const dialog = page.getByRole('dialog');
  const open = async () => {
    await opener.click();
    await dialog.getByRole('button', { name: 'alpha', exact: true }).waitFor();
  };
  const commit = dialog.getByRole('button', { name: 'Open this folder', exact: true });
  await open();
  assert.equal(await dialog.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await commit.evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(
    await dialog
      .getByRole('button', { name: 'Back', exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    'Tab wraps to the first control, Back'
  );
  const filter = dialog.getByRole('searchbox', { name: 'Filter folders…' });
  const beforeFilter = browseCount;
  await filter.fill('BETA');
  assert.equal(await dialog.locator('.directory-picker-entry').count(), 1);
  assert.equal(browseCount, beforeFilter, 'filter is local');
  await filter.fill('no-match');
  await dialog.getByText('No matching folders', { exact: true }).waitFor();
  await filter.fill('');
  await dialog.getByRole('button', { name: 'alpha', exact: true }).click();
  await dialog.getByText('No subdirectories', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.picks), [], 'navigation must not select');
  await commit.click();
  await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.picks), ['/projects/alpha']);
  assert.equal(await opener.evaluate((el) => el === document.activeElement), true);

  await open();
  const path = dialog.getByRole('textbox', { name: 'Directory path', exact: true });
  await path.fill('/missing');
  assert.equal(await commit.isDisabled(), true);
  await path.press('Enter');
  await dialog.getByRole('alert').waitFor();
  assert.equal(await commit.isDisabled(), true);
  await dialog.getByRole('button', { name: 'Retry', exact: true }).click();
  await dialog.getByRole('alert').waitFor();
  await path.fill('/slow');
  await path.press('Enter');
  assert.equal(
    await commit.isDisabled(),
    true,
    'cannot commit previous location during navigation'
  );
  await dialog.getByText('No subdirectories', { exact: true }).waitFor();
  assert.equal(await path.inputValue(), '/slow');

  await dialog.getByRole('button', { name: 'New directory', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Directory name', exact: true }).fill('nested');
  failCreate = true;
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await dialog.getByText('Folder already exists').waitFor();
  assert.equal(
    await dialog.getByRole('textbox', { name: 'Directory name', exact: true }).inputValue(),
    'nested'
  );
  failCreate = false;
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('#directory-path').value === '/slow/nested'
  );
  assert.equal(
    (await page.evaluate(() => window.picks)).length,
    1,
    'creation browses, not commits'
  );
  await dialog.getByRole('button', { name: 'New directory', exact: true }).click();
  await page.keyboard.press('Escape');
  assert.equal(await dialog.count(), 1, 'first Escape only dismisses inline creation');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });

  await open();
  await dialog.getByRole('button', { name: 'Back', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.backCount), 1, 'back returns to the choices');
  assert.deepEqual(await page.evaluate(() => window.picks), ['/projects/alpha']);
  assert.equal(
    await page.getByRole('textbox', { name: 'Draft', exact: true }).inputValue(),
    'Keep my draft'
  );

  for (const color of ['light', 'dark']) {
    await page.evaluate((theme) => (document.documentElement.className = theme), color);
    for (const [width, height] of [
      [1280, 900],
      [768, 700],
      [375, 812],
      [812, 375]
    ]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await open();
      const bounds = await dialog.boundingBox();
      assert.ok(
        bounds.x >= 0 &&
          bounds.y >= 0 &&
          bounds.x + bounds.width <= width &&
          bounds.y + bounds.height <= height
      );
      const firstEntry = await dialog
        .getByRole('button', { name: 'alpha', exact: true })
        .boundingBox();
      const listBounds = await dialog.locator('.directory-picker-list').boundingBox();
      assert.ok(
        firstEntry.y >= listBounds.y &&
          firstEntry.y + firstEntry.height <= listBounds.y + listBounds.height,
        'at least one folder remains visible, including landscape'
      );
      const button = await commit.boundingBox();
      assert.ok(button.y + button.height <= height, 'commit remains visible');
      await page.screenshot({ path: join(artifacts, `directory-picker-${color}-${width}.png`) });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' });
    }
  }
  console.log(
    'Directory picker: navigation, back, failures, creation, focus, drafts and responsive themes passed.'
  );
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
