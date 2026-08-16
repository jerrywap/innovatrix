import "server-only";
import type { JobDefinition, JobHandler, JobName } from "./types";

/**
 * Where handlers live.
 *
 * Global-stashed for the same reason the event bus is: module scope is
 * re-created on every hot reload, so a registry held there would either be
 * empty when the worker looked or would double-register on the second pass.
 */

declare global {
  var __innovatrixJobRegistry: Map<string, JobDefinition> | undefined;
}

function registry(): Map<string, JobDefinition> {
  return (globalThis.__innovatrixJobRegistry ??= new Map());
}

export interface DefineJobOptions {
  maxAttempts?: number;
  backoffMs?: number;
  backoffCapMs?: number;
}

export function defineJob<K extends JobName>(
  name: K,
  handler: JobHandler<K>,
  options: DefineJobOptions = {},
): void {
  registry().set(name, {
    name,
    handler: handler as JobHandler<JobName>,
    maxAttempts: options.maxAttempts ?? 5,
    backoffMs: options.backoffMs ?? 10_000,
    backoffCapMs: options.backoffCapMs ?? 3_600_000,
  });
}

export function definitionFor(name: string): JobDefinition | undefined {
  return registry().get(name);
}

export function registeredJobs(): JobDefinition[] {
  return [...registry().values()];
}

/** Tests only. */
export function resetJobRegistry(): void {
  globalThis.__innovatrixJobRegistry = new Map();
}
