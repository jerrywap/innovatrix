/**
 * Make an empty database into a working platform, and give one person the keys.
 *
 *   npm run db:prod:bootstrap -- --admin you@yourdomain.com --name "Your Name"
 *   npm run db:prod:bootstrap -- --admin ops@yourdomain.com --roles finance,devops
 *   npm run db:prod:bootstrap -- --admin you@yourdomain.com --no-email
 *
 * ## This is not the seed, and the difference is the point
 *
 * `OPERATIONS.md` says the seed **never** runs against production, and that
 * `scripts/seed.ts` hard-codes its password precisely so a seed pointed at
 * production cannot create an account that looks real. This script is what that
 * rule leaves missing: the small amount of data a real deployment genuinely needs,
 * and nothing that pretends to be a customer.
 *
 * What it creates:
 *
 * - **Indexes**, because a dropped database has none and the app is unsafe without
 *   them — `syncIndexes` is the same call `db:indexes` makes.
 * - **Taxonomies**, from `TAXONOMY_VOCABULARY`. The same vocabulary the demo seed
 *   uses, because it is the catalogue's own structure rather than sample content.
 * - **One tax rule**: the zero-rated catch-all, and nothing else. See below.
 * - **The payment settings singleton**, with every provider off and bank transfer
 *   off. See below.
 * - **A staff account**, with no password, and an email inviting them to set one.
 *
 * What it deliberately does not create: products, customers, organisations,
 * orders, discount codes. A marketplace with no listings is an honest empty
 * marketplace; one with eleven fake listings is a lie with a price on it.
 *
 * ## Why only the catch-all tax rule
 *
 * The demo seed writes GB VAT at 20% and NG VAT at 7.5%. Those are plausible and
 * they are not this merchant's to assert: `validators/checkout.ts` already records
 * that "a tax rule applied to the wrong country is a compliance problem rather
 * than a cosmetic one". So the only rule seeded is the `*` fallback at zero, whose
 * own comment in the seed explains itself — "so an unconfigured country charges
 * nothing rather than guessing". Charging nothing is recoverable. Charging the
 * wrong VAT is not.
 *
 * ## Why no payment method is enabled
 *
 * The demo seed enables bank transfer and fills the instructions with
 * `sort code 00-00-00, account 00000000`. In production that is a screen telling a
 * customer to send money to an account that does not exist. Nothing is enabled
 * here, and the run prints that selling is impossible until somebody configures a
 * provider — which is a blocked checkout rather than a lost payment.
 *
 * ## Why the admin has no password
 *
 * Nothing here can leak a credential because there is no credential. The account
 * is created without one and Better Auth's reset email invites them to choose it;
 * `resetPassword` creates the `credential` account row when none exists, so the
 * first password and a changed password take the same path. It also means the run
 * proves production SMTP works, which is the other thing you want to find out
 * before shipping rather than after.
 *
 * Safe to run repeatedly. Every write is an upsert, and re-running is how you
 * resend an invitation that expired — the token lasts an hour.
 */
import "dotenv/config";
import mongoose from "mongoose";
import { TAXONOMY_VOCABULARY } from "./taxonomy-vocabulary";
import { syncAllIndexes } from "./sync-indexes";
import { STAFF_ROLES, type StaffRole } from "../src/lib/db/enums";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/**
 * Addresses that cannot receive real mail.
 *
 * The mirror image of the demo seed's guard. That one refuses to look real; this
 * one refuses to look fake — an admin account on a reserved domain can never
 * complete the invitation, so it would be an account nobody can sign in to,
 * holding every permission on the platform.
 */
const UNREACHABLE = /@(?:.+\.)?(?:test|example|invalid|localhost)$|@example\.(?:com|org|net)$/i;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");

  // Same resolution as `prod-reset.ts`, and for the same reason: never default the
  // database name, or a production URI can be silently overridden.
  const override = process.env.MONGODB_DB_NAME;
  await mongoose.connect(uri, override ? { dbName: override } : {});

  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connecting.");

  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb\+srv:/, "mongodb:")).host;
    } catch {
      return "unknown host";
    }
  })();

  console.log(`\nhost      ${host}`);
  console.log(`database  ${db.databaseName}\n`);

  const M = await import("../src/lib/db/models");
  const warnings: string[] = [];

  /* ── indexes ──────────────────────────────────────────── */

  if (has("skip-indexes")) {
    console.log("indexes   skipped");
  } else {
    console.log("syncing indexes…\n");
    await syncAllIndexes();
    console.log();
  }

  /* ── taxonomies ───────────────────────────────────────── */

  let taxonomies = 0;
  for (const term of TAXONOMY_VOCABULARY) {
    await M.Taxonomy.updateOne(
      { kind: term.kind, slug: taxonomySlug(term.name) },
      {
        $set: {
          name: term.name,
          sortOrder: term.sortOrder,
          isActive: true,
          catalogue: term.catalogue,
          ...(term.description ? { description: term.description } : {}),
        },
      },
      { upsert: true },
    );
    taxonomies += 1;
  }
  console.log(`taxonomies       ${taxonomies} upserted`);

  /* ── tax ──────────────────────────────────────────────── */

  /*
   * Keyed on "is there a catch-all", not on a `ruleId` of our choosing.
   *
   * Two `*` rules at the same priority is an ambiguous answer to "what tax applies
   * here", and matching on the id would have created exactly that against any
   * database already carrying one — the demo seed's is called
   * `rest-of-world-zero`. What matters is that a fallback exists, not that it is
   * ours.
   */
  const fallback = await M.TaxRule.countDocuments({ country: "*", isActive: true });
  if (fallback === 0) {
    await M.TaxRule.create({
      ruleId: "default-zero",
      label: "No tax configured",
      country: "*",
      // `any`, matching the demo seed's fallback: the catch-all must apply to every
      // kind of line, not only to digital goods.
      kind: "any",
      basisPoints: 0,
      // Lowest priority, so the first real country rule added beats it.
      priority: 0,
      isActive: true,
    });
  }
  const realRules = await M.TaxRule.countDocuments({ country: { $ne: "*" }, isActive: true });
  console.log(
    `tax rules        ${fallback === 0 ? "fallback created" : "fallback present"} (zero-rated)` +
      `${realRules ? ` · ${realRules} country ${realRules === 1 ? "rule" : "rules"}` : ""}`,
  );
  if (realRules === 0) {
    warnings.push(
      "No real tax rules exist, so every order is zero-rated. Add the rates you are " +
        "obliged to charge at /admin/settings/tax before you sell anything.",
    );
  }

  /* ── payments ─────────────────────────────────────────── */

  await M.PaymentSettings.updateOne(
    { singleton: "global" },
    {
      // `$setOnInsert` throughout: re-running must never switch off a provider a
      // real environment has configured, and must never overwrite real bank
      // details with the placeholder absence of them.
      $setOnInsert: {
        singleton: "global",
        providers: [
          { key: "stripe", enabled: false, mode: "live", secretEnvVar: "STRIPE_SECRET_KEY" },
          {
            key: "paystack",
            enabled: false,
            mode: "live",
            secretEnvVar: "PAYSTACK_SECRET_KEY",
          },
          { key: "paypal", enabled: false, mode: "live", secretEnvVar: "PAYPAL_CLIENT_SECRET" },
        ],
        currencyRouting: [],
        // Off, and with no instructions. The demo seed's placeholder sort code
        // would be a screen asking a customer to pay into a fictional account.
        offlineEnabled: false,
      },
    },
    { upsert: true },
  );

  const settings = await M.PaymentSettings.findOne({ singleton: "global" }).lean<{
    providers?: Array<{ key: string; enabled?: boolean }>;
    offlineEnabled?: boolean;
  }>();
  const live = (settings?.providers ?? [])
    .filter((provider) => provider.enabled)
    .map((p) => p.key);
  console.log(
    `payments         ${live.length ? `${live.join(", ")} enabled` : "no provider enabled"}` +
      `${settings?.offlineEnabled ? " · bank transfer on" : ""}`,
  );
  if (live.length === 0 && !settings?.offlineEnabled) {
    warnings.push(
      "No payment method is enabled, so nobody can check out. Configure a provider at " +
        "/admin/settings/payments — and if you turn bank transfer on, write your real " +
        "account details into the instructions.",
    );
  }

  /* ── the admin ────────────────────────────────────────── */

  const email = arg("admin")?.trim().toLowerCase();

  if (!email) {
    console.log("staff            none requested");
    warnings.push(
      "No staff account was created, so nobody can reach /admin or /staff. There is no " +
        "way to create one in the app — /admin/users is not built — so re-run this with " +
        "--admin you@yourdomain.com.",
    );
  } else {
    if (!email.includes("@") || UNREACHABLE.test(email)) {
      console.error(
        `\nRefusing to create "${email}".\n\n` +
          `That address cannot receive mail, so the invitation would never arrive and the\n` +
          `account could never be signed in to — while holding every permission on the\n` +
          `platform. Use a real address.\n`,
      );
      await mongoose.disconnect();
      process.exit(1);
    }

    const roles = parseRoles(arg("roles"));
    const name = arg("name") ?? email.split("@")[0]!;

    await M.User.updateOne(
      { email },
      {
        $set: {
          name,
          isStaff: true,
          /*
           * Verified on creation. The operator running this is asserting their own
           * address, and the invitation round trip proves they hold the inbox
           * before the account can be used at all — so a second verification email
           * would be a second hoop for a fact already established.
           */
          emailVerified: true,
          deletedAt: null,
        },
        $setOnInsert: { locale: "en-GB" },
      },
      { upsert: true },
    );

    const user = await M.User.findOne({ email })
      .select({ _id: 1 })
      .lean<{ _id: mongoose.Types.ObjectId }>();
    if (!user) throw new Error(`Could not read back the user for ${email}.`);

    await M.StaffProfile.updateOne(
      { userId: user._id },
      { $set: { roles, isActive: true, deletedAt: null } },
      { upsert: true },
    );

    const hasPassword = await M.Account.countDocuments({
      userId: user._id,
      providerId: "credential",
    });

    console.log(`staff            ${email} · ${roles.join(", ")}`);

    if (has("no-email")) {
      console.log(`invitation       skipped (--no-email)`);
      if (!hasPassword) {
        warnings.push(
          `${email} has no password and no invitation was sent. They cannot sign in until ` +
            `you re-run this without --no-email, or they use "forgot password" themselves.`,
        );
      }
    } else if (hasPassword) {
      console.log(`invitation       not needed — this account already has a password`);
    } else {
      const { getAuth } = await import("../src/lib/auth/auth");
      await getAuth().api.requestPasswordReset({
        body: { email, redirectTo: "/login" },
      });
      console.log(`invitation       sent to ${email} — the link lasts one hour`);
    }
  }

  /* ── summary ──────────────────────────────────────────── */

  if (warnings.length > 0) {
    console.log(`\nBefore you ship:\n`);
    for (const warning of warnings) {
      console.log(`  · ${wrap(warning)}\n`);
    }
  } else {
    console.log(`\nNothing outstanding.`);
  }

  await mongoose.disconnect();

  /*
   * Exit explicitly, because disconnecting mongoose is not enough to end this
   * process.
   *
   * `lib/auth/auth.ts` opens its **own** `MongoClient` — cached on `globalThis` so
   * a hot reload cannot race it — and this script has no handle on it. Sending the
   * invitation is what first constructs `getAuth()`, so a run that invites somebody
   * hangs after printing its summary while a run that does not exits cleanly. That
   * is a confusing way to find out, and an operator watching a production bootstrap
   * apparently stall is going to reach for Ctrl-C at the worst moment.
   */
  process.exit(0);
}

/**
 * The slug a taxonomy term gets.
 *
 * Duplicated from `seed.ts` on purpose rather than shared: the two must agree, and
 * the way to make them agree is one function. That refactor touches the demo seed,
 * which is 1,000 lines and not what this ticket is about — so this is the copy,
 * and it is marked as one. If they ever disagree the symptom is duplicate
 * taxonomies with the same name, which `db:docs` and the filter rail both show.
 */
function taxonomySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * `--roles finance,devops`, defaulting to the one role that can do everything.
 *
 * `super_admin` by default because the first account has to be able to grant the
 * others, and there is no screen for that yet — but named roles are accepted so a
 * second, narrower account does not have to hold the whole platform.
 */
function parseRoles(raw: string | undefined): StaffRole[] {
  if (!raw) return ["super_admin"];

  const wanted = raw
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  const unknown = wanted.filter((role) => !(STAFF_ROLES as readonly string[]).includes(role));

  if (unknown.length > 0) {
    throw new Error(
      `Unknown staff ${unknown.length === 1 ? "role" : "roles"}: ${unknown.join(", ")}.\n` +
        `Available: ${STAFF_ROLES.join(", ")}`,
    );
  }

  return wanted as StaffRole[];
}

/** Wrap a warning at 84 columns so a terminal does not reflow it into a wall. */
function wrap(text: string): string {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if ((line + word).length > 84) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += `${word} `;
  }
  lines.push(line.trimEnd());
  return lines.join("\n    ");
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
