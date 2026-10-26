"use client";

import { Children, createContext, isValidElement, useContext, useId, useLayoutEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/hooks/useI18n";
import type { ActivityCounts } from "@/lib/quiet-activity";

const GroupedActivity = createContext(false);
export const useGroupedActivity = () => useContext(GroupedActivity);

interface ItemProps {
  children: ReactNode;
  counts?: ActivityCounts;
  reveal?: boolean;
}

/** Metadata stays outside messages so history entry and deferred block indices remain intact. */
export function ActivityItem({ children }: ItemProps) {
  return <>{children}</>;
}

function ActivityGroup({ children, counts, reveal }: ItemProps & { counts: ActivityCounts }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(Boolean(reveal));
  const id = useId();
  useLayoutEffect(() => {
    if (reveal) setExpanded(true);
  }, [reveal]);
  const open = expanded;
  const label = [
    counts.reads > 0 ? t("activity.reads", { count: counts.reads }) : null,
    counts.thoughts > 0 ? t("activity.thoughts", { count: counts.thoughts }) : null,
  ].filter(Boolean).join(", ");
  return <section className="activity-group" data-expanded={open || undefined}>
    <button type="button" className="activity-group-toggle" aria-expanded={Boolean(open)} aria-controls={id} onClick={() => setExpanded(!open)}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="m4.5 2.5 3.5 3.5-3.5 3.5" /></svg>
      <span>{label}</span>
    </button>
    {/* Keep entry anchors mounted for history restoration and conversation navigation. */}
    <div id={id} className="activity-group-body" hidden={!open}>
      <GroupedActivity.Provider value={true}>{children}</GroupedActivity.Provider>
    </div>
  </section>;
}

/** Fold adjacent reading/thinking, stopping at every reply, mutation or command. */
export function ActivitySequence({ children }: { children: ReactNode }) {
  const nested = useGroupedActivity();
  if (nested) return <>{children}</>;
  const items = Children.toArray(children);
  const output: ReactNode[] = [];
  for (let index = 0; index < items.length;) {
    const first = items[index];
    if (!isValidElement<ItemProps>(first) || first.type !== ActivityItem || !first.props.counts) {
      output.push(first);
      index += 1;
      continue;
    }
    const counts = { reads: 0, thoughts: 0 };
    let reveal = false;
    let end = index;
    while (end < items.length) {
      const item = items[end];
      if (!isValidElement<ItemProps>(item) || item.type !== ActivityItem || !item.props.counts) break;
      counts.reads += item.props.counts.reads;
      counts.thoughts += item.props.counts.thoughts;
      reveal ||= Boolean(item.props.reveal);
      end += 1;
    }
    output.push(counts.reads + counts.thoughts > 1
      ? <ActivityGroup key={first.key} counts={counts} reveal={reveal}>{items.slice(index, end)}</ActivityGroup>
      : first);
    index = end;
  }
  return <>{output}</>;
}
