/**
 * Drop a database, so a bootstrap can build it again from nothing.
 *
 *   npm run db:prod:reset                        # dry run — prints what would go
 *   npm run db:prod:reset -- --drop innovatrix   # actually drops, name must match
 *
 * ## Why a drop rather than a targeted purge
 *
 * The UAT database is a copy of a development one, and its demo data has no
 * provenance field. Products in particular carry nothing but a `picsum.photos`
 * image URL to distinguish a thousand generated listings from a real one — so a
 * marker-based purge would be a list of guesses, and the failure mode is the bad
 * one: a demo row nobody spotted, surviving into production, in front of a
 * customer. Dropping cannot leave anything behind.
 *
 * The cost is that reference data goes too — taxonomies, tax rules, the payment
 * singleton, the reference counters. `prod-bootstrap.ts` rebuilds all of it from
 * `TAXONOMY_VOCABULARY`, which is the source those rows were generated from
 * anyway, so nothing is lost that was not derived.
 *
 * ## The guard is the database name, typed back
 *
 * Not a `--force` flag. A flag protects against a stray keystroke and not at all
 * against the mistake that actually happens, which is running the right command
 * against the wrong `MONGODB_URI`. Naming the database means the operator has to
 * have read what they are connected to.
 *
 * Dry run is the default for the same reason: the first thing anybody does with an
 * unfamiliar destructive script is run it.
 */
import "dotenv/config";
import mongoose from "mongoose";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set.");

  /*
   * `MONGODB_DB_NAME` when it is set, and otherwise whatever the URI names —
   * deliberately **not** defaulting to "innovatrix" the way the older scripts do.
   * A production URI ending `/cosetup_prod` with no `MONGODB_DB_NAME` would, under
   * that default, connect to a database called "innovatrix" instead. Harmless when
   * you are creating indexes. Not harmless here.
   */
  const override = process.env.MONGODB_DB_NAME;
  await mongoose.connect(uri, override ? { dbName: override } : {});
  const db = mongoose.connection.db;
  if (!db) throw new Error("No database handle after connecting.");

  const name = db.databaseName;
  const host = (() => {
    try {
      return new URL(uri.replace(/^mongodb\+srv:/, "mongodb:")).host;
    } catch {
      return "unknown host";
    }
  })();

  const collections = await db.listCollections().toArray();
  const counts = await Promise.all(
    collections
      .map((collection) => collection.name)
      .sort()
      .map(async (collection) => ({
        collection,
        rows: await db.collection(collection).countDocuments(),
      })),
  );
  const total = counts.reduce((sum, row) => sum + row.rows, 0);

  console.log(`\nhost      ${host}`);
  console.log(`database  ${name}`);
  console.log(`contents  ${collections.length} collections · ${total} documents\n`);

  for (const row of counts.filter((row) => row.rows > 0)) {
    console.log(`  ${row.collection.padEnd(26)} ${String(row.rows).padStart(6)}`);
  }

  const confirmed = arg("drop");

  if (!confirmed) {
    console.log(
      `\nDRY RUN — nothing was touched.\n\n` +
        `To drop all of the above, name the database:\n\n` +
        `  npm run db:prod:reset -- --drop ${name}\n\n` +
        `Then rebuild it:\n\n` +
        `  npm run db:prod:bootstrap -- --admin you@yourdomain.com\n`,
    );
    await mongoose.disconnect();
    return;
  }

  if (confirmed !== name) {
    console.error(
      `\nRefusing to drop.\n\n` +
        `  you asked to drop : ${confirmed}\n` +
        `  you are connected : ${name}\n\n` +
        `These differ, which is exactly the mistake this check exists for. Check your\n` +
        `MONGODB_URI before trying again.\n`,
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  await db.dropDatabase();
  console.log(`\nDropped "${name}" — ${total} documents in ${collections.length} collections.`);
  console.log(
    `\nThe database is now empty, with no indexes. Nothing works until you run:\n\n` +
      `  npm run db:prod:bootstrap -- --admin you@yourdomain.com\n`,
  );

  await mongoose.disconnect();
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
