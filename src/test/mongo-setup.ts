import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

/**
 * One replica set for the whole run — ticket 28.
 *
 * ## What this replaces
 *
 * Every integration file started its **own** `MongoMemoryReplSet` in
 * `beforeAll` and stopped it in `afterAll`. Fifteen files, fifteen mongod
 * processes launched and torn down, each paying start-up and election. It is
 * also why `hookTimeout` had to be raised to 180s: teardown of four concurrent
 * mongods blew past the 10s default and failed files that had passed every
 * assertion, which reads as a broken test rather than a slow shutdown.
 *
 * One process, started once, with each suite pointed at **its own database
 * name** inside it. The suites already namespaced themselves that way
 * (`checkout_test`, `invoices_test`, …), so isolation is unchanged — it was
 * already per-database, not per-process.
 *
 * ## Why `globalSetup` and not a setup file
 *
 * A `setupFiles` entry runs once per *worker*, and Vitest runs several. That
 * would be four mongods instead of fifteen, which is better and still wrong.
 * `globalSetup` runs once for the entire run and hands the URI to the workers
 * through `provide`.
 *
 * ## The binary
 *
 * `mongodb-memory-server` downloads a mongod on first use and caches it in
 * `~/.cache/mongodb-binaries`. That download is why the launch timeout is
 * generous, and why CI caches that directory — a cold download on every PR is
 * minutes.
 */

declare module "vitest" {
  export interface ProvidedContext {
    /** Connection string for the shared replica set. */
    mongoUri: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;

export async function setup(project: TestProject): Promise<void> {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
    instanceOpts: [{ launchTimeout: 180_000 }],
  });

  project.provide("mongoUri", replSet.getUri());
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
  replSet = undefined;
}
