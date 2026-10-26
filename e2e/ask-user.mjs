// Isolated browser coverage for the real question component. No server or personal sessions.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'pi-web-question-'));
const artifacts = join(root, 'test-results/e2e');
mkdirSync(artifacts, { recursive: true });
const entry = join(temporary, 'entry.tsx');
const bundle = join(temporary, 'question.js');
const source = readFileSync(join(root, 'app/globals.css'), 'utf8');
const css =
  source.slice(source.indexOf(':root,'), source.indexOf('\n}', source.indexOf('html.dark,')) + 2) +
  source.slice(
    source.indexOf('/* Questions belong'),
    source.indexOf('/* While the software keyboard')
  );
let browser;

try {
  writeFileSync(
    entry,
    `
    import React, { useState } from ${JSON.stringify(join(root, 'node_modules/react/index.js'))};
    import { createRoot } from ${JSON.stringify(join(root, 'node_modules/react-dom/client.js'))};
    import { I18nProvider } from ${JSON.stringify(join(root, 'hooks/useI18n.tsx'))};
    import { AskUserPanel } from ${JSON.stringify(join(root, 'components/AskUserPanel.tsx'))};
    window.answers = [];
    window.fail = false;
    function Harness() {
      const [request, setRequest] = useState(null);
      window.ask = (options = ['Sidebar', 'Tabs']) => setRequest({
        type: 'extension_ui_request', id: String(Math.random()), method: options.length ? 'select' : 'input',
        title: 'Which layout should we use?', question: { options }, options
      });
      return <I18nProvider><main>
        <div className="transcript">Conversation remains visible and scrollable.</div>
        {request && <AskUserPanel key={request.id} request={request} waitingCount={0}
          onReturnFocus={() => document.querySelector('#composer').focus()}
          onRespond={async (_request, response) => {
            window.answers.push(response);
            await new Promise(resolve => setTimeout(resolve, 120));
            if (window.fail) throw new Error('offline');
            setRequest(null);
          }} />}
        <div className="composer-shell"><textarea id="composer" aria-label="Chat message" defaultValue="Existing draft" /></div>
      </main></I18nProvider>;
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
  await page.route('http://question.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
    })
  );
  await page.goto('http://question.test/');
  await page.addStyleTag({
    content:
      css +
      `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: sans-serif; background: var(--bg); color: var(--text); }
    main { height: 100dvh; display: flex; flex-direction: column; }
    .transcript { flex: 1; min-height: 0; overflow: auto; padding: 24px; }
    .composer-shell { flex-shrink: 0; padding: 0 52px 8px 16px; }
    #composer { display: block; width: 100%; max-width: 820px; margin: auto; min-height: 80px;
      background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0,0,0,0); }
    @media (max-width: 640px) { .composer-shell { padding-right: 16px; } }
  `
  });
  await page.addScriptTag({ path: bundle });
  const composer = page.getByRole('textbox', { name: 'Chat message' });
  await composer.waitFor();
  await composer.focus();
  await page.evaluate(() => window.ask());
  const panel = page.locator('.ask-user-panel');
  await panel.waitFor();
  await page.screenshot({ path: join(artifacts, 'ask-user-default.png') });
  assert.equal(
    await composer.evaluate((el) => el === document.activeElement),
    true,
    'arrival must not steal focus'
  );
  await panel.getByRole('radio', { name: 'Tabs' }).check();
  assert.equal(await page.evaluate(() => window.answers.length), 0, 'selection must not submit');
  await panel.getByRole('radio', { name: 'Tabs' }).press('Tab');
  assert.equal(
    await panel.getByRole('radio', { name: 'Tabs' }).isChecked(),
    true,
    'tabbing must retain selection'
  );
  const answer = panel.getByRole('textbox');
  await answer.fill('A drawer');
  assert.equal(await panel.getByRole('radio', { name: 'Tabs' }).isChecked(), false);
  await answer.press('Escape');
  assert.equal(await panel.getByRole('textbox').count(), 0);
  assert.equal(await page.evaluate(() => window.answers.length), 0, 'collapse is not cancellation');
  await panel.getByRole('button', { name: 'Expand', exact: true }).click();
  assert.equal(await answer.inputValue(), 'A drawer');
  await answer.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, isComposing: true });
  assert.equal(await page.evaluate(() => window.answers.length), 0, 'IME input must not submit');
  await page.evaluate(() => {
    window.fail = true;
  });
  await answer.press('Control+Enter');
  await panel.getByRole('alert').waitFor();
  assert.equal(await answer.inputValue(), 'A drawer', 'failure must preserve answer');
  await page.evaluate(() => {
    window.fail = false;
  });
  await panel.getByRole('button', { name: 'Send answer', exact: true }).focus();
  await page.evaluate(() => {
    const form = document.querySelector('.ask-user-panel form');
    form.requestSubmit();
    form.requestSubmit();
  });
  assert.equal(
    await panel.getByRole('button', { name: 'Sending…', exact: true }).isDisabled(),
    true
  );
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.answers), [
    { value: 'A drawer' },
    { value: 'A drawer' }
  ]);
  assert.equal(await composer.inputValue(), 'Existing draft');
  assert.equal(await composer.evaluate((el) => el === document.activeElement), true);

  for (const width of [1280, 768, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(() =>
      window.ask(
        Array.from({ length: 6 }, (_, i) => 'Option ' + i + ': a longer explanation '.repeat(4))
      )
    );
    await panel.waitFor();
    for (const theme of ['light', 'dark']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const bounds = await panel.boundingBox();
      const inputBounds = await composer.boundingBox();
      assert.ok(
        bounds.y >= 0 && bounds.y + bounds.height <= inputBounds.y,
        'panel must sit above composer'
      );
      assert.ok(
        Math.abs(bounds.x - inputBounds.x) < 1 && Math.abs(bounds.width - inputBounds.width) < 1
      );
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false
      );
      await page.screenshot({ path: join(artifacts, 'ask-user-' + width + '-' + theme + '.png') });
    }
    await panel.getByRole('button', { name: 'Skip this question', exact: true }).click();
    await panel.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.answers.at(-1)), { cancelled: true });
  }
  await page.evaluate(() => window.ask([]));
  await panel.waitFor();
  assert.equal(await panel.getByRole('radio').count(), 0);
  await panel.getByRole('textbox').fill('Open answer');
  await panel.getByRole('textbox').press('Control+Enter');
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(await page.evaluate(() => window.answers.at(-1)), { value: 'Open answer' });
  console.log(
    'PASS: inline question choices, custom answer, collapse, retry, focus, draft, skip, open question, widths and themes'
  );
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
