"use client";

import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createProductAction, enhanceProseAction } from "../actions";
import type { ActionResult } from "@/lib/action-result";
import { FormErrors } from "./section-form";
import { RichTextEditor, type RichTextHandle } from "./rich-text-editor";
import { EnhanceButton } from "./enhance-button";
import { CompareProseDialog } from "./compare-dialog";

/**
 * The create form — name, summary, and optionally the description.
 *
 * Deliberately short. The wizard's promise is that work is never lost, and the
 * way to keep it is to get a draft into the database as early as possible.
 * Asking for pricing and media here would mean an administrator who gets
 * interrupted after ten minutes has nothing saved.
 *
 * The slug is derived from the name and is not asked for. Changing it later is
 * its own action, because it retires the old address into `slugHistory` and
 * that is a different kind of decision from fixing a typo in a title.
 */
/**
 * `action` is a prop so this serves both wizard surfaces — vendor ticket 04.
 *
 * Defaulted to the staff action. The vendor variant stamps ownership from the
 * session, which is why creation is a *different action* rather than this form
 * gaining a vendor field: a `vendorId` in a request body is a claim about whose
 * catalogue a product joins.
 */
export function NewProductForm({
  action = createProductAction,
  enhance = enhanceProseAction,
  aiUnavailable,
}: {
  action?: (
    previous: ActionResult<never> | null,
    formData: FormData,
  ) => Promise<ActionResult<never>>;
  /** The surface's own rewrite action — the staff one refuses a vendor. */
  enhance?: typeof enhanceProseAction;
  aiUnavailable?: string;
} = {}) {
  const [state, formAction] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;

  /*
   * There is no product yet, so the rewrite works entirely on what has been
   * typed. That is the reason `enhanceProseAction` takes no product id: one
   * action serves this screen and the basics step of a saved draft.
   */
  const formRef = useRef<HTMLFormElement>(null);
  const descriptionRef = useRef<RichTextHandle>(null);
  const [summary, setSummary] = useState("");
  const [compare, setCompare] = useState<null | {
    field: "summary" | "description";
    mine: string;
    suggested: string;
  }>(null);

  const nameValue = () => {
    const element = formRef.current?.elements.namedItem("name");
    return element instanceof HTMLInputElement ? element.value : "";
  };

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-6">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Name</span>
        <Input
          name="name"
          required
          minLength={2}
          maxLength={120}
          placeholder="Atlas CRM"
          autoFocus
        />
        <span className="text-subtle text-[12.5px]">
          The web address is made from this. You can change it later.
        </span>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[13px] font-medium">Summary</span>
          <EnhanceButton
            label="Enhance summary"
            {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
            run={() =>
              enhance({
                field: "summary",
                text: summary,
                name: nameValue(),
                description: descriptionRef.current?.getHTML() ?? "",
              })
            }
            onResult={({ text }) =>
              setCompare({ field: "summary", mine: summary, suggested: text })
            }
          />
        </span>
        {/* Controlled, so the rewrite can replace it — see `BasicsForm`. */}
        <Textarea
          name="summary"
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          required
          minLength={10}
          maxLength={300}
          rows={2}
          placeholder="A CRM for property managers, with tenancy tracking and automated rent reminders."
        />
        <span className="text-subtle text-[12.5px]">
          One line. It appears on every marketplace card, so write it for someone skimming.
        </span>
      </label>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-[13px] font-medium">
            Description <span className="text-subtle font-normal">(optional)</span>
          </span>
          <EnhanceButton
            label="Enhance description"
            {...(aiUnavailable ? { disabledReason: aiUnavailable } : {})}
            run={() =>
              enhance({
                field: "description",
                text: descriptionRef.current?.getHTML() ?? "",
                name: nameValue(),
                summary,
              })
            }
            onResult={({ text }) =>
              setCompare({
                field: "description",
                mine: descriptionRef.current?.getHTML() ?? "",
                suggested: text,
              })
            }
          />
        </div>
        <RichTextEditor name="description" handleRef={descriptionRef} />
        <span className="text-subtle text-[12.5px]">
          Needed before publishing, but not to save a draft.
        </span>
      </div>

      <div className="border-border flex items-center gap-2 border-t pt-5">
        <CreateButton />
      </div>

      {/*
        Inside the `<form>` in the React tree and outside it in the DOM —
        `DialogContent` portals to `document.body`. Harmless here, and the reason
        accepting writes through `setSummary` / `setHTML` rather than through an
        input rendered in the dialog.
      */}
      {compare && (
        <CompareProseDialog
          open
          onOpenChange={(next) => !next && setCompare(null)}
          title={compare.field === "summary" ? "Suggested summary" : "Suggested description"}
          mine={compare.mine}
          suggested={compare.suggested}
          // The description is HTML both ways; the summary is a plain sentence.
          rich={compare.field === "description"}
          onMineChange={(mine) => setCompare({ ...compare, mine })}
          onSuggestedChange={(suggested) => setCompare({ ...compare, suggested })}
          onAccept={(value) => {
            if (compare.field === "summary") setSummary(value);
            else descriptionRef.current?.setHTML(value);
            setCompare(null);
          }}
        />
      )}
    </form>
  );
}

function CreateButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create draft"}
    </Button>
  );
}
