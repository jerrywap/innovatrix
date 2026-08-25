import { headObject, healthcheckProbeKey } from "@/services/storage";
import { connectToDatabase, mongoose } from "@/lib/db/client";
import { alert, ALERTS } from "@/lib/alerts";

/**
 * `/api/health` — §95's uptime check.
 *
 * ## It checks the dependencies, not itself
 *
 * A health endpoint that returns `{ok: true}` unconditionally tells you the
 * process is running, which the load balancer already knew because it got a
 * response. The useful version answers "can this instance actually serve a
 * request", and for this app that means MongoDB and the object store — a
 * marketplace with no database serves nothing, and My Scripts with no bucket
 * serves a broken download button.
 *
 * ## Unauthenticated, and therefore says nothing
 *
 * An uptime monitor has no session. So the body is three booleans and a
 * duration: no versions, no hostnames, no connection strings, no error text. A
 * health endpoint is a reconnaissance surface if it explains itself.
 *
 * ## 503 when a dependency is down
 *
 * Not 200-with-`ok:false`. Monitors branch on the status code, and an endpoint
 * that always returns 200 is one that never fires an alert.
 */

/**
 * Sized for a **cold** instance, not a warm one.
 *
 * This was 3s, and the first request to a freshly started server reported
 * `storage: false` with `ms: 3012` — the timeout, exactly. The S3 HEAD itself
 * takes 125–165ms once warm; the first one pays for SDK initialisation,
 * credential resolution and TLS, and on that measurement went past three
 * seconds.
 *
 * A health check that fails on cold start is worse than none: on any platform
 * that scales to zero it flaps, and a monitor that cries wolf gets muted. The
 * budget has to cover the slowest *legitimate* response, which is the first
 * one after a deploy.
 *
 * Found by starting the production build and calling it, rather than by
 * reasoning about it — the code was correct and the number was wrong.
 */
const TIMEOUT_MS = 8_000;

export async function GET(): Promise<Response> {
  const startedAt = Date.now();

  const [database, storage] = await Promise.all([checkDatabase(), checkStorage()]);
  const ok = database && storage;

  if (!ok) {
    // The alert carries the detail; the response does not.
    alert(ALERTS.dependencyDown, "A health check dependency is unreachable", {
      database,
      storage,
    });
  }

  return Response.json(
    { ok, database, storage, ms: Date.now() - startedAt },
    {
      status: ok ? 200 : 503,
      // A cached health check is a health check that reports the past.
      headers: { "cache-control": "no-store" },
    },
  );
}

async function checkDatabase(): Promise<boolean> {
  try {
    await withTimeout(async () => {
      await connectToDatabase();
      // `ping` rather than a query on a collection: it is the cheapest thing
      // that proves a round trip, and it does not depend on any schema.
      await mongoose.connection.db?.admin().ping();
    });
    return true;
  } catch {
    return false;
  }
}

async function checkStorage(): Promise<boolean> {
  try {
    await withTimeout(async () => {
      /*
       * A HEAD on a key that does not exist.
       *
       * `headObject` returns `null` for a missing object and *throws* when the
       * bucket is unreachable or the credentials are wrong — which is exactly
       * the distinction this needs. Checking for a key that must exist would
       * make the health of the app depend on somebody not deleting a file.
       *
       * The key is built through `healthcheckKey`, so it lands inside
       * `innovatrix/{env}/` and `assertKeyInPrefix` passes. A hand-written
       * string would be refused by that guard before it ever reached S3 — and
       * would have reported storage as *down* rather than as misconfigured.
       * The bucket is shared with unrelated live applications; the prefix is
       * what keeps this from touching any of them.
       */
      await headObject(healthcheckProbeKey());
    });
    return true;
  } catch {
    return false;
  }
}

async function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS),
    ),
  ]);
}
