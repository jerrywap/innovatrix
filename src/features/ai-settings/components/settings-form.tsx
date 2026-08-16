"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, CircleX, Loader2, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { saveAiSettingsAction } from "../actions";
import type { AiSettingsView } from "../settings-view";

/**
 * `/admin/settings/ai` — §104.
 *
 * ## The model list says which models can extract
 *
 * Requirement extraction needs structured output. Choosing a model without it
 * leaves the interview working and the summary step failing, with nothing on
 * screen having warned anyone. So the capability is rendered next to the price,
 * and the current selection is called out if it cannot.
 *
 * ## There is no field here for the API key
 *
 * Only a tick or a cross for whether `OPENROUTER_API_KEY` is set in the
 * environment. Same rule as the payments screen: a credential in a settings
 * table is a credential in every backup.
 */
export function AiSettingsForm({ view }: { view: AiSettingsView }) {
  const [state, action] = useActionState(saveAiSettingsAction, null);

  return (
    <form action={action} className="flex flex-col gap-6">
      {/* ── key presence, read-only ─────────────────────────── */}
      <section className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Credentials</h2>
        <p className="flex items-center gap-2 text-[13px]">
          {view.keyPresent ? (
            <CircleCheck
              className="size-4 text-emerald-600 dark:text-emerald-400"
              aria-hidden
            />
          ) : (
            <CircleX className="size-4 text-[var(--danger)]" aria-hidden />
          )}
          <code className="font-mono text-[12.5px]">{view.keyEnvVar}</code>
          <span className="text-muted-foreground">
            {view.keyPresent
              ? "is set in the environment"
              : "is not set — the assistant is off"}
          </span>
        </p>
        <p className="text-subtle text-[12px]">
          Keys are read from the environment and never stored here.
        </p>
      </section>

      {/* ── warnings ─────────────────────────────────────────── */}
      {view.extractionWarning && <Notice tone="danger">{view.extractionWarning}</Notice>}
      {view.unknownModels.length > 0 && (
        <Notice tone="danger">
          OpenRouter no longer offers {view.unknownModels.join(", ")}. Conversations using it
          will fail until this is changed.
        </Notice>
      )}
      {!view.catalogueAvailable && (
        <Notice tone="warning">
          OpenRouter&rsquo;s model list couldn&rsquo;t be loaded, so prices and capabilities
          aren&rsquo;t shown and a model id can&rsquo;t be checked before saving.
        </Notice>
      )}
      {state?.ok === false && <Notice tone="danger">{state.error}</Notice>}
      {state?.ok && <Notice tone="ok">Saved.</Notice>}

      {/* ── the settings ─────────────────────────────────────── */}
      <section className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4">
        <label className="flex items-center gap-2.5 text-[13.5px]">
          <Checkbox name="enabled" value="on" defaultChecked={view.enabled} />
          <span>
            Assistants are switched on
            <span className="text-subtle block text-[12px]">
              Off means every customer gets the manual form instead. Nothing breaks.
            </span>
          </span>
        </label>

        <Field
          label="Conversation model"
          hint="Used for interview turns. Cheaper and faster matters more here than raw reasoning."
        >
          <ModelSelect name="model" value={view.model} models={view.models} />
        </Field>

        <Field
          label="Extraction model"
          hint="Turns a conversation into requirements. Must support structured output. Leave blank to use the conversation model."
        >
          <ModelSelect
            name="extractionModel"
            value={view.extractionModel === view.model ? "" : view.extractionModel}
            models={view.models.filter((model) => model.supportsStructuredOutput)}
            allowBlank
          />
        </Field>

        <Field
          label="Fallbacks"
          hint="Tried in order if the model above fails. One per line — this is what keeps the assistant working during a provider outage."
        >
          <textarea
            name="fallbackModels"
            defaultValue={view.fallbackModels.join("\n")}
            rows={3}
            className="border-border bg-background w-full rounded-lg border px-3 py-2 font-mono text-[12.5px]"
            placeholder="anthropic/claude-sonnet-5"
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Temperature"
            hint="0 is repetitive; above 1 wanders. 0.4 suits an interview."
          >
            <Input
              name="temperature"
              type="number"
              step="0.1"
              min="0"
              max="2"
              defaultValue={view.temperature}
            />
          </Field>
          <Field
            label="Maximum response length"
            hint="Tokens. Reasoning models need headroom — too low and they think without answering."
          >
            <Input
              name="maxOutputTokens"
              type="number"
              min="128"
              max="32000"
              defaultValue={view.maxOutputTokens}
            />
          </Field>
        </div>

        <p className="text-subtle text-[12px]">
          Currently reading from{" "}
          <strong className="font-medium">
            {view.source === "database"
              ? "these settings"
              : `the environment (${view.envModel})`}
          </strong>
          . Saving here takes over.
        </p>

        <Submit />
      </section>
    </form>
  );
}

function ModelSelect({
  name,
  value,
  models,
  allowBlank,
}: {
  name: string;
  value: string;
  models: AiSettingsView["models"];
  allowBlank?: boolean;
}) {
  // A free-text input when the catalogue is unreachable, so an outage of
  // OpenRouter's `/models` cannot lock an administrator out of changing model —
  // which would be exactly the wrong moment for that.
  if (models.length === 0) {
    return <Input name={name} defaultValue={value} className="font-mono text-[12.5px]" />;
  }

  return (
    <select
      name={name}
      defaultValue={value}
      className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
    >
      {allowBlank && <option value="">Same as the conversation model</option>}
      {models.map((model) => (
        <option key={model.id} value={model.id}>
          {model.id}
          {" — "}
          {money(model.promptMicrosPerToken)}/{money(model.completionMicrosPerToken)} per M
          {model.supportsStructuredOutput ? " · can extract" : " · cannot extract"}
        </option>
      ))}
    </select>
  );
}

/** Micros per token → dollars per million, which is how models are priced. */
function money(microsPerToken: number): string {
  return `$${microsPerToken.toFixed(microsPerToken < 1 ? 3 : 2)}`;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13.5px] font-medium">{label}</span>
      {hint && <span className="text-subtle text-[12px]">{hint}</span>}
      {children}
    </label>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "ok" | "warning" | "danger";
  children: React.ReactNode;
}) {
  const styles = {
    ok: "border-emerald-500/30 bg-emerald-500/10",
    warning: "border-amber-500/30 bg-amber-500/10",
    danger: "border-[var(--danger)]/40 bg-[var(--danger)]/5",
  }[tone];

  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 text-[13px] ${styles}`}
    >
      {tone === "ok" ? (
        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden />
      ) : (
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
      )}
      <span>{children}</span>
    </p>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save
    </Button>
  );
}
