"use client";

import { createContext, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import vs from "react-syntax-highlighter/dist/esm/styles/prism/vs";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus";
import { useTheme } from "@/hooks/useTheme";
import { usePrismLanguages } from "@/hooks/usePrismLanguages";
import { prismLanguagesLoaded } from "@/lib/prism-languages";
import { takeHighlightBudget, waitForHighlight } from "@/lib/highlight-queue";
import { tokenizeForkCode, type ForkCodeNode } from "@/lib/fork-code-highlight";

/**
 * Fork: syntax colors inside a tool card.
 *
 * A card is mostly code — a write's file, a read's result, an edit's diff, a
 * shell's command and output — and upstream showed all of it as plain mono
 * text. `ForkCodeTokens` renders that text with the token colors a Markdown
 * fence already uses, without a box of its own: the card keeps its frame,
 * padding, scroll and error colors, and only the text inside gets colored.
 *
 * Usage: a provider names the syntax of everything below it
 * (`ForkCodeLanguageProvider`, fed by `lib/fork-code-language.ts`), and
 * `ForkCodeTokens` replaces the plain `{text}` where the card shows it. With no
 * provider — or an unknown language, or text too short/long/error-colored to be
 * worth it — it renders exactly the text it was given.
 */

type ForkCodeTheme = { [selector: string]: CSSProperties };

const THEMES: { light: ForkCodeTheme; dark: ForkCodeTheme } = {
  light: vs,
  dark: vscDarkPlus,
};

/** Past this, a card's text stays plain: tokenizing it would stall the page. */
export const FORK_CODE_MAX_CHARS = 200_000;

const ForkCodeLanguageContext = createContext<string | undefined>(undefined);

/** Names the syntax of the text inside, for every `ForkCodeTokens` below. */
export function ForkCodeLanguageProvider({ lang, children }: { lang: string | undefined; children: ReactNode }) {
  return <ForkCodeLanguageContext.Provider value={lang}>{children}</ForkCodeLanguageContext.Provider>;
}

function ignoreTokenClass(name: string): boolean {
  // `token` is on every span; only the classes after it carry color.
  return name === "token" || name === "";
}

function tokenStyle(theme: ForkCodeTheme, classNames: string[] | undefined): CSSProperties | undefined {
  if (!classNames?.length) return undefined;
  let style: CSSProperties | undefined;
  for (const name of classNames) {
    if (ignoreTokenClass(name)) continue;
    const rule = theme[name];
    if (rule) style = { ...style, ...rule };
  }
  return style;
}

function renderTokens(nodes: ForkCodeNode[], theme: ForkCodeTheme): ReactNode[] {
  const rendered: ReactNode[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      rendered.push(node.value);
      continue;
    }
    rendered.push(
      <span key={rendered.length} style={tokenStyle(theme, node.properties?.className)}>
        {renderTokens(node.children ?? [], theme)}
      </span>,
    );
  }
  return rendered;
}

/**
 * `text` with the syntax colors of the enclosing language, as inline nodes.
 * `budget` is false for many small pieces at once (a diff's lines): those
 * highlight on mount instead of queueing an idle slice each.
 */
export function ForkCodeTokens({ text, budget = true }: { text: string; budget?: boolean }) {
  const lang = useContext(ForkCodeLanguageContext);
  const { isDark } = useTheme();
  const wanted = Boolean(lang) && text.length > 0 && text.length <= FORK_CODE_MAX_CHARS;
  const ready = usePrismLanguages(wanted);
  // Small text takes this task's highlight budget; anything longer waits for an
  // idle slice, like a code fence does (`lib/highlight-queue.ts`).
  const [colored, setColored] = useState(
    () => wanted && (!budget || (prismLanguagesLoaded() && takeHighlightBudget(text.length))),
  );

  useEffect(() => {
    if (!wanted || colored || !ready) return;
    return waitForHighlight(() => setColored(true));
  }, [wanted, colored, ready]);

  const nodes = useMemo(
    () => (colored && lang ? tokenizeForkCode(text, lang) : null),
    [colored, lang, text],
  );
  if (!nodes) return <>{text}</>;
  return <>{renderTokens(nodes, isDark ? THEMES.dark : THEMES.light)}</>;
}
