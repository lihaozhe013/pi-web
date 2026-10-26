'use client';

// Derive display activity from the existing client execution state.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useI18n } from '@/hooks/useI18n';
import type { ToolState } from '@/lib/tool-card-expansion';

const EMPTY_IDS = new Set<string>();
const Activity = createContext({ running: EMPTY_IDS, partial: EMPTY_IDS });

export function ToolActivityProvider({
  phase,
  partialResults,
  children
}: {
  phase: { kind: string; tools?: { id: string }[] } | null;
  partialResults: ReadonlyMap<string, unknown>;
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      running: new Set(phase?.kind === 'running_tools' ? phase.tools?.map((tool) => tool.id) : []),
      partial: new Set(partialResults.keys())
    }),
    [phase, partialResults]
  );
  return <Activity.Provider value={value}>{children}</Activity.Provider>;
}

/** Shared activity sets let the message wrapper distinguish partial from final output. */
export function useToolActivity() {
  return useContext(Activity);
}

export function useToolState(id: string, hasResult: boolean, isError: boolean): ToolState {
  const { running, partial } = useContext(Activity);
  if (running.has(id) || partial.has(id)) return 'running';
  if (hasResult) return isError ? 'error' : 'success';
  return 'pending';
}

/** Stable text plus a CSS-only terminal cursor: no timers or per-frame React work. */
export function ToolStatus({ state }: { state: ToolState }) {
  const { t } = useI18n();
  if (state === 'pending') return null;
  const label = t(
    state === 'running'
      ? 'codemode.status.running'
      : state === 'error'
        ? 'codemode.status.error'
        : 'codemode.status.ok'
  );
  return (
    <span className="tool-status" data-state={state}>
      <span className="tool-status-mark" aria-hidden="true">
        {state === 'running' ? '▍' : state === 'error' ? '×' : '✓'}
      </span>
      <span>{label}</span>
    </span>
  );
}
