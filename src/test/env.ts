/**
 * A minimal valid server environment, for tests.
 *
 * `src/config/env.ts` validates the whole environment at once and fails with
 * every missing variable named — which is the right behaviour at boot and an
 * awkward one in a unit test, because a module that reads a single variable
 * still needs all of them present.
 *
 * So this is the one definition of "enough environment to boot", shared rather
 * than copied into each test that needs it. A test asserting something about
 * one variable overrides just that variable.
 *
 * Not a `.test.ts` file, so vitest treats it as a plain module rather than a
 * suite with no assertions.
 */
export const VALID_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: "development",
  APP_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://localhost:27017/innovatrix?replicaSet=rs0",
  MONGODB_DB_NAME: "innovatrix",
  AUTH_SECRET: "x".repeat(32),
  STORAGE_BUCKET: "innovatrix-dev",
  STORAGE_ACCESS_KEY_ID: "key",
  STORAGE_SECRET_ACCESS_KEY: "secret",
  ENCRYPTION_KEY: "a".repeat(64),
};

/** A fresh mutable copy — callers routinely delete a key to assert it's required. */
export function validEnv(overrides: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...VALID_ENV };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}
