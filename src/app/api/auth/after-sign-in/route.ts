import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { serverEnv } from "@/config/env";
import { adoptGuestStateFor } from "@/features/auth/adopt-guest-state";
import { safeRedirectPath } from "@/lib/return-path";

/**
 * Where an OAuth sign-in lands, so the cart and the conversation survive it.
 *
 * ## Why a Route Handler, and why only for OAuth
 *
 * The password, registration and invitation paths are all Server Actions: they
 * can adopt the guest state inline and clear the guest cookies themselves, and
 * they do. **Google cannot.** It completes inside Better Auth's own
 * `/api/auth/callback/google` with no action of ours anywhere in the path — the
 * browser is handed to Google and comes back to whatever `callbackURL` said. So
 * `signInWithGoogleAction` points `callbackURL` here, this runs, and then the
 * visitor continues to where they were going.
 *
 * ## This is safe to redirect to, and a Server Action's redirect would not be
 *
 * Better Auth's callback issues a real `302` to this URL, so the browser
 * performs a **document navigation** and the handler actually executes. A
 * Server Action redirecting here would not work: the client router cannot render
 * a Route Handler — it fetches one as RSC, gets a bodyless redirect, and stops on
 * a blank page. That is exactly the failure that made a stale session an
 * unrecoverable white screen on `/dashboard`, and it is why the other three
 * paths adopt inline instead of being funnelled through here.
 *
 * ## `next` is attacker-influenced
 *
 * It started life as `?next=` on our own URL and travelled to Google and back,
 * so it goes through `safeRedirectPath` exactly as every other use of it does.
 * A visitor who arrives here with no `next` goes to the dashboard.
 *
 * ## It never fails the sign-in
 *
 * `adoptGuestStateFor` catches each half separately and logs. The session
 * already exists by the time this runs; there is nothing a lost basket should
 * be allowed to undo.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const next = safeRedirectPath(url.searchParams.get("next") ?? undefined, "/dashboard");

  // The request carries the session cookie Better Auth's callback just set, so
  // no cookie lift is needed — unlike the Server Action paths.
  await adoptGuestStateFor(await headers());

  return NextResponse.redirect(new URL(next, serverEnv().APP_URL));
}
