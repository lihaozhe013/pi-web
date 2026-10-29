import { Type } from '@earendil-works/pi-ai';
import {
  defineTool,
  type ExtensionContext,
  type InlineExtension
} from '@earendil-works/pi-coding-agent';
import { GOAL_LIMITS, goalStopReason, normalizeGoalLimits, type GoalLimits } from './goal-policy';
import {
  effectiveGoalLimits,
  formatGoalStatus,
  GOAL_ENTRY_TYPE,
  GOAL_STATUS_KEY,
  parseGoalCommand,
  readGoalFromEntries,
  type GoalSnapshot
} from './goal-state';

const START_PENDING = 'Waiting for the goal run to start.';

type Branch = ReturnType<ExtensionContext['sessionManager']['getBranch']>;

function readGoal(branch: Branch): GoalSnapshot | undefined {
  return readGoalFromEntries(
    branch as unknown as { type: string; customType?: string; data?: unknown }[]
  );
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

function reminder(goal: GoalSnapshot): string {
  return `Continue working toward this user-approved goal:\n${goal.objective}\nVerify the result against the goal. Call report_goal with completed and concrete evidence only when it is achieved, or blocked and a reason if you need user input. Do not invent approvals or credentials. Follow the current tool and permission restrictions.`;
}

/** Flags override the base depth field by field; the parser already checked each value. */
function resolveLimits(base: GoalLimits, overrides: Partial<GoalLimits> | undefined): GoalLimits {
  return normalizeGoalLimits({ ...base, ...overrides }) ?? base;
}

export interface GoalExtensionOptions {
  /**
   * The depth a new goal starts with, read when it starts so a change in
   * Settings applies without recreating the session. Defaults to the built-ins.
   */
  readDefaultLimits?: () => GoalLimits;
}

export function createGoalExtension(options: GoalExtensionOptions = {}): InlineExtension {
  return {
    name: 'pi-web-goal',
    hidden: true,
    factory: (pi) => {
      const defaults = () => {
        try {
          return normalizeGoalLimits(options.readDefaultLimits?.()) ?? GOAL_LIMITS;
        } catch {
          return GOAL_LIMITS;
        }
      };
      // The composer's Goal control reads this structured status; it is not shown as a
      // sentence in the composer, and no other host loads this extension.
      const show = (ctx: ExtensionContext, goal: GoalSnapshot | undefined) => {
        ctx.ui.setStatus(GOAL_STATUS_KEY, formatGoalStatus(goal));
      };
      const save = (ctx: ExtensionContext, goal: GoalSnapshot) => {
        pi.appendEntry(GOAL_ENTRY_TYPE, goal);
        show(ctx, goal);
      };
      const startRun = (goal: GoalSnapshot) => {
        pi.sendMessage(
          { customType: GOAL_ENTRY_TYPE, content: reminder(goal), display: false },
          { triggerTurn: true }
        );
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
          'Start or manage a goal: /goal start [--turns N --tokens N --minutes N] <objective>, /goal resume, /goal pause, /goal complete, /goal limits, /goal clear',
        handler: async (args, ctx) => {
          const current = readGoal(ctx.sessionManager.getBranch());
          const command = parseGoalCommand(args);
          if (command.error === 'invalid-limits') {
            ctx.ui.notify(
              'Goal depth is out of range: 1-50 turns, 10000-5000000 tokens, 1-480 minutes.',
              'error'
            );
            return;
          }
          if (command.error === 'missing-objective') {
            ctx.ui.notify(
              'Enter a goal of up to 4000 characters; pause the active goal first.',
              'error'
            );
            return;
          }
          switch (command.action) {
            case 'start': {
              if (current?.status === 'active' || command.objective.length > 4000) {
                ctx.ui.notify(
                  'Enter a goal of up to 4000 characters; pause the active goal first.',
                  'error'
                );
                return;
              }
              const goal: GoalSnapshot = {
                version: 1,
                objective: command.objective,
                status: 'paused',
                continuations: 0,
                startedAt: Date.now(),
                baselineTokens: tokenCount(ctx.sessionManager.getBranch()),
                limits: resolveLimits(defaults(), command.limits),
                reason: START_PENDING
              };
              save(ctx, goal);
              startRun(goal);
              return;
            }
            case 'resume': {
              if (!current || current.status === 'active') {
                ctx.ui.notify(
                  current ? 'The goal is already running.' : 'Use /goal start <objective>.',
                  'info'
                );
                return;
              }
              const goal: GoalSnapshot = {
                ...current,
                status: 'paused',
                continuations: 0,
                startedAt: Date.now(),
                baselineTokens: tokenCount(ctx.sessionManager.getBranch()),
                limits: resolveLimits(effectiveGoalLimits(current, defaults()), command.limits),
                reason: START_PENDING
              };
              save(ctx, goal);
              startRun(goal);
              return;
            }
            case 'limits': {
              if (!current) {
                ctx.ui.notify('Use /goal start <objective> to begin.', 'info');
                return;
              }
              if (current.status === 'active') {
                ctx.ui.notify('Pause the goal before changing its depth.', 'error');
                return;
              }
              if (!command.limits) {
                ctx.ui.notify(
                  'Name the depth: /goal limits --turns 8 --tokens 500000 --minutes 45.',
                  'error'
                );
                return;
              }
              const goal: GoalSnapshot = {
                ...current,
                limits: resolveLimits(effectiveGoalLimits(current, defaults()), command.limits)
              };
              save(ctx, goal);
              return;
            }
            case 'pause': {
              if (current?.status !== 'active') return;
              save(ctx, { ...current, status: 'paused', reason: 'Paused by user.' });
              if (!ctx.isIdle()) ctx.abort();
              return;
            }
            case 'complete': {
              if (!current || current.status === 'completed') return;
              save(ctx, {
                ...current,
                status: 'completed',
                reason: 'Marked complete by the user.'
              });
              return;
            }
            case 'clear': {
              if (!current || current.status === 'active') return;
              pi.appendEntry(GOAL_ENTRY_TYPE, null);
              show(ctx, undefined);
              ctx.ui.notify('Goal cleared.', 'info');
              return;
            }
            default: {
              if (!current) {
                ctx.ui.notify('Use /goal start <objective> to begin.', 'info');
                return;
              }
              const limits = effectiveGoalLimits(current, defaults());
              ctx.ui.notify(
                `Goal ${current.status}: ${current.objective} (${limits.maxContinuations} turns, ${limits.maxTokens} tokens, ${limits.maxElapsedMs / 60_000} minutes)${current.reason ? ` — ${current.reason}` : ''}`,
                'info'
              );
            }
          }
        }
      });
      // The goal's own message starts the run, so it never appears as something the
      // person typed. Reaching this hook is what confirms the run actually began.
      pi.on('before_agent_start', (event, ctx) => {
        const goal = readGoal(ctx.sessionManager.getBranch());
        if (goal?.status !== 'paused' || goal.reason !== START_PENDING) return;
        if (event.messageType !== 'custom' || event.message.customType !== GOAL_ENTRY_TYPE) return;
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
          effectiveGoalLimits(goal, GOAL_LIMITS),
          {
            continuations: goal.continuations,
            tokens: Math.max(0, tokenCount(branch) - goal.baselineTokens),
            elapsedMs: Math.max(0, Date.now() - goal.startedAt)
          },
          event.outcome
        );
        if (reason) {
          const paused: GoalSnapshot = { ...goal, status: 'paused', reason };
          show(ctx, paused);
          return { entries: [{ type: 'custom', customType: GOAL_ENTRY_TYPE, data: paused }] };
        }
        const next: GoalSnapshot = { ...goal, continuations: goal.continuations + 1 };
        show(ctx, next);
        return {
          entries: [
            { type: 'custom', customType: GOAL_ENTRY_TYPE, data: next },
            {
              type: 'custom_message',
              customType: GOAL_ENTRY_TYPE,
              content: reminder(next),
              display: false
            }
          ],
          continue: true
        };
      });
    }
  };
}
