"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Field, FieldGroup, SectionForm, type SectionFormProps } from "./section-form";
import { saveOptionsAction } from "../actions";
import { CUSTOMIZATION_AREAS } from "@/lib/db/enums";
import type { AdminProductView } from "@/services/catalog/product-view";

const AREA_LABELS: Record<string, string> = {
  branding: "Branding",
  user_roles: "User roles",
  reports: "Reports",
  payment_methods: "Payment methods",
  workflows: "Workflows",
  integrations: "Integrations",
  notifications: "Notifications",
  dashboard: "Dashboard",
};

/**
 * Installation and customization — §48, §50.
 *
 * ## The suggested areas are structured, and that is the point
 *
 * §50 says these "can help guide the AI assistant", and ticket 17's assistant
 * opens its conversation with them: *"would you like the branding changed?"*
 * Free prose would make that a parsing problem, so they are an enum. The
 * Mongoose field stays a permissive `[String]` so adding an area later cannot
 * invalidate a stored document — the constraint lives in the Zod schema, where
 * it can be relaxed for one release.
 *
 * The switches gate real behaviour rather than decorating: turning
 * customization off hides "Request Customization" on the product page **and**
 * makes the corresponding action refuse (ticket 09's acceptance criterion).
 *
 * `action` is a prop so this form serves both wizard surfaces — vendor ticket 04.
 * Defaulted to the staff action, so every existing caller is unchanged and the
 * vendor pages pass their own. A second copy of the form per surface is how one of
 * them quietly stops having a field the other has.
 */
export function OptionsForm({
  product,
  nextHref,
  action = saveOptionsAction,
}: {
  product: AdminProductView;
  nextHref: string;
  action?: SectionFormProps["action"];
}) {
  const chosen = new Set(product.customization.suggestedAreas);

  return (
    <SectionForm action={action} productId={product.id} nextHref={nextHref}>
      <FieldGroup title="Installation" description="How a customer can get this running.">
        <div className="flex flex-col gap-2">
          <ToggleRow
            name="installation[selfInstall]"
            label="Self-install"
            hint="They download it and install it themselves."
            defaultChecked={product.installation.selfInstall}
          />
          <ToggleRow
            name="installation[innovatrixInstall]"
            label="We install it"
            hint="Sold as an add-on on the pricing step."
            defaultChecked={product.installation.innovatrixInstall}
          />
          <ToggleRow
            name="installation[managedHosting]"
            label="Managed hosting"
            hint="We host and run it for them."
            defaultChecked={product.installation.managedHosting}
          />
        </div>
      </FieldGroup>

      <FieldGroup
        title="Customization"
        description="Whether this product can be adapted, and what the assistant should offer."
      >
        <div className="flex flex-col gap-2">
          <ToggleRow
            name="customization[available]"
            label="Can be customised"
            hint="Shows 'Request Customization' on the product page. Off means the action refuses too, not just that the button is hidden."
            defaultChecked={product.customization.available}
          />
          <ToggleRow
            name="customization[aiWorkflowEnabled]"
            label="Use the AI assistant"
            hint="Off sends the customer straight to a human."
            defaultChecked={product.customization.aiWorkflowEnabled}
          />
          <ToggleRow
            name="customization[technicalReviewRequired]"
            label="Needs technical review"
            hint="A quote for this product cannot be issued without an analyst looking."
            defaultChecked={product.customization.technicalReviewRequired}
          />
        </div>

        <Field
          label="Typical turnaround"
          htmlFor="turnaround"
          hint="Shown as a rough expectation, e.g. “2–3 weeks”. Not a commitment."
        >
          <Input
            id="turnaround"
            name="customization[typicalTurnaround]"
            defaultValue={product.customization.typicalTurnaround ?? ""}
            maxLength={120}
            placeholder="2–3 weeks"
            className="sm:w-[280px]"
          />
        </Field>

        <Field
          label="Suggested areas"
          hint="What the assistant offers first. Pick the ones this product genuinely supports — an offer it cannot honour is worse than no offer."
        >
          <div className="border-border bg-surface grid gap-1 rounded-xl border p-2 sm:grid-cols-2">
            {CUSTOMIZATION_AREAS.map((area) => (
              <label
                key={area}
                className="hover:bg-surface-muted flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px]"
              >
                <Checkbox
                  name="customization[suggestedAreas]"
                  value={area}
                  defaultChecked={chosen.has(area)}
                />
                {AREA_LABELS[area] ?? area}
              </label>
            ))}
          </div>
        </Field>
      </FieldGroup>

      {/*
        COS-43 — template only. A full script has nothing left to complete, and
        `submitOffer` refuses one, so drawing the fields on a script would be a form
        whose submit button is guaranteed to fail.
      */}
      {product.catalogue === "template" && (
        <FieldGroup
          title="Complete on request"
          description="Offer to build the working application behind this template. We check that you can deliver before it goes live."
        >
          <OfferStatusNotice
            status={product.completeOnRequest.status}
            note={product.completeOnRequest.note}
          />

          <Field
            label="What would you build?"
            htmlFor="cor-scope"
            hint="The buyer reads this under “What will be added?”. Be specific about what the complete version includes."
          >
            <Textarea
              id="cor-scope"
              name="completeOnRequest[scope]"
              defaultValue={product.completeOnRequest.scope ?? ""}
              maxLength={600}
              rows={3}
              placeholder="The backend and functionality needed to turn this template into a complete application."
            />
          </Field>

          <Field
            label="How long, roughly?"
            htmlFor="cor-lead"
            hint="Shown as “usually within …”. A rough expectation, e.g. “3 weeks”. Not a commitment, and left blank we say nothing about timing."
          >
            <Input
              id="cor-lead"
              name="completeOnRequest[leadTime]"
              defaultValue={product.completeOnRequest.leadTime ?? ""}
              maxLength={120}
              placeholder="3 weeks"
              className="sm:w-[280px]"
            />
          </Field>
        </FieldGroup>
      )}
    </SectionForm>
  );
}

function ToggleRow({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  return (
    <label className="border-border bg-surface flex items-start gap-3 rounded-xl border p-3">
      <Switch name={name} value="on" defaultChecked={defaultChecked} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium">{label}</span>
        <span className="text-muted-foreground block text-[12.5px]">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Where the offer stands, and what to do about it.
 *
 * Saving the words and *sending* them are two actions on purpose: a vendor edits
 * the scope here as often as they like, and asks for a decision once. The submit
 * control is deliberately **not** in this form — `SectionForm` posts the whole
 * section, and a button inside it would make "save my draft" and "send it to
 * staff" the same click.
 */
function OfferStatusNotice({ status, note }: { status: string; note?: string }) {
  if (status === "approved") {
    return (
      <p
        role="status"
        className="border-border bg-surface-muted/40 rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed"
      >
        This offer is live. Buyers looking for a complete application can find this template and
        ask you to build it.
      </p>
    );
  }

  if (status === "pending") {
    return (
      <p
        role="status"
        className="border-border bg-surface-muted/40 rounded-xl border px-3.5 py-2.5 text-[13px] leading-relaxed"
      >
        We&rsquo;re reviewing this offer. Your listing is unchanged in the meantime, and
        we&rsquo;ll email you either way.
      </p>
    );
  }

  if (status === "rejected") {
    return (
      <div className="border-border bg-surface-muted/40 flex flex-col gap-1.5 rounded-xl border px-3.5 py-2.5">
        <p className="text-[13px] font-medium">We couldn&rsquo;t approve this offer</p>
        {/* The reviewer's own words, on the screen where the fix happens — the same
            reasoning as the verification screen's rejection note. */}
        {note && <p className="text-muted-foreground text-[13px] leading-relaxed">{note}</p>}
        <p className="text-subtle text-[12.5px]">
          Update what you would build, then send it again.
        </p>
      </div>
    );
  }

  return null;
}
