/**
 * CLI entry point for the same `ask_user` tool the chat session registers.
 *
 * Pi loads a TypeScript extension from a file path and expects a default-export
 * factory. The tool itself stays in `lib/ask-user-extension.ts`; this file only
 * hands its factory to the child process, so a task and a chat session cannot
 * drift into two question implementations.
 */
import { createAskUserExtension } from './ask-user-extension';

const extension = createAskUserExtension();

export default typeof extension === 'function' ? extension : extension.factory;
