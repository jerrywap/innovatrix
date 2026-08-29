import "server-only";
import { aiConfigured } from "@/services/ai/client";
import { resolveAiConfig } from "@/services/ai/settings";

/**
 * Whether the wizard should offer writing help, and what to say when it should
 * not.
 *
 * Both checks, in the order every other entry point makes them: `aiConfigured()`
 * is a pure env read, `resolveAiConfig()` is a query. Returning a *sentence*
 * rather than a boolean is deliberate — a control that disappears when a feature
 * is off teaches nobody anything, and "switched off" and "not set up" are
 * different things to whoever has to fix it.
 *
 * `undefined` means available, so the prop reads as `aiUnavailable` at every call
 * site and the common case passes nothing.
 */
export async function aiUnavailableReason(): Promise<string | undefined> {
  if (!aiConfigured()) return "Writing help isn't set up.";

  const config = await resolveAiConfig();
  if (!config.enabled) return "Writing help is switched off.";

  return undefined;
}
