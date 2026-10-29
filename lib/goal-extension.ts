import { Type } from '@earendil-works/pi-ai';
import {
  defineTool,
  type ExtensionContext,
  type InlineExtension
} from '@earendil-works/pi-coding-agent';
import { goalStopReason, type GoalLimits } from './goal-policy';

const ENTRY = 'pi-web:goal';
const LIMITS: GoalLimits = { maxContinuations: 5, maxTokens: 200_000, maxElapsedMs: 30 * 60_000 };
const START_PENDING = 'Waiting for the goal run to start.';

type Status = 'active' | 'paused' | 'completed' | 'blocked';
interface Goal {
  version: 1;
  objective: string;
  status: Status;
  continuations: number;
  startedAt: number;
  baselineTokens: number;
  reason?: string;
}

type Branch = ReturnType<ExtensionContext['sessionManager']['getBranch']>;

function readGoal(branch: Branch): Goal | undefined {
  for (const entry of [...branch].reverse()) {
    if (entry.type !== 'custom' || entry.customType !== ENTRY) continue;
    const goal = entry.data as Goal | undefined;
    if (
      !goal ||
      goal.version !== 1 ||
      typeof goal.objective !== 'string' ||
      !['active', 'paused', 'completed', 'blocked'].includes(goal.status)
    )
      return undefined;
    return goal;
  }
}

function tokenCount(branch: Branch): number {
  let total = 0;
  for (const entry of branch) {
    if (entry.type === 'message' && entry.message.role === 'assistant') {
      total += entry.message.usage?.totalTokens ?? 0;
    } else if (
      (entry.type === 'usage' || entry.type === 'compaction' || entry.type === 'branch_summary') &&
      entry.usage
    ) {
      total += entry.usage.totalTokens ?? 0;
    }
  }
  return total;
}

function reminder(goal: Goal): string {
  return `Continue working toward this user-approved goal:\n${goal.objective}\nVerify the result against the goal. Call report_goal with completed and concrete evidence only when it is achieved, or blocked and a reason if you need user input. Do not invent approvals or credentials. Follow the current tool and permission restrictions.`;
}

export function createGoalExtension(): InlineExtension {
  return {
    name: 'pi-web-goal',
    hidden: true,
    factory: (pi) => {
      const show = (ctx: ExtensionContext, goal: Goal | undefined) => {
        ctx.ui.setStatus(
          'pi-web-goal',
          goal
            ? `Goal: ${goal.status} · ${goal.continuations}/${LIMITS.maxContinuations} · ${goal.objective}`
            : undefined
        );
      };
      const save = (ctx: ExtensionContext, goal: Goal) => {
        pi.appendEntry(ENTRY, goal);
        show(ctx, goal);
      };
      const restore = (ctx: ExtensionContext) => {
        const goal = readGoal(ctx.sessionManager.getBranch());
        if (goal?.status === 'active')
          save(ctx, { ...goal, status: 'paused', reason: 'Session restored; resume explicitly.' });
        else show(ctx, goal);
      };
      pi.on('session_start', (_event, ctx) => restore(ctx));
      pi.on('session_tree', (_event, ctx) => restore(ctx));
      pi.on('session_shutdown', (_event, ctx) => {
        const goal = readGoal(ctx.sessionManager.getBranch());
        if (goal?.status === 'active')
          save(ctx, { ...goal, status: 'paused', reason: 'Session shut down.' });
      });
      pi.registerCommand('goal', {
        description:
          'Start or manage a goal: /goal start <objective>, /goal resume, /goal pause, /goal clear',
        handler: async (args, ctx) => {
          const current = readGoal(ctx.sessionManager.getBranch());
          const text = args.trim();
          if (text.startsWith('start ')) {
            const objective = text.slice(6).trim();
            if (!objective || objective.length > 4000 || current?.status === 'active') {
              ctx.ui.notify(
                'Enter a goal of up to 4000 characters; pause the active goal first.',
                'error'
              );
              return;
            }
            const goal: Goal = {
              version: 1,
              objective,
              status: 'paused',
              continuations: 0,
              startedAt: Date.now(),
              baselineTokens: tokenCount(ctx.sessionManager.getBranch()),
              reason: START_PENDING
            };
            save(ctx, goal);
            pi.sendUserMessage(reminder(goal));
          } else if (text === 'pause' && current?.status === 'active') {
            save(ctx, { ...current, status: 'paused', reason: 'Paused by user.' });
            if (!ctx.isIdle()) ctx.abort();
          } else if (text === 'clear' && current && current.status !== 'active') {
            pi.appendEntry(ENTRY, null);
            show(ctx, undefined);
            ctx.ui.notify('Goal cleared.', 'info');
          } else if (
            text === 'resume' &&
            current &&
            ['paused', 'blocked'].includes(current.status)
          ) {
            const goal: Goal = {
              ...current,
              status: 'paused',
              continuations: 0,
              startedAt: Date.now(),
              baselineTokens: tokenCount(ctx.sessionManager.getBranch()),
              reason: START_PENDING
            };
            save(ctx, goal);
            pi.sendUserMessage(reminder(goal));
          } else {
            ctx.ui.notify(
              current
                ? `Goal ${current.status}: ${current.objective}${current.reason ? ` — ${current.reason}` : ''}`
                : 'Use /goal start <objective> to begin.',
              'info'
            );
          }
        }
      });
      pi.on('before_agent_start', (event, ctx) => {
        const goal = readGoal(ctx.sessionManager.getBranch());
        if (goal?.status !== 'paused' || goal.reason !== START_PENDING) return;
        if (event.messageType !== 'user' || event.prompt !== reminder(goal)) return;
        save(ctx, { ...goal, status: 'active', reason: undefined });
      });
      pi.registerTool(
        defineTool({
          name: 'report_goal',
          label: 'Report goal',
          exposure: 'model-only',
          executionMode: 'sequential',
          description:
            'Report that the current goal is completed with evidence, or blocked with a concrete reason. Do not claim completion without verification.',
          parameters: Type.Object({
            status: Type.Union([Type.Literal('completed'), Type.Literal('blocked')]),
            evidence: Type.String({ minLength: 1, maxLength: 4000 })
          }),
          async execute(_id, params, _signal, _update, ctx) {
            const current = readGoal(ctx.sessionManager.getBranch());
            const evidence = params.evidence.trim();
            if (!current || current.status !== 'active' || !evidence)
              return {
                content: [{ type: 'text', text: 'No active goal or evidence is empty.' }],
                details: undefined
              };
            save(ctx, { ...current, status: params.status, reason: evidence });
            return {
              content: [{ type: 'text', text: `Goal ${params.status}: ${evidence}` }],
              details: undefined
            };
          }
        })
      );
      pi.on('agent_end', (event, ctx) => {
        const goal = readGoal(ctx.sessionManager.getBranch());
        if (goal?.status !== 'active') return;
        const last = [...event.messages].reverse().find((message) => message.role === 'assistant');
        if (last?.role === 'assistant' && last.stopReason === 'aborted') {
          save(ctx, { ...goal, status: 'paused', reason: 'Stopped by user.' });
        }
      });
      pi.on('agent_settled', (event, ctx) => {
        if (!event.aborted) return;
        const goal = readGoal(ctx.sessionManager.getBranch());
        if (goal?.status === 'active')
          save(ctx, { ...goal, status: 'paused', reason: 'Stopped by user.' });
      });
      pi.on('agent_before_settle', (event, ctx) => {
        const branch = ctx.sessionManager.getBranch();
        const goal = readGoal(branch);
        if (!goal || goal.status !== 'active') return;
        if (event.continue || ctx.hasPendingMessages()) return;
        const reason = goalStopReason(
          LIMITS,
          {
            continuations: goal.continuations,
            tokens: Math.max(0, tokenCount(branch) - goal.baselineTokens),
            elapsedMs: Math.max(0, Date.now() - goal.startedAt)
          },
          event.outcome
        );
        if (reason) {
          const paused: Goal = { ...goal, status: 'paused', reason };
          show(ctx, paused);
          return { entries: [{ type: 'custom', customType: ENTRY, data: paused }] };
        }
        const next: Goal = { ...goal, continuations: goal.continuations + 1 };
        show(ctx, next);
        return {
          entries: [
            { type: 'custom', customType: ENTRY, data: next },
            { type: 'custom_message', customType: ENTRY, content: reminder(next), display: false }
          ],
          continue: true
        };
      });
    }
  };
}
