import { NextResponse } from 'next/server';
import { GOAL_LIMIT_BOUNDS, normalizeGoalLimits } from '@/lib/goal-policy';
import { readGoalLimits, writeGoalLimits } from '@/lib/goal-settings';
import { hasJsonContentType, isApiRequestAllowed } from '@/lib/request-security';

export const dynamic = 'force-dynamic';

// The default depth of a new autonomous goal: the global `piWebGoal` key in
// settings.json. Each goal can still choose its own depth in the Goal dialog;
// sessions read these when a goal starts, so a change applies without a restart.

function refusal(
  status: number,
  reason: 'invalid-request' | 'request-denied' | 'content-type' | 'internal',
  error: string
) {
  return NextResponse.json({ error, reason }, { status });
}

function errorResponse(error: unknown) {
  return refusal(500, 'internal', error instanceof Error ? error.message : String(error));
}

export async function GET() {
  try {
    return NextResponse.json(await readGoalLimits());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return refusal(403, 'request-denied', 'Untrusted API request');
  }
  if (!hasJsonContentType(req)) {
    return refusal(415, 'content-type', 'Content-Type must be application/json');
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return refusal(400, 'invalid-request', 'Invalid JSON body');
  }
  const limits = normalizeGoalLimits(body);
  if (!limits) {
    const { maxContinuations, maxTokens, maxElapsedMs } = GOAL_LIMIT_BOUNDS;
    return refusal(
      400,
      'invalid-request',
      `Send maxContinuations ${maxContinuations.min}-${maxContinuations.max}, maxTokens ${maxTokens.min}-${maxTokens.max} and maxElapsedMs ${maxElapsedMs.min}-${maxElapsedMs.max}`
    );
  }
  try {
    return NextResponse.json(await writeGoalLimits(limits));
  } catch (error) {
    return errorResponse(error);
  }
}
