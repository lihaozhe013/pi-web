import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { searchSettings, SETTINGS_SEARCH_ENTRIES, SETTINGS_SECTION_LABELS } =
  await jiti.import('./settings-search.ts');
const { enLocale } = await jiti.import('./i18n/messages/en.ts');
const { zhCNLocale } = await jiti.import('./i18n/messages/zh-CN.ts');
const { zhTWLocale } = await jiti.import('./i18n/messages/zh-TW.ts');
const t = (key) => enLocale.messages[key] ?? key;

test('settings search matches localized labels and multilingual aliases, regardless of UI language', () => {
  for (const query of ['mono size', '等宽字号', '等寬字級', 'Monospace font size']) {
    assert.ok(
      searchSettings(query, t).some((entry) => entry.target === 'settings-font-mono-size'),
      query
    );
  }
  assert.ok(
    searchSettings('界面字号', t).some((entry) => entry.target === 'settings-font-ui-size')
  );
  assert.ok(searchSettings('发送', t).some((entry) => entry.target === 'settings-send-key'));
  assert.ok(
    searchSettings('cache cost', t).some((entry) => entry.target === 'settings-cache-notices')
  );
  assert.deepEqual(searchSettings('   ', t), []);
  assert.deepEqual(searchSettings('no-such-setting', t), []);
});

test('the index has unique destinations, known sections and translated labels/descriptions', () => {
  const identities = SETTINGS_SEARCH_ENTRIES.map((entry) => entry.section + ':' + entry.label);
  assert.equal(new Set(identities).size, identities.length);
  for (const entry of SETTINGS_SEARCH_ENTRIES) {
    assert.ok(SETTINGS_SECTION_LABELS[entry.section]);
    for (const locale of [enLocale, zhCNLocale, zhTWLocale]) {
      assert.ok(locale.messages[entry.label], entry.label);
      if (entry.description) assert.ok(locale.messages[entry.description], entry.description);
    }
  }
  assert.equal(
    SETTINGS_SEARCH_ENTRIES.find((entry) => entry.target === 'settings-shell').availability,
    'windows'
  );
  assert.equal(
    SETTINGS_SEARCH_ENTRIES.find((entry) => entry.target === 'settings-logout').availability,
    'auth'
  );
});
