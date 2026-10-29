'use client';

import { useMemo, useState } from 'react';
import { useI18n } from '@/hooks/useI18n';
import {
  executionOutputTail,
  formatExecutionDuration,
  type ExecutionHistoryEntry,
  type ExecutionHistoryStatus
} from '@/lib/execution-history';
import { ToolCodeLanguageProvider, ToolCodeTokens } from './ToolCode';
import { CodemodeCallList } from './CodemodeToolView';

const STATUS_MARK: Record<ExecutionHistoryStatus, string> = {
  running: '▍',
  success: '✓',
  error: '×',
  cancelled: '⊘'
};

const STATUS_KEY: Record<ExecutionHistoryStatus, string> = {
  running: 'codemode.status.running',
  success: 'codemode.status.ok',
  error: 'codemode.status.error',
  cancelled: 'codemode.status.cancelled'
};

function RunOutput({ entry, sessionId }: { entry: ExecutionHistoryEntry; sessionId?: string }) {
  const { t } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const [fullOutput, setFullOutput] = useState<string | null>(null);
  const [loadingFull, setLoadingFull] = useState(false);
  const [fullError, setFullError] = useState<string | null>(null);
  const fullOutputUrl =
    sessionId && entry.fullOutputPath
      ? `/api/agent/${encodeURIComponent(sessionId)}/bash-output?path=${encodeURIComponent(entry.fullOutputPath)}`
      : null;
  const output = fullOutput ?? entry.output;
  const tail = executionOutputTail(output);

  async function loadFullOutput() {
    if (!fullOutputUrl) return;
    setLoadingFull(true);
    setFullError(null);
    try {
      const response = await fetch(fullOutputUrl);
      const data = (await response.json()) as {
        success?: boolean;
        data?: { output?: string };
        error?: string;
      };
      if (data.success) {
        setFullOutput(data.data?.output ?? '');
        setShowAll(true);
      } else setFullError(data.error ?? 'unavailable');
    } catch (error) {
      setFullError(String(error));
    } finally {
      setLoadingFull(false);
    }
  }

  if (!output && !entry.fullOutputPath) {
    return (
      <div className="run-history-waiting">
        {entry.status === 'running' ? t('runs.waiting') : t('runs.noOutput')}
      </div>
    );
  }
  return (
    <div className="run-history-output-block">
      {output && (
        <>
          <div className="run-history-label">{t('runs.output')}</div>
          <pre
            className="run-history-output"
            data-error={
              entry.status === 'error' || entry.status === 'cancelled' ? 'true' : undefined
            }
          >
            {tail && !showAll ? tail.tail : output}
          </pre>
          {tail && (
            <button
              type="button"
              className="run-history-text-button"
              onClick={() => setShowAll((value) => !value)}
            >
              {showAll ? t('runs.showLess') : t('runs.showAllLines', { count: tail.hiddenLines })}
            </button>
          )}
        </>
      )}
      {entry.truncated && (
        <div className="run-history-note">
          <span>{t('runs.truncated')}</span>
          {fullOutputUrl && fullOutput === null && (
            <button
              type="button"
              className="run-history-text-button"
              onClick={loadFullOutput}
              disabled={loadingFull}
            >
              {loadingFull ? t('runs.loadingFull') : t('runs.showFull')}
            </button>
          )}
          {fullOutputUrl && (
            <a className="run-history-text-link" href={`${fullOutputUrl}&download=1`}>
              {t('runs.downloadFull')}
            </a>
          )}
          {fullError && <span className="run-history-note-error">({fullError})</span>}
        </div>
      )}
    </div>
  );
}

function RunEntry({ entry, sessionId }: { entry: ExecutionHistoryEntry; sessionId?: string }) {
  const { t } = useI18n();
  // Running and failed runs open themselves; a finished success stays a row
  // until the user asks for its output. Once open, a run keeps its state when
  // it finishes instead of folding under the reader.
  const [expanded, setExpanded] = useState(() => entry.status !== 'success');
  const duration = formatExecutionDuration(entry.durationMs);
  const callCount = entry.calls ? entry.calls.length + (entry.omittedCalls ?? 0) : 0;

  return (
    <li className="run-history-entry" data-status={entry.status}>
      <button
        type="button"
        className="run-history-entry-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="run-history-mark" data-status={entry.status} aria-hidden="true">
          {STATUS_MARK[entry.status]}
        </span>
        <span className="run-history-content">
          <span className="run-history-title-row">
            <span className="run-history-tool">{entry.toolName}</span>
            {entry.userInitiated && <span className="run-history-tag">{t('runs.you')}</span>}
            <span className="run-history-meta">
              <span className="run-history-status" data-status={entry.status}>
                {t(STATUS_KEY[entry.status])}
              </span>
              {callCount > 0 && (
                <span>
                  {callCount === 1
                    ? t('codemode.callCountOne')
                    : t('codemode.callCount', { count: callCount })}
                </span>
              )}
              {duration && <span>{duration}</span>}
              <svg
                className="run-history-chevron"
                data-open={expanded ? 'true' : undefined}
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </span>
          </span>
          <span className="run-history-preview">{entry.preview || t('runs.noCommand')}</span>
        </span>
      </button>

      {expanded && (
        <div className="run-history-body">
          {entry.kind === 'codemode' && callCount > 0 && (
            <CodemodeCallList calls={entry.calls ?? []} omitted={entry.omittedCalls ?? 0} />
          )}
          {entry.kind === 'codemode' && entry.script && (
            <details className="run-history-script">
              <summary>{t('codemode.script')}</summary>
              <pre>
                <ToolCodeLanguageProvider lang="javascript">
                  <ToolCodeTokens text={entry.script.replace(/\r/g, '').trimEnd()} />
                </ToolCodeLanguageProvider>
              </pre>
            </details>
          )}
          {entry.command && !(entry.kind === 'codemode' && entry.script) && (
            <pre className="run-history-command">{entry.command}</pre>
          )}
          <RunOutput entry={entry} sessionId={sessionId} />
        </div>
      )}
    </li>
  );
}

/** The permanent shell and codemode history, newest first. */
export function ExecutionHistoryPanel({
  entries,
  sessionId
}: {
  entries: readonly ExecutionHistoryEntry[];
  sessionId?: string;
}) {
  const { t } = useI18n();
  const ordered = useMemo(() => [...entries].reverse(), [entries]);
  const running = entries.filter((entry) => entry.status === 'running').length;

  if (entries.length === 0) {
    return (
      <div className="run-history-empty">
        <span className="run-history-empty-mark" aria-hidden="true">
          &gt;_
        </span>
        <p className="run-history-empty-title">{t('runs.empty')}</p>
        <p className="run-history-empty-hint">{t('runs.emptyHint')}</p>
      </div>
    );
  }

  return (
    <div className="run-history">
      <div className="run-history-summary">
        <span>
          {entries.length === 1
            ? t('runs.summaryOne')
            : t('runs.summary', { count: entries.length })}
        </span>
        {running > 0 && (
          <span className="run-history-running">
            <span className="run-history-running-mark" aria-hidden="true">
              ▍
            </span>
            {running === 1 ? t('runs.runningOne') : t('runs.running', { count: running })}
          </span>
        )}
      </div>
      <ol className="run-history-list">
        {ordered.map((entry) => (
          <RunEntry key={entry.id} entry={entry} sessionId={sessionId} />
        ))}
      </ol>
    </div>
  );
}
