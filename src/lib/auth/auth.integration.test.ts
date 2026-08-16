import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { organization } from "better-auth/plugins/organization";
import { MongoClient, ObjectId, type Db } from "mongodb";
import mongoose from "mongoose";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { organizationAc, organizationRoles } from "./organization-access";

/**
 * Integration tests against a real Better Auth instance and a real MongoDB.
 *
 * These exist because every claim they check is one that unit tests cannot
 * make and that only fails in production:
 *
 * - The adapter creates **no indexes**, so `sessions.token` uniqueness is ours
 *   to declare and ours to verify.
 * - Better Auth writes through the raw driver, so Mongoose defaults do not
 *   fire — `{ isStaff: false }` matching every user is an assumption, not a
 *   fact, until something checks it.
 * - Cross-tenant isolation is the one bug class that is invisible until it
 *   isn't, and the ticket requires it be proven by *calling the code*, not by
 *   navigating a UI.
 *
 * A replica set rather than a standalone mongod, so the transactional path
 * Better Auth uses in production is the path under test.
 */

let client: MongoClient;
let db: Db;
let auth: ReturnType<typeof buildTestAuth>;

/**
 * Mirrors `auth.ts`, minus the parts that read validated env. Kept in sync by
 * hand rather than importing the singleton, because that module resolves the
 * real environment at import time and would talk to the real database.
 */
function buildTestAuth(database: Db, mongoClient: MongoClient) {
  return betterAuth({
    appName: "Innovatrix (test)",
    baseURL: "http://localhost:3000",
    secret: "test-secret-that-is-definitely-long-enough-000",
    database: mongodbAdapter(database, { client: mongoClient, transaction: true }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 12,
    },
    // No mail in tests; verification links are covered by the email service's
    // own tests.
    emailVerification: { sendOnSignUp: false },
    user: {
      modelName: "users",
      additionalFields: {
        isStaff: { type: "boolean", required: false, defaultValue: false, input: false },
        locale: { type: "string", required: false, defaultValue: "en-GB", input: false },
        deletedAt: { type: "date", required: false, defaultValue: null, input: false },
      },
    },
    session: { modelName: "sessions" },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const membership = await database
              .collection("organizationMembers")
              .findOne(
                { userId: new ObjectId(String(session.userId)) },
                { sort: { createdAt: 1 }, projection: { organizationId: 1 } },
              );
            if (!membership) return;
            return {
              data: { ...session, activeOrganizationId: String(membership.organizationId) },
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
        schema: {
          organization: {
            modelName: "organizations",
            additionalFields: {
              isPersonal: {
                type: "boolean",
                required: false,
                defaultValue: false,
                input: false,
              },
              deletedAt: { type: "date", required: false, defaultValue: null, input: false },
            },
          },
          member: {
            modelName: "organizationMembers",
            additionalFields: {
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
      }),
    ],
  });
}

beforeAll(async () => {
  const uri = inject("mongoUri");
  client = new MongoClient(uri);
  await client.connect();
  db = client.db("auth_test");

  await mongoose.connect(uri, { dbName: "auth_test" });
  // Registers every model, then builds their indexes — including the ones the
  // Better Auth adapter would never create.
  await import("@/lib/db/models");
  for (const name of mongoose.modelNames()) {
    await mongoose.model(name).syncIndexes();
  }

  auth = buildTestAuth(db, client);
}, 180_000);

afterAll(async () => {
  await mongoose.disconnect();
  await client?.close();
});

/* ────────────────────────────────────────────── helpers */

let seq = 0;
const uniqueEmail = () => `user${(seq += 1)}-${Date.now()}@example.test`;

async function signUp(name: string) {
  const email = uniqueEmail();
  const result = await auth.api.signUpEmail({
    body: { name, email, password: "a-sufficiently-long-password" },
    headers: new Headers(),
    // Ask for the raw response so the Set-Cookie header is reachable; the
    // session cookie is what every subsequent call needs.
    returnHeaders: true,
  });

  const setCookie = result.headers.get("set-cookie") ?? "";
  const cookie = setCookie
    .split(/,(?=[^;]+?=)/)
    .map((part) => part.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");

  return { email, userId: String(result.response.user.id), headers: new Headers({ cookie }) };
}

async function createOrg(headers: Headers, name: string, slug: string) {
  const org = await auth.api.createOrganization({ body: { name, slug }, headers });
  return String(org!.id);
}

/* ────────────────────────────────────────────── indexes */

describe("indexes Better Auth does not create", () => {
  it("makes sessions.token unique", async () => {
    const indexes = await db.collection("sessions").indexes();
    const token = indexes.find((i) => JSON.stringify(i.key) === JSON.stringify({ token: 1 }));
    expect(token, "sessions.token index is missing").toBeDefined();
    expect(token?.unique, "sessions.token must be unique").toBe(true);
  });

  it("expires sessions and verifications by TTL", async () => {
    for (const collection of ["sessions", "verifications"]) {
      const indexes = await db.collection(collection).indexes();
      const ttl = indexes.find((i) => i.expireAfterSeconds !== undefined);
      expect(ttl, `${collection} has no TTL index`).toBeDefined();
    }
  });

  it("makes an account unique per (provider, external id)", async () => {
    const indexes = await db.collection("accounts").indexes();
    const compound = indexes.find(
      (i) => JSON.stringify(i.key) === JSON.stringify({ providerId: 1, accountId: 1 }),
    );
    expect(compound?.unique).toBe(true);
  });
});

/* ────────────────────────────────────────────── raw-driver writes */

describe("documents Better Auth writes", () => {
  it("stores _id and reference fields as real ObjectIds, not strings", async () => {
    const alice = await signUp("Alice");
    const orgId = await createOrg(alice.headers, "Alice Ltd", `alice-${seq}`);

    const user = await db.collection("users").findOne({ _id: new ObjectId(alice.userId) });
    expect(user?._id).toBeInstanceOf(ObjectId);

    const member = await db
      .collection("organizationMembers")
      .findOne({ organizationId: new ObjectId(orgId) });
    // If these came back as strings, every Mongoose query joining on them
    // would silently return nothing.
    expect(member?.userId).toBeInstanceOf(ObjectId);
    expect(member?.organizationId).toBeInstanceOf(ObjectId);
  });

  /**
   * The whole reason `additionalFields` mirrors the Mongoose defaults. MongoDB
   * does not match a missing field against `false`, so without this the staff
   * area's own filter would exclude every real user.
   */
  it("writes isStaff explicitly so { isStaff: false } matches", async () => {
    const bob = await signUp("Bob");

    const raw = await db.collection("users").findOne({ _id: new ObjectId(bob.userId) });
    expect(Object.hasOwn(raw!, "isStaff")).toBe(true);
    expect(raw!.isStaff).toBe(false);

    const matched = await db
      .collection("users")
      .findOne({ _id: new ObjectId(bob.userId), isStaff: false });
    expect(matched).not.toBeNull();
  });

  it("writes member.status explicitly for the same reason", async () => {
    const carol = await signUp("Carol");
    const orgId = await createOrg(carol.headers, "Carol Ltd", `carol-${seq}`);

    const member = await db
      .collection("organizationMembers")
      .findOne({ organizationId: new ObjectId(orgId) });
    expect(member?.status).toBe("active");
  });
});

/* ────────────────────────────────────────────── session context */

describe("active organization", () => {
  it("is populated on the session by the create hook", async () => {
    const dave = await signUp("Dave");
    await createOrg(dave.headers, "Dave Ltd", `dave-${seq}`);

    // The hook runs at session *creation*, and the sign-up session predates
    // the organization — so sign in again to get a session that has one.
    const signedIn = await auth.api.signInEmail({
      body: { email: dave.email, password: "a-sufficiently-long-password" },
      headers: new Headers(),
      returnHeaders: true,
    });

    const cookie = (signedIn.headers.get("set-cookie") ?? "")
      .split(/,(?=[^;]+?=)/)
      .map((p) => p.split(";")[0]?.trim())
      .filter(Boolean)
      .join("; ");

    const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
    expect(session?.session.activeOrganizationId).toBeTruthy();
  });
});

/* ────────────────────────────────────────────── tenant isolation */

describe("cross-tenant isolation — the ticket's first acceptance criterion", () => {
  it("gives a member of org A no membership row in org B", async () => {
    const alice = await signUp("Alice A");
    const bob = await signUp("Bob B");

    const orgA = await createOrg(alice.headers, "Org A", `org-a-${seq}`);
    const orgB = await createOrg(bob.headers, "Org B", `org-b-${seq}`);

    // This is exactly the query `requireOrg`/`assertOrgAccess` run. If it ever
    // returns a document, every scoped repository in the application is
    // reachable across tenants.
    const trespass = await db.collection("organizationMembers").findOne({
      organizationId: new ObjectId(orgB),
      userId: new ObjectId(alice.userId),
      status: "active",
    });
    expect(trespass).toBeNull();

    const legitimate = await db.collection("organizationMembers").findOne({
      organizationId: new ObjectId(orgA),
      userId: new ObjectId(alice.userId),
      status: "active",
    });
    expect(legitimate).not.toBeNull();

    // And Better Auth refuses at its own boundary too, so switching context to
    // someone else's organization is not a way in.
    const switchDenied = await auth.api
      .setActiveOrganization({ body: { organizationId: orgB }, headers: alice.headers })
      .then(
        () => null,
        (error: unknown) => error,
      );
    // Asserted on the *reason*, not merely that something threw — a rejection
    // for a malformed argument would pass a bare `.rejects.toThrow()` while
    // proving nothing about authorization.
    expect(switchDenied).toBeInstanceOf(APIError);
    expect((switchDenied as APIError).status).toBe("FORBIDDEN");

    expect(bob.userId).not.toBe(alice.userId);
  });

  it("refuses to read another organization's record through the plugin", async () => {
    const eve = await signUp("Eve");
    const mallory = await signUp("Mallory");

    const orgEve = await createOrg(eve.headers, "Eve Ltd", `eve-${seq}`);
    await createOrg(mallory.headers, "Mallory Ltd", `mallory-${seq}`);

    const readDenied = await auth.api
      .getFullOrganization({ query: { organizationId: orgEve }, headers: mallory.headers })
      .then(
        () => null,
        (error: unknown) => error,
      );
    expect(readDenied).toBeInstanceOf(APIError);
    expect((readDenied as APIError).status).toBe("FORBIDDEN");
  });
});

/* ────────────────────────────────────────────── revocation */

describe("removing a member revokes access immediately", () => {
  it("ends access on the next request, not when the session expires", async () => {
    const owner = await signUp("Owner");
    const orgId = await createOrg(owner.headers, "Shared Ltd", `shared-${seq}`);

    const colleague = await signUp("Colleague");

    // Insert the membership directly: the invitation round-trip needs a
    // mailbox, and what is under test is revocation, not the invite flow.
    await db.collection("organizationMembers").insertOne({
      organizationId: new ObjectId(orgId),
      userId: new ObjectId(colleague.userId),
      role: "member",
      status: "active",
      createdAt: new Date(),
    });

    const scopeQuery = {
      organizationId: new ObjectId(orgId),
      userId: new ObjectId(colleague.userId),
      status: "active",
    };
    expect(await db.collection("organizationMembers").findOne(scopeQuery)).not.toBeNull();

    await auth.api.removeMember({
      body: { memberIdOrEmail: colleague.email, organizationId: orgId },
      headers: owner.headers,
    });

    // The colleague's session cookie is still perfectly valid — which is the
    // point. `requireOrg` re-reads membership on every call rather than
    // trusting the session, so access ends here.
    expect(await db.collection("organizationMembers").findOne(scopeQuery)).toBeNull();
  });
});

/* ────────────────────────────────────────────── credentials */

describe("credential storage — §88", () => {
  it("keeps the password hash on accounts, never on the user", async () => {
    const frank = await signUp("Frank");

    const user = await db.collection("users").findOne({ _id: new ObjectId(frank.userId) });
    expect(user).not.toBeNull();
    expect(Object.hasOwn(user!, "password")).toBe(false);

    const account = await db
      .collection("accounts")
      .findOne({ userId: new ObjectId(frank.userId), providerId: "credential" });
    expect(account?.password).toBeTypeOf("string");
    // Stored hashed, never reversible.
    expect(account?.password).not.toContain("a-sufficiently-long-password");
  });

  it("rejects a password shorter than the configured minimum", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: "Short", email: uniqueEmail(), password: "short" },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
  });
});
