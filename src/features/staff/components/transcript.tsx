"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, TriangleAlert } from "lucide-react";
import type { AiMessage } from "@/lib/db/models/requests";

/**
 * The whole AI conversation — §19, read-only.
 *
 * ## Collapsed, but present
 *
 * §101 wants it one click away, not one navigation away. Collapsed by default
 * because the requirements above are what staff act on; expanded in place
 * because "how did they phrase it?" is the question the summary cannot answer.
 *
 * ## A withheld turn shows what was withheld
 *
 * When §73's guardrail caught the assistant quoting a price, the customer saw a
 * substitution and the original was kept. Staff see both — otherwise the record
 * would show a polite deflection and hide that the assistant tried to name a
 * figure, which is the one thing anyone reviewing this would want to know.
 */
export function Transcript({ messages }: { messages: AiMessage[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="border-border bg-surface rounded-xl border">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="hover:bg-surface-muted flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="text-subtle size-4" aria-hidden />
        ) : (
          <ChevronRight className="text-subtle size-4" aria-hidden />
        )}
        <span className="font-display text-[16px] tracking-[-0.02em]">The conversation</span>
        <span className="text-subtle text-[12px]">{messages.length} messages</span>
      </button>

      {open && (
        <ul className="divide-border border-border divide-y border-t">
          {messages.map((message, index) => (
            <li key={index} className="flex flex-col gap-1 px-4 py-3">
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                {message.role === "user" ? "customer" : "assistant"}
                {message.model ? ` · ${message.model}` : ""}
              </span>
              <p className="text-[13px] whitespace-pre-wrap">{message.content}</p>

              {message.withheldContent && (
                <div className="mt-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <p className="flex items-center gap-1.5 text-[11.5px] font-medium">
                    <TriangleAlert className="size-3.5 text-amber-600" aria-hidden />
                    Withheld from the customer — {message.withheldReason?.replace(/_/g, " ")}
                  </p>
                  <p className="text-muted-foreground mt-1 text-[12.5px] whitespace-pre-wrap">
                    {message.withheldContent}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
