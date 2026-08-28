import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { serverEnv, usesSecureCookies } from "@/config/env";
import { supportsTransactions } from "@/lib/db/client";
import { COOKIE_PREFIX } from "./cookie-prefix";
import {
  invitationMessage,
  resetPasswordMessage,
  sendAuthEmail,
  verifyEmailMessage,
} from "@/services/email";
import { organizationAc, organizationRoles } from "./organization-access";
import { activeOrganizationForSession } from "./personal-organization";

/**
 * Better Auth configuration — §75 (auth), §76 (organizations), §88.
 *
 * ## Shared collections
 *
 * Better Auth writes into the same collections our Mongoose models describe,
 * mapped explicitly below via `modelName`. This is why `usePlural` is not used:
 * it appends an `"s"` to whatever name is in play, including a custom
 * `modelName`, which would give `organizationMemberss`.
 *
 * Because the adapter goes through the raw driver, **Mongoose defaults do not
 * fire on documents Better Auth creates**. Every field we later filter on is
 * therefore declared in `additionalFields` with a matching default, so the
 * value is physically present. Without that, `{ isStaff: false }` matches
 * nothing — MongoDB does not treat a missing field as `false`.
 *
 * ## What Better Auth does *not* do
 *
 * - **It creates no indexes.** `unique: true` in its schema is validation
 *   metadata, not a database constraint. `sessions.token` and friends are
 *   indexed by our own models (`src/lib/db/models/identity.ts`) and applied by
 *   `npm run db:indexes`.
 * - **It does not decide staff authority.** See `permissions.ts`.
 */

/* ────────────────────────────────────────────── connection

   Better Auth needs a native `Db` synchronously at construction, while our
   Mongoose connection is established lazily and asynchronously. Rather than
   racing that, this module opens its own driver handle: `new MongoClient()`
   does not connect — the driver dials on first operation — so this is safe at
   module scope and adds no startup cost.

   Cached on `globalThis` for the same reason the Mongoose connection is: HMR
   re-evaluates this file on every edit, and an uncached client would leak a
   pool per reload.                                                          */

declare global {
  var __innovatrixAuthMongo: { client: MongoClient; db: Db } | undefined;
}

function authDatabase(): { client: MongoClient; db: Db } {
  if (globalThis.__innovatrixAuthMongo) return globalThis.__innovatrixAuthMongo;

  const env = serverEnv();
  const client = new MongoClient(env.MONGODB_URI, {
    // Small: this pool serves session lookups, not application queries.
    maxPoolSize: 5,
    minPoolSize: 0,
  });
  const handle = { client, db: client.db(env.MONGODB_DB_NAME) };
  globalThis.__innovatrixAuthMongo = handle;
  return handle;
}

/* ────────────────────────────────────────────── config */

/**
 * Where a confirmation link lands once Better Auth has verified the token.
 *
 * ## The bug this fixes
 *
 * Better Auth builds the link as
 * `/api/auth/verify-email?token=…&callbackURL=…`, verifies, then redirects to
 * that `callbackURL`. Nothing was setting one for the **sign-up** send — it is
 * fired by `sendOnSignUp` with no caller to pass one — so it defaulted to `/`.
 * The account really was confirmed and the person was silently dropped on the
 * home page, which is indistinguishable from a link that did nothing. The
 * resend path had the same shape with a different destination (`/dashboard`),
 * so the one flow told two stories and neither said "confirmed".
 *
 * `/verify-email` already renders **"You're all set — your email address is
 * confirmed"** when the session says so, and `autoSignInAfterVerification`
 * guarantees there is a session by the time the redirect happens. So the page
 * that answers this existed; nothing was pointing at it.
 *
 * ## Rewritten here rather than passed by each caller
 *
 * There are two senders and one of them — `sendOnSignUp` — has no call site to
 * put an argument in. Setting it in the one function every verification email
 * goes through is the only place that covers both, and it means a third sender
 * cannot reintroduce the bug by forgetting.
 *
 * A caller wanting somewhere else should send them onward *from* the
 * confirmation page rather than around it: the first thing a person needs after
 * clicking a link in their email is to be told it worked.
 *
 * Falls back to the URL untouched if it will not parse. A malformed verification
 * link is a problem, and swallowing the send is a worse one.
 */
function confirmationLanding(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("callbackURL", "/verify-email");
    return parsed.toString();
  } catch {
    return url;
  }
}

function buildAuth() {
  const env = serverEnv();
  const { client, db } = authDatabase();

  return betterAuth({
    appName: "CoSetup",
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,

    database: mongodbAdapter(db, {
      client,
      // Defaults to `true` whenever a client is passed, and a standalone mongod
      // rejects every transaction — which would mean every signup failing in
      // local development. Derived, never assumed.
      transaction: supportsTransactions(),
    }),

    emailAndPassword: {
      enabled: true,
      // §75: verified email is required before *purchase*, not before signing
      // in — a customer must be able to browse while the email lands. The gate
      // lives at checkout (ticket 11), enforced by `requireVerifiedUser()`.
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      resetPasswordTokenExpiresIn: 60 * 60,
      // A reset means someone may have had access to the account. Ending every
      // other session is the point of resetting (§88).
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(resetPasswordMessage(user.email, url));
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(verifyEmailMessage(user.email, confirmationLanding(url)));
      },
    },

    session: {
      modelName: "sessions",
      expiresIn: 60 * 60 * 24 * env.AUTH_SESSION_DAYS,
      updateAge: 60 * 60 * 24,
      // NOT enabling `deferSessionRefresh` — it returns 415 on Next.js 16 route
      // handlers (open upstream issue).
      cookieCache: {
        enabled: true,
        // Short on purpose. The cache is what stops every render hitting the
        // database, but it also delays revocation by exactly this long, so it
        // is measured in seconds rather than minutes. Anything that must take
        // effect immediately (removing a member) is checked against the
        // database in the DAL, not read from the session.
        maxAge: 60,
      },
    },

    user: {
      modelName: "users",
      additionalFields: {
        // Mirrors the Mongoose defaults in identity.ts. Each of these is a
        // field we filter on, so it must be written rather than defaulted.
        isStaff: { type: "boolean", required: false, defaultValue: false, input: false },
        locale: { type: "string", required: false, defaultValue: "en-GB", input: false },
        lastActiveAt: { type: "date", required: false, input: false },
        deletedAt: { type: "date", required: false, defaultValue: null, input: false },
      },
    },

    account: {
      modelName: "accounts",
      accountLinking: {
        enabled: true,
        // Only link automatically for providers that verify the address
        // themselves. Trusting an unverified provider assertion would let
        // anyone claiming an address take over the matching account.
        trustedProviders: ["google"],
      },
    },

    verification: { modelName: "verifications" },

    socialProviders: env.AUTH_GOOGLE_ENABLED
      ? {
          google: {
            clientId: env.AUTH_GOOGLE_CLIENT_ID!,
            clientSecret: env.AUTH_GOOGLE_CLIENT_SECRET!,
          },
        }
      : {},

    databaseHooks: {
      session: {
        create: {
          /**
           * Populate `activeOrganizationId` at session creation — and, for a
           * social signup, create the organization it names.
           *
           * Nothing in the organization plugin does either, and our entire
           * tenancy model reads from it — a session without it means a
           * customer signs in and sees an empty dashboard.
           *
           * ## Why the *creation* is here and not only in `registerAction`
           *
           * §76's organization was created in exactly one place: `registerAction`.
           * Google never reaches it. OAuth completes inside Better Auth's own
           * `/api/auth/callback/google`, which creates the user, the account and
           * the session with no action of ours anywhere in the path — so a
           * first-time Google signup produced a user with no membership, this
           * hook found none, `activeOrganizationId` stayed null, and
           * `/dashboard` answered "Your account isn't set up yet… which
           * shouldn't happen." It was right: signup could not be completed.
           *
           * This hook is the one seam that works. It runs **after** the user and
           * account rows are committed — `createOAuthUser` wraps those two in a
           * transaction that has ended by now — and **before** the session row
           * is written, which is the half that matters: the session cookie
           * carries a signed cache of itself, minted from what this returns. Do
           * it any later and that cache says `null` for `cookieCache.maxAge`
           * seconds, which is precisely the stale-organization bug
           * `adoptActiveOrganization` exists to repair. Done here, there is
           * nothing to repair.
           *
           * ## Why the email path is left alone
           *
           * `signUpEmail` creates a session too, at a moment when its new user
           * also has no membership — so this must not fire for it, or every
           * email signup would get a personal organization here *and* the one
           * `registerAction` creates a moment later from the company name on the
           * form, which would be their second.
           *
           * The discriminator is the account row, committed by now: a social
           * signup has a non-`credential` account, an email signup has only a
           * `credential` one. Staff have neither and take the same branch —
           * they legitimately have no organization, and the dashboard layout
           * sends them to `/staff`.
           */
          before: async (session) => {
            const activeOrganizationId = await activeOrganizationForSession(
              db,
              new ObjectId(String(session.userId)),
            );

            if (!activeOrganizationId) return;
            return { data: { ...session, activeOrganizationId } };
          },

          /**
           * §90's missing entry: a session was created.
           *
           * Auth events were the one category of §90-worthy action with no
           * audit at all, and they are the first thing anybody looks for after
           * an incident — "when did this account last sign in, and from where".
           *
           * Here rather than in `signInAction` because that is not the only way
           * a session is created: OAuth, an invitation acceptance and a password
           * reset all produce one without going near it.
           *
           * Fire-and-forget: `writeAuditLog` without a session swallows its own
           * failures, so a logging problem cannot stop somebody signing in.
           */
          after: async (session) => {
            const { writeAuditLog } = await import("@/services/audit");
            await writeAuditLog({
              action: "session.created",
              actor: {
                type: "customer",
                userId: String(session.userId),
                // Absent at signup and for somebody between organisations —
                // see the note on `AuditActor`.
                ...(session.activeOrganizationId
                  ? { organizationId: String(session.activeOrganizationId) }
                  : {}),
              },
              ...(session.ipAddress ? { ip: session.ipAddress } : {}),
              ...(session.userAgent ? { userAgent: session.userAgent } : {}),
            });
          },
        },
      },

      account: {
        create: {
          /**
           * A social provider was linked — the other half of the security alerts.
           *
           * Here rather than in `connectGoogleAction`, because the action cannot
           * know whether the link succeeded: it hands the browser to Google and
           * the account row is written later, in Better Auth's own callback. It
           * also catches the *other* way linking happens — `accountLinking` is
           * enabled with `google` trusted, so signing in with a matching verified
           * address links automatically and no action of ours runs at all.
           *
           * Two filters, and both matter. `credential` is skipped because that
           * row is created at signup and "a password was added to your account"
           * is not news to somebody who just chose one — `setPasswordAction`
           * announces the case where it genuinely is. And an account is only
           * announced when the user already had one, so a brand-new Google signup
           * is a signup rather than a link.
           *
           * Fire-and-forget: a notification must never be able to fail an
           * authentication.
           */
          after: async (account) => {
            if (account.providerId === "credential") return;

            try {
              const existing = await db.collection("accounts").countDocuments(
                { userId: new ObjectId(String(account.userId)) },
                // Two is enough to answer "was there one before this": the row
                // being created is already written by the time `after` runs.
                { limit: 2 },
              );
              if (existing < 2) return;

              const { emit } = await import("@/lib/events");
              await emit("SocialAccountLinked", {
                userId: String(account.userId),
                provider: account.providerId,
              });
            } catch (error) {
              console.error(
                "[auth] account linked but could not be announced:",
                error instanceof Error ? error.message : error,
              );
            }
          },
        },
      },
    },

    plugins: [
      organization({
        ac: organizationAc,
        roles: organizationRoles,
        creatorRole: "owner",
        invitationExpiresIn: 60 * 60 * 48,
        cancelPendingInvitationsOnReInvite: true,
        schema: {
          organization: {
            modelName: "organizations",
            additionalFields: {
              defaultCurrency: {
                type: "string",
                required: false,
                defaultValue: "GBP",
                input: false,
              },
              isPersonal: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false,
              },
              customerSince: { type: "date", required: false, input: false },
              deletedAt: { type: "date", required: false, defaultValue: null, input: false },
            },
          },
          member: {
            modelName: "organizationMembers",
            additionalFields: {
              // `addMember` inserts without this; declaring it here is what
              // makes "active" physically present so `{ status: "active" }`
              // matches. See identity.ts.
              status: {
                type: "string",
                required: false,
                defaultValue: "active",
                input: false,
              },
            },
          },
          invitation: { modelName: "organizationInvitations" },
        },
        organizationHooks: {
          /**
           * Stamp the fields Mongoose would have defaulted. `additionalFields`
           * defaults cover creation through Better Auth's own endpoints; this
           * hook is the belt to that braces, and is also where anything
           * genuinely derived (rather than constant) belongs.
           */
          beforeCreateOrganization: async ({ organization: org }) => ({
            data: { ...org, customerSince: new Date() },
          }),
        },
        async sendInvitationEmail(data) {
          await sendAuthEmail(
            invitationMessage({
              to: data.email,
              organizationName: data.organization.name,
              inviterName: data.inviter.user.name || data.inviter.user.email,
              // Better Auth deliberately does not generate this URL — the
              // accept page reads the id from the query string.
              url: `${env.APP_URL}/accept-invite?id=${data.id}`,
            }),
          );
        },
      }),

      // Must be last: it reads the Set-Cookie headers every preceding plugin
      // has produced and applies them to the Next.js cookie store.
      nextCookies(),
    ],

    /*
     * §88's auth rate limiting — ticket 26.
     *
     * Better Auth ships a limiter and leaves it **off in development**, which
     * is a sensible library default and the wrong one here: an unthrottled
     * `/api/auth/sign-in/email` is a credential-stuffing endpoint, and it is
     * unthrottled in exactly the environment where nobody notices.
     *
     * `enabled: true` unconditionally, then per-path budgets on the three that
     * accept a guess. `window` is in seconds.
     *
     * This covers the Better Auth handler's own routes. Everything else that
     * needs throttling — licence activation, AI turns, downloads — goes through
     * `src/lib/rate-limit.ts`, which shares the datastore but not the code,
     * because the library's limiter cannot see our route handlers.
     */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 60,
      customRules: {
        // Ten in five minutes. A person who has forgotten which password they
        // used tries three or four; a script tries thousands.
        "/sign-in/email": { window: 300, max: 10 },
        "/sign-up/email": { window: 3600, max: 5 },
        // Each one sends an email to an address the caller chose, so an
        // unbounded version is a way to use us to send mail at somebody.
        "/request-password-reset": { window: 3600, max: 5 },
        "/send-verification-email": { window: 3600, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // Keyed to the scheme we are actually served over, not to NODE_ENV — see
      // `usesSecureCookies`. A `Secure` cookie sent over http is dropped by the
      // browser, which looks exactly like a broken login.
      useSecureCookies: usesSecureCookies(),
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: usesSecureCookies(),
      },
    },
  });
}

/**
 * Built on first use, not at module load.
 *
 * This is not a micro-optimisation. `next build` imports every page module to
 * collect its configuration, in a process where `NODE_ENV` is `production` but
 * no runtime environment exists. Constructing eagerly meant the build validated
 * production secrets and opened a MongoDB client just to discover that
 * `/accept-invite` has no route segment config — and failed.
 *
 * Cached on `globalThis` for the same reason as the Mongo handle: HMR
 * re-evaluates this file on every edit, and rebuilding per reload re-registers
 * plugins and re-derives cookie configuration.
 */
declare global {
  var __innovatrixAuth: ReturnType<typeof buildAuth> | undefined;
}

export function getAuth(): ReturnType<typeof buildAuth> {
  return (globalThis.__innovatrixAuth ??= buildAuth());
}

export type Auth = ReturnType<typeof buildAuth>;
