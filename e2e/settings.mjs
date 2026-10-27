import assert from 'node:assert/strict';

export async function selectSettingsSection(page, section, name) {
  const picker = page.locator('.settings-mobile-section-picker');
  if (await picker.isVisible()) await picker.selectOption(section);
  else
    await page.locator('.settings-section-tabs').getByRole('button', { name, exact: true }).click();
}

/** Operates only on browser preferences; never changes Pi configuration. */
export async function checkSettingsSearchAndSizes(page) {
  const search = page.getByRole('searchbox', { name: 'Search settings…' });
  await selectSettingsSection(page, 'general', 'General');
  await search.fill('等宽字号');
  await search.press('ArrowDown');
  await page.keyboard.press('Enter');
  const mono = page.getByRole('slider', { name: 'Monospace font size', exact: true });
  await mono.waitFor({ state: 'visible' });
  assert.equal(await mono.evaluate((el) => el === document.activeElement), true);
  const ui = page.getByRole('slider', { name: 'Interface font size', exact: true });
  const chat = page.getByRole('slider', { name: 'Chat text size', exact: true });
  const size = (selector) =>
    page
      .locator(selector)
      .first()
      .evaluate((el) => getComputedStyle(el).fontSize);
  const baseline = await size('.settings-dialog-title');
  await mono.fill('21');
  assert.equal(await chat.inputValue(), '16');
  assert.equal(await ui.inputValue(), '15');
  assert.equal(await size('.appearance-preview .markdown-code-block pre'), '21px');
  assert.equal(await size('.appearance-preview .markdown-inline-code'), '21px');
  assert.equal(await size('.appearance-preview-output'), '21px');
  await chat.fill('20');
  assert.equal(await size('.appearance-preview .markdown-body'), '20px');
  assert.equal(await size('.appearance-preview .markdown-code-block pre'), '21px');
  await ui.fill('18');
  assert.notEqual(await size('.settings-dialog-title'), baseline);
  assert.equal(await size('.appearance-preview .markdown-body'), '20px');
  assert.equal(await size('.appearance-preview .markdown-code-block pre'), '21px');
  const value = page.getByRole('spinbutton', { name: 'Monospace font size', exact: true });
  await value.fill('19');
  await value.press('Enter');
  assert.equal(await mono.inputValue(), '19');
  await value.fill('');
  await value.press('Tab');
  assert.equal(await value.inputValue(), '19', 'Empty input restores the current value');
  await page.getByRole('button', { name: 'Reset fonts & sizes', exact: true }).click();
  assert.equal(await ui.inputValue(), '15');
  assert.equal(await chat.inputValue(), '16');
  assert.equal(await mono.inputValue(), '12');
  await search.fill('zenburn');
  await page.getByRole('button', { name: /^Zenburn/ }).click();
  assert.equal(await page.locator('.appearance-theme-picker').evaluate((el) => el.open), true);
  assert.equal(
    await page.locator('#settings-theme-zenburn').evaluate((el) => el === document.activeElement),
    true
  );
  await page.locator('.appearance-theme-picker > summary').click();
  await search.fill('send key');
  await page.getByRole('button', { name: /^Send key/ }).click();
  assert.equal(await page.locator('#settings-send-key input:focus').count(), 1);
  await search.fill('no-such-setting');
  await page.getByRole('status').filter({ hasText: 'No matching settings' }).waitFor();
  await search.press('Escape');
  assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible(), true);
  await selectSettingsSection(page, 'appearance', 'Appearance');
  console.log(
    'PASS: settings search, keyboard location, independent sizes, live preview and resets'
  );
}
