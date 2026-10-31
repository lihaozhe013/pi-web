import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, {
  jsx: { runtime: 'automatic' },
  tsconfigPaths: true
});
const React = await jiti.import('react');
const { renderToStaticMarkup } = await jiti.import('react-dom/server');
const { SessionModal } = await jiti.import('./SessionModal.tsx');
const { SessionStatsModal } = await jiti.import('./SessionStatsModal.tsx');
const { I18nProvider } = await jiti.import('@/hooks/useI18n');

test('SessionModal renders dialog role, title, and children', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(
        SessionModal,
        {
          title: 'System Prompt',
          onClose: () => {}
        },
        React.createElement('div', { id: 'modal-test-content' }, 'Hello Modal')
      )
    )
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /System Prompt/);
  assert.match(html, /Hello Modal/);
});

test('SessionStatsModal renders session statistics when open', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SessionStatsModal, {
        isOpen: true,
        onClose: () => {},
        sessionStats: {
          sessionId: 'session-123',
          sessionName: 'My Coding Session',
          sessionFile: '/path/to/file.jsonl',
          totalActiveMs: 65000,
          userMessages: 4,
          assistantMessages: 4,
          toolCalls: 2,
          toolResults: 2,
          totalMessages: 12,
          cost: 0.0123,
          tokens: {
            input: 1200,
            output: 450,
            cacheRead: 300,
            cacheWrite: 100,
            total: 2050
          },
          contextUsage: {
            percent: 15.5,
            contextWindow: 128000,
            tokens: 2050
          },
          speed: {
            outputTokens: 450,
            generationMs: 5000
          },
          streamSpeed: {
            outputTokens: 450,
            streamMs: 4000,
            responses: 2
          }
        },
        selectedSession: {
          id: 'session-123',
          cwd: '/my/project',
          projectRoot: '/my/project'
        },
        contextUsage: {
          percent: 15.5,
          contextWindow: 128000,
          tokens: 2050
        },
        copiedSessionField: null,
        onCopySessionField: () => {},
        translate: (key) => key,
        locale: 'en',
        isMobile: false
      })
    )
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /session-123/);
  assert.match(html, /My Coding Session/);
  assert.match(html, /\/my\/project/);
  assert.match(html, /1,200/);
  assert.match(html, /450/);
});

test('SessionStatsModal returns null when closed', () => {
  const html = renderToStaticMarkup(
    React.createElement(
      I18nProvider,
      null,
      React.createElement(SessionStatsModal, {
        isOpen: false,
        onClose: () => {},
        sessionStats: null,
        selectedSession: null,
        contextUsage: null,
        copiedSessionField: null,
        onCopySessionField: () => {},
        translate: (key) => key,
        locale: 'en',
        isMobile: false
      })
    )
  );

  assert.equal(html, '');
});
