/**
 * Startup — where domain-event handlers are registered.
 *
 * ## Why here and not at import time
 *
 * §92's bus is populated by `on(...)` calls, and a handler that has not been
 * registered by the time something emits is a handler that silently does
 * nothing. Registering inside the module that *defines* a handler only works if
 * something imports it first, which makes the behaviour depend on module
 * loading order — the kind of coupling that works in development and fails once
 * a route is code-split differently.
 *
 * `register()` runs once per server process before any request, which is the
 * guarantee the bus needs.
 *
 * ## Node runtime only
 *
 * The handlers reach the database. `instrumentation.ts` also runs in the Edge
 * runtime, where Mongoose does not exist — hence the `NEXT_RUNTIME` guard,
 * which is the documented way to target one.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { registerInvoiceHandlers } = await import("@/services/invoices/handlers");
  registerInvoiceHandlers();

  /*
   * Notifications last, so a handler that creates something to be notified
   * about has already run. The bus fires handlers in registration order, and
   * `InvoicePaid → WorkReadyToStart` means the work-order notification depends
   * on the invoice handler having emitted it.
   */
  const { registerNotificationHandlers } = await import("@/services/notifications/handlers");
  registerNotificationHandlers();

  /*
   * Jobs last of all, and in this order for a reason: `registerJobs()` only
   * populates a map, but `startWorker()` begins claiming immediately, and a
   * job that emits a domain event needs the handlers above to exist by then.
   *
   * `startWorker` is a no-op unless `JOBS_WORKER=inline`, so a serverless
   * deployment reaches this line and does nothing — the queue is drained by
   * `/api/cron/tick` instead. Same handlers, same drain, different caller.
   */
  const { registerJobs } = await import("@/services/jobs/handlers");
  registerJobs();

  const { startWorker } = await import("@/services/jobs/worker");
  startWorker();
}

/**
 * Every uncaught server error, in one place — §95, ticket 27.
 *
 * Next calls this for anything that escapes a Server Component, a route handler
 * or a server action. `withAction` already catches and logs what happens inside
 * an action; this is the layer beneath it — a render that threw, a route that
 * blew up before its own try/catch.
 *
 * `digest` is the value the error page shows the customer and asks them to
 * quote. Logging it here is what makes that reference findable, and without it
 * "quote this reference" is theatre.
 *
 * This is also the Sentry seam. `Sentry.captureRequestError(error, request,
 * context)` goes here, and nothing else in the app changes.
 */
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string; headers: Record<string, string | undefined> },
  context: { routerKind: string; routePath: string; routeType: string },
): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { log } = await import("@/lib/logger");
  const { REQUEST_ID_HEADER } = await import("@/config/observability");

  log.exception("Unhandled server error", error, {
    code: "server.unhandled",
    path: request.path,
    method: request.method,
    route: context.routePath,
    routeType: context.routeType,
    ...(request.headers[REQUEST_ID_HEADER]
      ? { requestId: request.headers[REQUEST_ID_HEADER] }
      : {}),
    ...(typeof error === "object" && error !== null && "digest" in error
      ? { digest: String((error as { digest: unknown }).digest) }
      : {}),
  });
}
