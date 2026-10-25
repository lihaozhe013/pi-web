"use client";

// fork: consume existing client state without changing tool events or their shapes.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ForkToolState } from "@/lib/fork-tool-expansion";

const EMPTY_IDS = new Set<string>();
const Activity = createContext({ running: EMPTY_IDS, partial: EMPTY_IDS });

export function ForkToolActivityProvider({ phase, partialResults, children }: {
  phase: { kind: string; tools?: { id: string }[] } | null;
  partialResults: ReadonlyMap<string, unknown>;
  children: ReactNode;
}) {
  const value = useMemo(() => ({
    running: new Set(phase?.kind === "running_tools" ? phase.tools?.map(tool => tool.id) : []),
    partial: new Set(partialResults.keys()),
  }), [phase, partialResults]);
  return <Activity.Provider value={value}>{children}</Activity.Provider>;
}

export function useForkToolState(id: string, hasResult: boolean, isError: boolean): ForkToolState {
  const { running, partial } = useContext(Activity);
  if (running.has(id) || partial.has(id)) return "running";
  if (hasResult) return isError ? "error" : "success";
  return "pending";
}

/** Stable text plus a CSS-only terminal cursor: no timers or per-frame React work. */
export function ForkToolStatus({ state }: { state: ForkToolState }) {
  const { t } = useI18n();
  if (state === "pending") return null;
  const label = t(state === "running" ? "codemode.status.running" : state === "error" ? "codemode.status.error" : "codemode.status.ok");
  return <span className="fork-tool-status" data-state={state}>
    <span className="fork-tool-status-mark" aria-hidden="true">{state === "running" ? "▍" : state === "error" ? "×" : "✓"}</span>
    <span>{label}</span>
  </span>;
}
