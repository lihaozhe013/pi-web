import { configureHttpDispatcher, readHttpIdleTimeoutMs } from '@/lib/http-dispatcher';
import { closeAllAgentEventStreams } from '@/lib/agent-event-stream';
import { shutdownActiveTaskOrchestrator } from '@/lib/tasks/orchestrator';

/**
 * Process-wide setup that has to happen before the first request, and the shutdown steps that
 * run before the listener closes.
 */
export function registerNodeInstrumentation(): void {
  // The pi CLI applies settings' `httpIdleTimeoutMs` to the same undici
  // body/header timeouts, so a Web UI session gets the timeout the user
  // configured. Without it the built-in five minutes aborts a provider stream
  // that stays quiet for longer, which a CLI session tolerates.
  configureHttpDispatcher(readHttpIdleTimeoutMs());

  // A server close waits for every connection to end. SSE streams only end when the client
  // disconnects, so they are closed first or the process never exits.
  const shutdownStreams = () => closeAllAgentEventStreams();
  process.on('SIGINT', shutdownStreams);
  process.on('SIGTERM', shutdownStreams);

  // A bounded task child must not outlive the server that owns it: kill the
  // active child and settle its task before the process goes away. This creates
  // no orchestrator when the queue was never used.
  const shutdownTasks = () => {
    void shutdownActiveTaskOrchestrator().catch(() => {});
  };
  process.on('SIGINT', shutdownTasks);
  process.on('SIGTERM', shutdownTasks);

  // A route's module is evaluated on its first request, so the first /api/sessions used to pay
  // for importing the whole pi SDK, seconds on Windows (#964). Start that import now, unawaited
  // so startup stays fast: it overlaps the browser opening, and the routes reuse Node's cached
  // module. A failure is left for the routes' own import to report.
  import('@earendil-works/pi-coding-agent').catch(() => {});
}
