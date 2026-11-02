/**
 * The prompt a task run receives.
 *
 * A task runs in a fresh process with nobody at the keyboard, so the prompt
 * carries the rules that a chat session gets from the person: where to work,
 * whether a question is available, and what the final message must report.
 * Standing instructions are not here: the child receives them through Pi's
 * `--append-system-prompt` flag, so they live in the system prompt.
 */
import { verificationShellName } from './gate';
import type { TaskRecord } from './types';

export interface TaskPromptInput {
  task: Pick<TaskRecord, 'id' | 'title' | 'description' | 'cwd' | 'attempts'>;
  verifyCommands: string[];
  allowAskUser: boolean;
}

export function buildTaskPrompt({ task, verifyCommands, allowAskUser }: TaskPromptInput): string {
  const lines: string[] = [];
  const verificationShell = verificationShellName();
  lines.push(
    `You are running task #${task.id} from Pie's serial task queue, unattended, in one fresh session.`,
    ''
  );
  lines.push(`Task: ${task.title}`);
  if (task.description) {
    lines.push('', 'Details:', task.description);
  }
  lines.push(
    '',
    'Working directory:',
    task.cwd,
    '',
    'Rules for this run:',
    '- Do all work for this task inside the working directory above. If the task needs another location, state that in your final message instead of changing directories.',
    '- Do not create branches, worktrees, pull requests, or pushes.',
    '- Verify your work where it can be verified. Do not claim something you did not check.',
    verifyCommands.length > 0
      ? `- After you finish, these verification commands run outside this session: ${verifyCommands
          .map((command) => `\`${command}\``)
          .join(
            ', '
          )}. They run in ${verificationShell}, not in this session's shell, so keep them portable: \`echo\`, \`node -e\` and the project's own scripts work there; interactive or POSIX-only tools may not.`
      : '- No verification commands are configured for this task; the result is judged from your report.',
    allowAskUser
      ? '- You may use ask_user if a decision is genuinely unclear. The person is not watching, so the queue waits for their answer.'
      : '- The ask_user tool is not available in this run. If something is unclear, make the most reasonable assumption and state it in your final message.',
    '- Finish with a short report: what changed, what you verified, and what is left.'
  );
  return lines.join('\n');
}
