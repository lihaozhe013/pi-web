// Isolated browser coverage of the conversation-only UI; no app server or personal data.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'pi-web-conversation-browser-'));
const artifacts = join(root, 'test-results/e2e');
mkdirSync(artifacts, { recursive: true });
let browser;
try {
  const entry = join(temporary, 'entry.tsx');
  const bundle = join(temporary, 'conversation.js');
  writeFileSync(
    entry,
    `
    import React, { useState } from ${JSON.stringify(join(root, 'node_modules/react/index.js'))};
    import { createRoot } from ${JSON.stringify(join(root, 'node_modules/react-dom/client.js'))};
    import { I18nProvider } from ${JSON.stringify(join(root, 'hooks/useI18n.tsx'))};
    import { SettingsPanel } from ${JSON.stringify(join(root, 'components/SettingsPanel.tsx'))};
    import { NewSessionChooser } from ${JSON.stringify(join(root, 'components/NewSessionChooser.tsx'))};
    import { NewSessionContextBar } from ${JSON.stringify(join(root, 'components/NewSessionContextBar.tsx'))};
    import { SessionTree } from ${JSON.stringify(join(root, 'components/SessionTree.tsx'))};
    import { buildSessionTree } from ${JSON.stringify(join(root, 'lib/session-tree.ts'))};
    function Harness() {
      const [settings, setSettings] = useState(false);
      const [chooser, setChooser] = useState(false);
      const [selected, setSelected] = useState('fork');
      const noop = () => {};
      const sessions = ['parent', 'fork'].map(id => ({id, path:'/fixture/'+id+'.jsonl',
        cwd:'/fixture', projectRoot:'/fixture', projectKey:'/fixture',
        name:id === 'parent' ? 'Parent conversation' : 'Fork conversation',
        created:'2026-01-01', modified:'2026-01-01', firstMessage:id, messageCount:2,
        ...(id === 'fork' ? {relation:{kind:'fork',originSessionId:'parent'}} : {})}));
      const model = buildSessionTree({sessions, uiState:{version:1, revision:0, sessions:{},projects:{}},
        runningIds:new Set(), unreadIds:new Set(), selectedSessionId:selected,
        currentProject:{key:'/fixture',root:'/fixture'},groupExpansion:{},moreShown:{},pinnedCollapsed:false});
      return <I18nProvider>
        <button onClick={() => setSettings(true)}>Settings</button>
        <button onClick={() => setChooser(true)}>New</button>
        <textarea aria-label="Conversation draft" defaultValue="Keep my draft" />
        <div style={{height:220}}><SessionTree rows={model.rows} layout="desktop" emptyLabel={null}
          loading={false} error={null} renamingRootId={null} renamingProjectKey={null}
          confirmDeleteRootId={null} activeMenuRowKey={null}
          onSelectConversation={conversation => setSelected(conversation.id)}
          onToggleGroup={noop} onShowMore={noop} onShowLess={noop} onTogglePinned={noop}
          onArchiveConversation={noop} onRestoreConversation={noop} onOpenRowMenu={noop}
          onRowContextMenu={noop} onRenameCommit={noop} onRenameCancel={noop}
          onRenameProjectCommit={noop} onRenameProjectCancel={noop} onDeleteConfirm={noop}
          onDeleteCancel={noop} onGroupNew={noop} onGroupMenu={noop} onOpenArchive={noop}/></div>
        <NewSessionContextBar context={{cwd:'/fixture', project:{key:'/fixture',root:'/fixture'},
          projects:[{key:'/fixture',root:'/fixture'}]}} mobile={false} initialFocus={null}
          onInitialFocusDone={noop} onPick={noop} onStartWithoutProject={noop} onOpenFolder={noop}/>
        {settings && <SettingsPanel cwd="/fixture" sessionId={null} initialSection="general"
          onClose={() => setSettings(false)} onSessionReloaded={noop}
          quoteSelectionEnabled={false} onQuoteSelectionChange={noop}/>} 
        {chooser && <NewSessionChooser onClose={() => setChooser(false)}
          onAddProject={noop} onStartWithoutProject={noop}/>}
      </I18nProvider>;
    }
    createRoot(document.querySelector('#root')).render(<Harness/>);
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
  for (const width of [1280, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('http://conversation.test/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path === '/')
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html><body><div id="root"></div></body></html>'
        });
      const body =
        path === '/api/global-agents'
          ? { content: 'Fixture instructions', exists: true, path: '~/.pi/agent/AGENTS.md' }
          : {};
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.goto('http://conversation.test/');
    const globalCss = readFileSync(join(root, 'app/globals.css'), 'utf8');
    const themeStart = globalCss.indexOf(':root,');
    const themeEnd = globalCss.indexOf('\n}', globalCss.indexOf('html.dark,')) + 2;
    await page.addStyleTag({
      content:
        globalCss.slice(themeStart, themeEnd) +
        [
          'settings.css',
          'appearance.css',
          'sidebar.css',
          'sidebar-menu.css',
          'directory-picker.css'
        ]
          .map((file) => readFileSync(join(root, 'app', file), 'utf8'))
          .join('\n') +
        '* {box-sizing:border-box} body {margin:0;background:var(--bg);color:var(--text);font-family:sans-serif}'
    });
    await page.addScriptTag({ path: bundle });
    const parent = page.getByRole('link', { name: /Parent conversation/ });
    const fork = page.getByRole('link', { name: /Fork conversation/ });
    assert.equal(await fork.getAttribute('aria-current'), 'true');
    await parent.click();
    assert.equal(await parent.getAttribute('aria-current'), 'true');
    assert.equal(await fork.getAttribute('aria-current'), null);
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    await settings.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.getByRole('button', { name: 'Agents', exact: true }).count(), 0);
    assert.equal(await dialog.getByRole('option', { name: 'Agents', exact: true }).count(), 0);
    const picker = dialog.getByRole('combobox');
    if (await picker.count()) {
      assert.equal(await picker.locator('option[value="agents"]').count(), 0);
      await picker.selectOption('instructions');
    } else {
      await dialog.getByRole('button', { name: 'Global AGENTS.md', exact: true }).click();
    }
    const instructions = dialog.getByRole('textbox', { name: 'Global AGENTS.md content' });
    await instructions.waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('textarea[aria-label="Global AGENTS.md content"]')?.value ===
        'Fixture instructions'
    );
    await page.screenshot({ path: join(artifacts, `conversation-scope-${width}.png`) });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await settings.evaluate((button) => document.activeElement === button), true);
    const newButton = page.getByRole('button', { name: 'New', exact: true });
    await newButton.click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.getByRole('button', { name: /worktree|subagent/i }).count(), 0);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(await newButton.evaluate((button) => document.activeElement === button), true);
    assert.equal(
      await page.getByRole('textbox', { name: 'Conversation draft' }).inputValue(),
      'Keep my draft'
    );
    assert.equal(
      requests.some((path) => /subagents|worktrees/.test(path)),
      false
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS ${width}px: individual sessions, settings scope, New, Escape, focus and draft preservation`
    );
    await context.close();
  }
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true });
}
