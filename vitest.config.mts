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
       * The thresholds are set at roughly where the suite is today rather than
       * at an aspiration — a floor that already fails is a floor everybody
       * passes `--coverage=false` around, and then it protects nothing. Raise
       * them when a batch of tests lands, not before.
       */
      include: ["src/lib/**", "src/services/**", "src/config/**"],
      exclude: ["**/*.test.ts", "**/*.d.ts", "src/lib/db/models/**"],
      thresholds: { lines: 55, functions: 60, branches: 70, statements: 55 },
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
        },
        resolve: { alias: shared.alias },
      },
    ],
  },
});
