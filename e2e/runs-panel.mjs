// Isolated browser coverage for the information panel's focus contract. The
// Runs panel now opens by itself when a conversation runs a command, so a panel
// the user did not ask for must never take focus from the composer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'pi-web-runs-panel-'));
const artifacts = join(root, 'test-results/e2e');
mkdirSync(artifacts, { recursive: true });
const entry = join(temporary, 'entry.tsx');
const bundle = join(temporary, 'runs-panel.js');
const source = readFileSync(join(root, 'app/globals.css'), 'utf8');
const css =
  source.slice(source.indexOf(':root,'), source.indexOf('\n}', source.indexOf('html.dark,')) + 2) +
  readFileSync(join(root, 'app/execution-history.css'), 'utf8');
let browser;

try {
  writeFileSync(
    entry,
    `
    import React, { useState } from ${JSON.stringify(join(root, 'node_modules/react/index.js'))};
    import { createRoot } from ${JSON.stringify(join(root, 'node_modules/react-dom/client.js'))};
    import { I18nProvider } from ${JSON.stringify(join(root, 'hooks/useI18n.tsx'))};
    import {
      SessionInfoSidebar,
      informationPanelOverlays
    } from ${JSON.stringify(join(root, 'components/SessionInfoSidebar.tsx'))};
    window.overlays = informationPanelOverlays;
    function Harness() {
      const [panel, setPanel] = useState(null);
      window.openAuto = () => setPanel('auto');
      window.openUser = () => setPanel('user');
      return <I18nProvider><main>
        <div className="transcript">Conversation remains visible while commands run.</div>
        <div className="composer-shell">
          <textarea id="composer" aria-label="Chat message" defaultValue="Existing draft" />
          <button type="button" id="open-user" onClick={() => setPanel('user')}>Runs</button>
        </div>
        {panel && <SessionInfoSidebar
          title="Runs"
          sidebarWidth={0}
          focusOnMount={panel !== 'auto'}
          onClose={() => setPanel(null)}
        >
          <div className="run-history" data-history-open="false">
            <section className="run-history-section run-history-active">
              <h3 className="run-history-section-title">Active</h3>
              <div className="run-history-scroll" tabIndex={0} aria-label="Active">
                <ol className="run-history-list">
                  <li className="run-history-slot">
                    <div className="run-history-entry tool-card" data-status="running">
                      <button type="button" className="run-history-entry-header" aria-expanded="true">
                        <span className="run-history-content">bun test</span>
                      </button>
                    </div>
                  </li>
                </ol>
              </div>
            </section>
          </div>
        </SessionInfoSidebar>}
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
  await page.route('http://runs-panel.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>'
    })
  );
  await page.goto('http://runs-panel.test/');
  await page.addStyleTag({
    content:
      css +
      `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: sans-serif; background: var(--bg); color: var(--text); }
    main { height: 100dvh; display: grid; grid-template-columns: 1fr 400px; grid-template-rows: 1fr auto; }
    .transcript { padding: 24px; }
    .composer-shell { grid-column: 1 / -1; padding: 8px 16px; }
    #composer { display: block; width: 100%; min-height: 80px; background: var(--bg);
      color: var(--text); border: 1px solid var(--border); border-radius: 14px; padding: 12px; }
    .session-info-sidebar { grid-row: 1; grid-column: 2; display: flex; flex-direction: column;
      min-height: 0; border-left: 1px solid var(--border); }
    .session-info-content { flex: 1; min-height: 0; display: flex; overflow: hidden; }
  `
  });
  await page.addScriptTag({ path: bundle });

  const composer = page.getByRole('textbox', { name: 'Chat message' });
  await composer.waitFor();
  await composer.focus();
  await page.evaluate(() => window.openAuto());
  const panel = page.getByRole('complementary', { name: 'Runs' });
  await panel.waitFor();
  await page.screenshot({ path: join(artifacts, 'runs-panel-auto-open.png') });
  assert.equal(
    await composer.evaluate((element) => element === document.activeElement),
    true,
    'a panel opened on the user behalf must not take focus'
  );
  assert.equal(
    await page.getByRole('dialog').count(),
    0,
    'a wide layout keeps the panel beside chat'
  );

  await composer.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(
    await composer.evaluate((element) => element === document.activeElement),
    true,
    'closing must return focus to where it was'
  );

  await page.locator('#open-user').click();
  await panel.waitFor();
  assert.equal(
    await panel.evaluate((element) => element === document.activeElement),
    true,
    'a panel the user opened takes focus'
  );
  await page.keyboard.press('Escape');
  await panel.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#open-user').evaluate((element) => element === document.activeElement),
    true,
    'closing must return focus to the trigger'
  );

  assert.deepEqual(
    await page.evaluate(() => [
      window.overlays(1280, 0),
      window.overlays(800, 0),
      window.overlays(1200, 300),
      window.overlays(1500, 700)
    ]),
    [false, true, false, true],
    'the panel overlay threshold must stay 820px of remaining width'
  );

  console.log('PASS: Runs panel focus contract and overlay threshold');
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
