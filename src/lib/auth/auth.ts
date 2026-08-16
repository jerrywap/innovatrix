import "server-only";
import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins/organization";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { serverEnv, usesSecureCookies } from "@/config/env";
import { supportsTransactions } from "@/lib/db/client";
import {
  invitationMessage,
  resetPasswordMessage,
  sendAuthEmail,
  verifyEmailMessage,
} from "@/services/email";
import { organizationAc, organizationRoles } from "./organization-access";

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

function buildAuth() {
  const env = serverEnv();
  const { client, db } = authDatabase();

  return betterAuth({
    appName: "Innovatrix",
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
        await sendAuthEmail(verifyEmailMessage(user.email, url));
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
           * Populate `activeOrganizationId` at session creation.
           *
           * Nothing in the organization plugin does this, and our entire
           * tenancy model reads from it — a session without it means a
           * customer signs in and sees an empty dashboard.
           */
          before: async (session) => {
            const membership = await db.collection("organizationMembers").findOne(
              { userId: new ObjectId(String(session.userId)) },
              // Oldest membership wins: that is the personal organization
              // created at signup, which is the sane default landing context.
              { sort: { createdAt: 1 }, projection: { organizationId: 1 } },
            );

            if (!membership) return;
            return {
              data: {
                ...session,
                activeOrganizationId: String(membership.organizationId),
              },
            };
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

    advanced: {
      cookiePrefix: "innovatrix",
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
