import "server-only";
import { ObjectId, type Db } from "mongodb";

/**
 * The organization every customer gets, and the slug it is reachable by.
 *
 * ## Why this exists separately from `registerAction`
 *
 * §76 says every customer resource belongs to an organization, so a solo
 * customer gets one at signup. `registerAction` does that for the email path,
 * through `getAuth().api.createOrganization` — which it can, because it has an
 * authenticated request to hand it and a form field for the company name.
 *
 * **Google has neither.** OAuth completes inside Better Auth's own
 * `/api/auth/callback/google`; no action of ours runs, there is no form, and the
 * one hook positioned to notice — `session.create.before` — has a raw `Db` and
 * no headers. So the social path writes the two documents itself, and this
 * module is that writing, kept out of `auth.ts` so the slug rules have one home
 * rather than two.
 *
 * ## Mongoose defaults do not fire here
 *
 * Same reason `additionalFields` exists in `auth.ts`: these go in through the
 * raw driver, so every field the app later filters on is written explicitly.
 * `timestamps: true` on the schema means `createdAt` and `updatedAt` are the
 * app's job too — and `createdAt` is load-bearing, because the session hook
 * picks the *oldest* membership as the default landing context.
 */

/** The slug body: lowercase, ASCII-ish, hyphenated, never empty. */
export function slugBase(name: string): string {
  return (
    name
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "workspace"
  );
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Slugs are unique (§76) and public — they appear in URLs — so they are derived
 * from the name but never *are* the name.
 *
 * A short random suffix on collision rather than an incrementing counter:
 * `acme-2` tells the world Acme was taken, and a counter needs a read-then-write
 * that races under concurrent signups.
 *
 * The `isTaken` callback is what lets the two callers share this: `registerAction`
 * asks Mongoose, the social path asks the raw driver it already holds.
 */
export async function uniqueSlug(
  name: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugBase(name);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  return `${base}-${randomSuffix()}${randomSuffix()}`;
}

/** What a personal organization is called when nobody typed a company name. */
export function personalOrganizationName(userName: string | undefined): string {
  const trimmed = userName?.trim();
  return trimmed ? `${trimmed}'s workspace` : "My workspace";
}

/**
 * Create the personal organization for a user who has none, and return its id.
 *
 * Writes both documents — the organization and the owner membership — because
 * an organization without a membership grants nobody anything, and `requireOrg`
 * reads the membership rather than the organization.
 */
export async function createPersonalOrganization(
  db: Db,
  input: { userId: ObjectId; userName?: string },
): Promise<string> {
  const now = new Date();
  const name = personalOrganizationName(input.userName);

  const slug = await uniqueSlug(
    name,
    async (candidate) =>
      (await db.collection("organizations").countDocuments({ slug: candidate }, { limit: 1 })) >
      0,
  );

  const organization = await db.collection("organizations").insertOne({
    name,
    slug,
    // Mirrors the Mongoose defaults and Better Auth's `additionalFields`. A
    // missing field is not `false` or `null` to a MongoDB filter.
    defaultCurrency: "GBP",
    isPersonal: true,
    customerSince: now,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.collection("organizationMembers").insertOne({
    organizationId: organization.insertedId,
    userId: input.userId,
    // `creatorRole` in the organization plugin's config; the same thing, said
    // where the plugin cannot say it for us.
    role: "owner",
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  return String(organization.insertedId);
}

/**
 * Give an organization to somebody already signed in who has none.
 *
 * ## Why this is not `activeOrganizationForSession`
 *
 * That one runs at session creation and is deliberately narrow: it only acts for
 * a social signup, because firing for an email signup would race
 * `registerAction` and produce two organizations. It also cannot help anyone who
 * is **already holding a session** — a stuck Google user whose session row was
 * written with `activeOrganizationId: null` keeps it until they sign out or it
 * expires, up to `AUTH_SESSION_DAYS`.
 *
 * This one is the deliberate version, and it can afford to be broader for two
 * reasons. It is reachable only from the dashboard's "your account isn't set up
 * yet" screen — which nobody sees unless they already have no membership — and
 * it is a **POST**, so no prefetch, crawl or hover can trigger it. That is the
 * whole reason it is a button and not a repair-on-render: a GET that creates an
 * organization would be fired by Next prefetching a link to `/dashboard`.
 *
 * So it covers the three stuck cases the narrow version leaves behind:
 *
 * - a social signup with a live session,
 * - **credential only** — `registerAction` failed after `signUpEmail`, so the
 *   user exists and nothing will ever make them an organization,
 * - **no account row at all** — a callback that died between two writes, which
 *   the session hook cannot even recognise as a social signup.
 *
 * Staff are still excluded: they correctly have no organization, and the
 * dashboard layout sends them to `/staff` before this screen renders.
 *
 * Idempotent — an existing membership is returned rather than added to — so a
 * double click costs a query and changes nothing. Two *simultaneous* clicks
 * could still both find nothing and create one each; the button disables while
 * pending, and the cost is a spare empty workspace rather than anything unsafe.
 */
export async function repairMissingOrganization(
  db: Db,
  userId: ObjectId,
): Promise<string | null> {
  const membership = await db
    .collection("organizationMembers")
    .findOne({ userId }, { sort: { createdAt: 1 }, projection: { organizationId: 1 } });

  if (membership) return String(membership.organizationId);

  const user = await db
    .collection("users")
    .findOne({ _id: userId }, { projection: { name: 1, isStaff: 1 } });

  if (!user) return null;
  if (user.isStaff === true) return null;

  return createPersonalOrganization(db, {
    userId,
    userName: typeof user.name === "string" ? user.name : undefined,
  });
}

/**
 * What `activeOrganizationId` should be for a session about to be created — and
 * the side effect of creating one, for the single case where nothing else will.
 *
 * `auth.ts` calls this from `databaseHooks.session.create.before`; the
 * integration harness calls it from its own copy of that hook. It lives here so
 * those two exercise the same code — that harness mirrors `auth.ts` by hand, and
 * a branch tested only in the mirror is a branch not tested at all.
 *
 * Three outcomes:
 *
 * - **A membership already exists** → its organization, oldest first. Every
 *   ordinary sign-in, and one indexed query.
 * - **No membership, and a social account** → a first-time Google signup, which
 *   no server action of ours will ever reach. Create the organization now, while
 *   the session row is still unwritten, so the id below is baked into the signed
 *   session cookie rather than corrected 60 seconds later.
 * - **No membership, no social account** → leave it. That is either an email
 *   signup whose `registerAction` is about to create one from the form's company
 *   name, or a staff account that correctly has none.
 *
 * ## Failure is not fatal
 *
 * A signup that cannot be given an organization is broken, but refusing the
 * *session* makes it worse: the user and the Google link already exist, so
 * throwing here leaves somebody unable to sign in to an account that does exist,
 * with nothing to retry. `null` lands them on the dashboard's "isn't set up yet"
 * screen instead — where they landed before any of this, and recoverable by
 * hand. Logged rather than swallowed, because a *persistent* failure looks
 * exactly like the original bug.
 */
export async function activeOrganizationForSession(
  db: Db,
  userId: ObjectId,
): Promise<string | null> {
  const membership = await db.collection("organizationMembers").findOne(
    { userId },
    // Oldest membership wins: that is the personal organization created at
    // signup, which is the sane default landing context.
    { sort: { createdAt: 1 }, projection: { organizationId: 1 } },
  );

  if (membership) return String(membership.organizationId);

  try {
    const social = await db
      .collection("accounts")
      .findOne({ userId, providerId: { $ne: "credential" } }, { projection: { _id: 1 } });

    if (!social) return null;

    const user = await db
      .collection("users")
      .findOne({ _id: userId }, { projection: { name: 1 } });

    return await createPersonalOrganization(db, {
      userId,
      userName: typeof user?.name === "string" ? user.name : undefined,
    });
  } catch (error) {
    console.error(
      "[auth] social signup could not be given an organization:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
