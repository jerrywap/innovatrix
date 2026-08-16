import "server-only";
import { serverEnv } from "@/config/env";
import { drainQueue, newWorkerId } from "./runner";
import { enqueueDueScheduled } from "./schedule";

/**
 * The in-process worker — the container half of the hosting answer.
 *
 * One `setTimeout` chain, not `setInterval`: an interval fires whether or not
 * the previous tick finished, so a slow drain would overlap itself and the
 * overlap would grow. Chaining means the next tick is scheduled *after* the
 * last one returned, and a worker that falls behind simply ticks less often
 * instead of forking.
 *
 * It is the same `drainQueue()` `/api/cron/tick` calls, which is the point:
 * moving this deployment to a serverless host means switching `JOBS_WORKER` to
 * `off` and pointing a scheduler at the route. No job changes.
 */

declare global {
  var __innovatrixJobWorker: { timer: NodeJS.Timeout | null; stopped: boolean } | undefined;
}

export function startWorker(): void {
  const env = serverEnv();
  if (env.JOBS_WORKER !== "inline") return;

  // Survives HMR. Without this every hot reload in development starts another
  // worker and they all poll the same collection.
  if (globalThis.__innovatrixJobWorker) return;

  const state = { timer: null as NodeJS.Timeout | null, stopped: false };
  globalThis.__innovatrixJobWorker = state;

  const workerId = newWorkerId();
  const pollMs = env.JOBS_POLL_MS;

  console.info(`[jobs] worker ${workerId} started (poll ${pollMs}ms)`);

  const tick = async (): Promise<void> => {
    if (state.stopped) return;

    try {
      await enqueueDueScheduled();
      await drainQueue({
        workerId,
        // Generous, because a container has no request timeout to respect. The
        // bound is here to make the scheduler tick reachable on a busy queue,
        // not to fit inside anything.
        budgetMs: 30_000,
        visibilityTimeoutMs: env.JOBS_VISIBILITY_TIMEOUT_MS,
      });
    } catch (error) {
      // The loop must outlive any single failure. A worker that exits on the
      // first bad tick is a queue that stops silently.
      console.error(
        "[jobs] worker tick failed:",
        error instanceof Error ? error.message : error,
      );
    }

    if (!state.stopped) state.timer = setTimeout(() => void tick(), pollMs);
  };

  // Deferred rather than immediate: at `instrumentation.register()` time the
  // database connection has not been made and the first tick would pay for it
  // while the first request waits behind it.
  state.timer = setTimeout(() => void tick(), pollMs);
  state.timer.unref?.();
}

/** Tests and scripts. The web app never stops its worker deliberately. */
export function stopWorker(): void {
  const state = globalThis.__innovatrixJobWorker;
  if (!state) return;

  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  globalThis.__innovatrixJobWorker = undefined;
}
