"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2, Send } from "lucide-react";
import { Markdown } from "@/features/requirements/components/markdown";
import { replyAsCustomerAction, replyAsStaffAction } from "../actions";
import type { CustomerMessage, StaffMessage } from "@/services/messaging/messaging-service";

/**
 * The thread — §37, §38.
 *
 * ## An internal note is unmistakable
 *
 * §37 asks for a treatment nobody could post by accident: a dashed amber
 * border, an amber ground, and an "Internal only" label on the message *and* on
 * the composer while that mode is active. Subtlety is the wrong instinct here —
 * the cost of a staff member mistaking the mode is a customer reading
 * deliberation about themselves.
 *
 * ## The composer's mode is never defaulted to visible
 *
 * Staff start in **Internal**. §37's criterion is that switching to a customer
 * reply is *deliberate*; starting there and relying on the writer to notice is
 * the opposite. Getting it wrong in this direction costs an internal note the
 * customer never sees, which is recoverable.
 *
 * ## Bodies render through the same sanitised Markdown as the assistant
 *
 * Which builds React elements and never HTML — so an XSS payload in a message
 * renders as the characters somebody typed.
 */
export function Thread({
  subjectType,
  subjectId,
  reference,
  organizationId,
  messages,
  audience,
  canReplyToCustomer,
}: {
  subjectType: "request" | "order" | "quote";
  subjectId: string;
  reference: string;
  /** Staff only — a customer's own organisation comes from their session. */
  organizationId?: string;
  messages: Array<CustomerMessage | StaffMessage>;
  audience: "customer" | "staff";
  canReplyToCustomer?: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-[16px] tracking-[-0.02em]">
        {audience === "staff" ? "Conversation and notes" : "Messages"}
      </h2>

      {messages.length === 0 ? (
        <p className="text-subtle border-border rounded-xl border px-4 py-3 text-[12.5px]">
          {audience === "staff"
            ? "Nothing said yet. A note here is internal unless you switch it."
            : "No messages yet. Ask us anything about this request."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {messages.map((message) => {
            const internal = "visibility" in message && message.visibility === "internal";
            return (
              <li
                key={message.id}
                className={
                  internal
                    ? "rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 px-3.5 py-2.5"
                    : message.mine
                      ? "bg-surface-muted ml-auto max-w-[85%] rounded-xl px-3.5 py-2.5"
                      : "border-border bg-surface mr-auto max-w-[85%] rounded-xl border px-3.5 py-2.5"
                }
              >
                <p className="text-subtle mb-1 flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  {internal && <EyeOff className="size-3 text-amber-600" aria-hidden />}
                  {internal ? "internal only · " : ""}
                  {message.senderName ?? message.senderType}
                  {` · ${message.at.slice(0, 10)}`}
                </p>
                <div className="text-[13.5px]">
                  <Markdown>{message.body}</Markdown>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {audience === "staff" ? (
        <StaffComposer
          subjectType={subjectType}
          subjectId={subjectId}
          reference={reference}
          organizationId={organizationId!}
          canReplyToCustomer={Boolean(canReplyToCustomer)}
        />
      ) : (
        <CustomerComposer
          subjectType={subjectType}
          subjectId={subjectId}
          reference={reference}
        />
      )}
    </section>
  );
}

function CustomerComposer({
  subjectType,
  subjectId,
  reference,
}: {
  subjectType: string;
  subjectId: string;
  reference: string;
}) {
  const [state, submit] = useActionState(replyAsCustomerAction, null);

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-3"
    >
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="reference" value={reference} />

      <label className="sr-only" htmlFor="customer-message">
        Your message
      </label>
      <textarea
        id="customer-message"
        name="body"
        rows={3}
        maxLength={5000}
        required
        placeholder="Ask us anything about this request…"
        className="bg-transparent px-1 py-1 text-[13.5px] outline-none"
      />

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <SendButton label="Send" />
    </form>
  );
}

function StaffComposer({
  subjectType,
  subjectId,
  reference,
  organizationId,
  canReplyToCustomer,
}: {
  subjectType: string;
  subjectId: string;
  reference: string;
  organizationId: string;
  canReplyToCustomer: boolean;
}) {
  const [state, submit] = useActionState(replyAsStaffAction, null);
  // Internal by default — see the note at the top of this file.
  const [visibility, setVisibility] = useState<"customer" | "internal">("internal");

  const customerMode = visibility === "customer";

  return (
    <form
      action={submit}
      className={
        customerMode
          ? "border-border bg-surface flex flex-col gap-2 rounded-xl border p-3"
          : "flex flex-col gap-2 rounded-xl border border-dashed border-amber-500/50 bg-amber-500/5 p-3"
      }
    >
      <input type="hidden" name="subjectType" value={subjectType} />
      <input type="hidden" name="subjectId" value={subjectId} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="visibility" value={visibility} />

      <div className="flex flex-wrap items-center gap-2">
        <Mode
          active={!customerMode}
          onClick={() => setVisibility("internal")}
          icon={<EyeOff className="size-3.5" aria-hidden />}
          label="Internal note"
        />
        <Mode
          active={customerMode}
          onClick={() => setVisibility("customer")}
          disabled={!canReplyToCustomer}
          icon={<Eye className="size-3.5" aria-hidden />}
          label="Reply to customer"
        />

        {/* The mode is stated in words as well as shown, because the colour
            alone is exactly the cue somebody misses when they are busy. */}
        <span
          className={
            customerMode
              ? "text-subtle text-[12px]"
              : "text-[12px] font-medium text-amber-700 dark:text-amber-400"
          }
        >
          {customerMode ? "The customer will see this." : "The customer will never see this."}
        </span>
      </div>

      <label className="sr-only" htmlFor="staff-message">
        {customerMode ? "Reply to the customer" : "Internal note"}
      </label>
      <textarea
        id="staff-message"
        name="body"
        rows={3}
        maxLength={5000}
        required
        placeholder={customerMode ? "Reply to the customer…" : "A note for the team…"}
        className="bg-transparent px-1 py-1 text-[13.5px] outline-none"
      />

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <SendButton label={customerMode ? "Send to customer" : "Save note"} />
    </form>
  );
}

function Mode({
  active,
  onClick,
  disabled,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={disabled ? "You don't have permission to reply to customers." : undefined}
      className={
        active
          ? "bg-foreground text-background flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px]"
          : "border-border hover:bg-surface-muted flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] disabled:opacity-40"
      }
    >
      {icon}
      {label}
    </button>
  );
}

function SendButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-foreground text-background flex w-fit items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Send className="size-3.5" aria-hidden />
      )}
      {label}
    </button>
  );
}
