"use client";

import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { organizationAc, organizationRoles } from "./organization-access";

/**
 * Browser-side auth client.
 *
 * Only for things that genuinely need to happen in the browser: sign-out from a
 * header button, the organization switcher, live session state in client
 * components. **Authentication itself goes through server actions** — form
 * submission stays functional without JavaScript, and the error handling in
 * `ActionResult` is one shape rather than two.
 *
 * `ac` and `roles` are passed so the client's `hasPermission` type-checks
 * against the same statements the server enforces. They carry no authority:
 * the client copy decides what to *render*, the server copy decides what
 * *happens*.
 *
 * No `baseURL` — same-origin, so the default is correct and there is no
 * environment variable to get wrong per deployment.
 */
export const authClient = createAuthClient({
  plugins: [organizationClient({ ac: organizationAc, roles: organizationRoles })],
});

export const { signIn, signOut, signUp, useSession, organization } = authClient;
