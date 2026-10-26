import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { prefersReducedMotion } from '@/lib/motion';

/**
 * How long a card that left the transcript keeps fading out
 * (`app/tool-cards.css`, `.tool-card-exit`).
 */
export const TOOL_CARD_EXIT_MS = 240;

/**
 * How long a card's body takes to open or close (`app/tool-cards.css`,
 * `.tool-card-body`). The body's content is kept this long after it closes,
 * so it is still there while it folds away.
 */
export const TOOL_CARD_BODY_MS = 200;

/** One item of a card list: what to render, and whether it is on its way out. */
export interface HeldItem<T> {
  item: T;
  exiting: boolean;
}

/**
 * The list to render: the items the transcript has now, in order, plus the ones
 * that just left it — marked `exiting` so they fade out where they stood instead
 * of vanishing in one frame.
 *
 * `previous` is the list rendered last time. An item still there keeps its place;
 * an item only in `previous` is held (once); an item only in `items` goes last,
 * which is where a transcript appends it anyway.
 */
export function holdExitingItems<T>(
  items: readonly T[],
  previous: readonly T[],
  key: (item: T) => string
): HeldItem<T>[] {
  const present = new Map(items.map((item) => [key(item), item]));
  const held: HeldItem<T>[] = [];
  const seen = new Set<string>();
  for (const item of previous) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    const current = present.get(id);
    held.push(current === undefined ? { item, exiting: true } : { item: current, exiting: false });
  }
  for (const item of items) {
    const id = key(item);
    if (seen.has(id)) continue;
    seen.add(id);
    held.push({ item, exiting: false });
  }
  return held;
}

/**
 * A card list that fades the cards which leave it.
 *
 * A card disappears when its call folds out of the transcript (a successful
 * shell), and a list built from the message alone would cut it away mid-paint.
 * The items handed back keep the leaving cards for `TOOL_CARD_EXIT_MS` after
 * their last render; the card list then drops them. Only the shift itself is
 * animated — a list restored from history is rendered exactly as it is, and
 * under `prefers-reduced-motion` nothing is held at all.
 */
export function useExitingItems<T>(items: readonly T[], key: (item: T) => string): HeldItem<T>[] {
  const previous = useRef<readonly T[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [, bump] = useReducer((count: number) => count + 1, 0);

  // A card that comes back cancels its own exit instead of arriving twice.
  const present = new Set(items.map(key));
  for (const [id, timer] of timers.current) {
    if (!present.has(id)) continue;
    clearTimeout(timer);
    timers.current.delete(id);
  }

  const held = holdExitingItems(items, prefersReducedMotion() ? [] : previous.current, key);

  // Each card that started leaving gets one timer; when it ends, the card is gone.
  for (const entry of held) {
    if (!entry.exiting) continue;
    const id = key(entry.item);
    if (timers.current.has(id)) continue;
    timers.current.set(
      id,
      setTimeout(() => {
        timers.current.delete(id);
        previous.current = previous.current.filter((item) => key(item) !== id);
        bump();
      }, TOOL_CARD_EXIT_MS)
    );
  }

  previous.current = held.map((entry) => entry.item);
  const clearTimers = useCallback(() => {
    for (const timer of timers.current.values()) clearTimeout(timer);
    timers.current.clear();
  }, []);
  useEffect(() => clearTimers, [clearTimers]);
  return held;
}

/**
 * Something that shows, then goes: `open` keeps it rendered while it is here and
 * for `TOOL_CARD_EXIT_MS` after it left, `exiting` says it is fading out now.
 * Used where a single element leaves on its own (the composer's activity row, a
 * command the user ran themselves) — a list uses `useExitingItems` instead.
 */
export function useExitHold(active: boolean): { open: boolean; exiting: boolean } {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (active) {
      setHeld(true);
      return;
    }
    if (prefersReducedMotion()) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(false), TOOL_CARD_EXIT_MS);
    return () => clearTimeout(timer);
  }, [active]);
  return { open: active || held, exiting: !active && held };
}

/**
 * A card body's content: mounted as the body opens, and kept for
 * `TOOL_CARD_BODY_MS` after it closes so the fold is not a cut. Collapsed cards
 * render nothing, so a long transcript does not build every diff at once.
 */
export function useBodyContent(open: boolean): boolean {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    const timer = setTimeout(() => setMounted(false), TOOL_CARD_BODY_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return open || mounted;
}
