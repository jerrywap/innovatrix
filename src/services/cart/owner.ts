import "server-only";
import { cookies } from "next/headers";
import { nanoid } from "nanoid";
import { usesSecureCookies } from "@/config/env";

/**
 * Whose cart is this — §12.
 *
 * ## `ownerKey`, and why it is one field rather than two
 *
 * A cart belongs to either a guest cookie or a user. Modelling that as two
 * nullable columns means every query has a branch and the merge has four cases.
 * One string — `guest:<nanoid>` or `user:<id>` — with a unique index gives an
 * exact lookup, makes the merge a rename, and makes "which cart am I looking
 * at" impossible to get wrong.
 *
 * ## The guest cookie is httpOnly
 *
 * It is a bearer token for a basket. Not a security boundary — there is nothing
 * private in a cart — but a cart id readable by script is a cart id that leaks
 * into analytics and error reports, and there is no reason for the browser to
 * see it.
 *
 * ## Reading is not writing
 *
 * `readOwnerKey()` never creates a cookie, because it runs in Server Components
 * where Next.js forbids setting one. Only `ensureGuestKey()` writes, and it is
 * called from Server Actions and Route Handlers only. That distinction is the
 * same one ticket 09's recently-viewed cookie got wrong.
 */

export const CART_COOKIE = "innovatrix_cart";
const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export function guestKey(id: string): string {
  return `guest:${id}`;
}

export function userKey(userId: string): string {
  return `user:${userId}`;
}

/**
 * The owner key for this request, or `undefined` when there is neither a
 * session nor a guest cookie — which is the correct answer for a visitor who
 * has never added anything.
 */
export async function readOwnerKey(userId?: string): Promise<string | undefined> {
  if (userId) return userKey(userId);

  const jar = await cookies();
  const id = jar.get(CART_COOKIE)?.value;
  return id ? guestKey(id) : undefined;
}

/**
 * The owner key, minting a guest cookie if there is none.
 *
 * **Server Actions and Route Handlers only.** Setting a cookie anywhere else
 * throws in Next.js, and a `try/catch` around it produces a feature that
 * silently never works.
 */
export async function ensureOwnerKey(userId?: string): Promise<string> {
  if (userId) return userKey(userId);

  const jar = await cookies();
  const existing = jar.get(CART_COOKIE)?.value;
  if (existing) return guestKey(existing);

  const id = nanoid(21);
  jar.set({
    name: CART_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: "lax",
    secure: usesSecureCookies(),
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  });

  return guestKey(id);
}

/** After a merge, so the guest cookie stops pointing at a cart that is gone. */
export async function clearGuestCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(CART_COOKIE);
}
