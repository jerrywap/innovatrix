import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * Two projects: `unit` and `integration` — ticket 28.
 *
 * ## Why they are split
 *
 * The 33 unit tests run in about a second and the 15 integration files spend
 * most of their time on a database. Together in one run they are one number
 * that takes minutes, so nobody runs them while working, so the fast feedback
 * the unit tests exist to give is never actually received.
 *
 * Split, `npm run test:unit` is a second and CI can gate a PR on it before
 * paying for the slow half.
 *
 * ## One replica set, not fifteen
 *
 * `globalSetup` starts a single `MongoMemoryReplSet` for the whole run and
 * hands the URI to every suite through `inject("mongoUri")`. Each suite still
 * uses its own **database name** inside it, which is how they were already
 * isolated — the per-file replica set was never what kept them apart.
 */
const shared = {
  environment: "node" as const,
  alias: {
    "@": fileURLToPath(new URL("./src", import.meta.url)),
    // `server-only` throws on import outside an RSC graph. Vitest runs in
    // plain Node, so point it at the package's own no-op entry — the same
    // file the "react-server" condition resolves to.
    "server-only": fileURLToPath(
      new URL("./node_modules/server-only/empty.js", import.meta.url),
    ),
  },
};

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      /**
       * §19.5: a floor on the code that holds business rules, not a global
       * number that rewards testing trivia.
       *
       * ## The numbers are measured, not chosen
       *
       * The first attempt set them at what felt right — 55/60/70/55 — and the
       * run reported 60.22 / 53.11 / 57.71 / 61.99, so two of the four failed
       * on a suite that had just gone green. A floor that fails on day one is a
       * floor everybody learns to pass `--coverage=false` around, and then it
       * protects nothing at all.
       *
       * These sit two or three points below where the suite actually is: a
       * regression fails, today passes. Raise them when a batch of tests lands,
       * not in anticipation of one.
       *
       * `**` on the include patterns rather than a bare directory — the default
       * matched `ERD.md`, `STATES.md`, `INTEGRITY.md` and `DECISION.md`, and V8
       * printed four `PARSE_ERROR` stack traces per run trying to instrument
       * Markdown.
       */
      include: ["src/lib/**/*.ts", "src/services/**/*.ts", "src/config/**/*.ts"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "src/lib/db/models/**"],
      thresholds: { lines: 59, functions: 55, branches: 50, statements: 57 },
    },

    projects: [
      {
        test: {
          ...shared,
          name: "unit",
          // Everything that is not an integration test. These touch no
          // database, no network and no filesystem beyond reading source.
          include: ["src/**/*.{test,spec}.{ts,tsx}"],
          exclude: ["src/**/*.integration.test.ts"],
        },
        resolve: { alias: shared.alias },
      },
      {
        test: {
          ...shared,
          name: "integration",
          include: ["src/**/*.integration.test.ts"],
          globalSetup: ["./src/test/mongo-setup.ts"],
          /**
           * Still generous, and for a different reason than before.
           *
           * It used to cover starting *and stopping* a mongod per file. Now the
           * replica set is started once in `globalSetup`, and this covers a
           * suite's own `beforeAll`: connecting, syncing indexes, and the cold
           * transform of a service module graph, which for the payment
           * provider registry is measured in tens of seconds on a cold cache.
           */
          hookTimeout: 180_000,

          /**
           * The trade the shared replica set makes, paid for here.
           *
           * Fifteen mongods cost process overhead and gave every suite its own
           * uncontended server. One mongod removes that overhead and puts every
           * suite's queries through the same instance while Vitest runs the
           * files in parallel — so an individual operation is slower under load
           * even though the run as a whole is faster.
           *
           * At the 5s default that surfaced as four timeouts in *different*
           * tests on each run, which is the signature of contention rather than
           * of a slow test. 30s is far above anything these do and still fails
           * fast on a genuine hang.
           */
          testTimeout: 30_000,
        },
        resolve: { alias: shared.alias },
      },
    ],
  },
});
