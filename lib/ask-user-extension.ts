import { Type } from '@earendil-works/pi-ai';
import { defineTool, type InlineExtension } from '@earendil-works/pi-coding-agent';

/**
 * A model-callable question. The answer arrives through the same extension UI dialogs every
 * other extension uses, so the browser shows it with the rest of Pi's requests and the reply
 * travels back as the tool result.
 *
 * This is a discussion aid, not an approval gate: it can ask, but it never authorizes a write.
 */

export const ASK_USER_TOOL_NAME = 'ask_user';
export const ASK_USER_EXTENSION_NAME = 'pi-web-ask-user';

/** Appended to the offered options; selecting it opens the text field instead of answering. */
export const ASK_USER_OTHER_LABEL = 'Write my own answer…';

const MAX_OPTIONS = 6;

export interface AskUserDetails {
  question: string;
  options: string[];
  answer: string | null;
  answerSource: 'option' | 'typed' | null;
}

function details(
  question: string,
  options: string[],
  answer: string | null,
  answerSource: AskUserDetails['answerSource']
): AskUserDetails {
  return { question, options, answer, answerSource };
}

function textResult(text: string, value: AskUserDetails) {
  return { content: [{ type: 'text' as const, text }], details: value };
}

function answered(
  question: string,
  options: string[],
  answer: string,
  answerSource: 'option' | 'typed'
) {
  const prefix = answerSource === 'typed' ? 'The user wrote' : 'The user selected';
  return textResult(`${prefix}: ${answer}`, details(question, options, answer, answerSource));
}

/**
 * A dismissed dialog is not an answer. The tool result says so explicitly, because a model
 * that treats a cancel as agreement would act on a decision the user never made.
 */
function cancelled(question: string, options: string[]) {
  return textResult(
    'The user dismissed the question without answering. Do not ask it again: continue with a stated assumption, or wait for the user to say how to proceed.',
    details(question, options, null, null)
  );
}

function normalizeOptions(options: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const option of options ?? []) {
    const label = option.trim();
    if (!label || seen.has(label) || result.length >= MAX_OPTIONS) continue;
    seen.add(label);
    result.push(label);
  }
  return result;
}

export function createAskUserExtension(): InlineExtension {
  return {
    name: ASK_USER_EXTENSION_NAME,
    hidden: true,
    factory: (pi) => {
      pi.registerTool(
        defineTool({
          name: ASK_USER_TOOL_NAME,
          label: 'Ask user',
          description:
            'Ask the user a question and wait for the answer. Use it when their intent, priorities, constraints, or a trade-off is unclear and guessing would change the result.',
          promptSnippet: 'Ask the user a focused question',
          // A script must not answer for the user, and an approval-shaped tool call would make
          // the dialog look like a confirmation.
          exposure: 'model-only',
          // One dialog at a time: parallel questions would race for the same overlay.
          executionMode: 'sequential',
          promptGuidelines: [
            'Ask one focused question at a time. Offer 2–3 concrete options when the choice is enumerable, and let the user write their own answer.',
            'Prefer reading the workspace over asking what it contains; ask about intent, priorities, and choices the repository cannot answer.',
            'If the user dismisses the question, do not ask it again: continue with a stated assumption, or wait for their direction.'
          ],
          parameters: Type.Object({
            question: Type.String({
              description: 'The question to show the user, in their language.'
            }),
            options: Type.Optional(
              Type.Array(Type.String(), {
                description: `Selectable answers, in the user's language. Omit for an open question. At most ${MAX_OPTIONS}.`,
                maxItems: MAX_OPTIONS
              })
            )
          }),
          async execute(_toolCallId, params, signal, _onUpdate, ctx) {
            const question = params.question.trim();
            const options = normalizeOptions(params.options);
            if (!question) {
              return textResult(
                'ask_user needs a non-empty question.',
                details('', options, null, null)
              );
            }
            if (!ctx.hasUI) {
              return textResult(
                'This session has no interactive UI, so the question cannot be shown. Continue without asking.',
                details(question, options, null, null)
              );
            }

            if (options.length === 0) {
              const typed = await ctx.ui.input(question, '', { signal });
              const answer = typed?.trim();
              return answer
                ? answered(question, options, answer, 'typed')
                : cancelled(question, options);
            }

            const choice = await ctx.ui.select(question, [...options, ASK_USER_OTHER_LABEL], {
              signal
            });
            if (choice === undefined) return cancelled(question, options);
            if (choice !== ASK_USER_OTHER_LABEL)
              return answered(question, options, choice, 'option');

            const typed = await ctx.ui.input(question, '', { signal });
            const answer = typed?.trim();
            return answer
              ? answered(question, options, answer, 'typed')
              : cancelled(question, options);
          }
        })
      );
    }
  };
}
