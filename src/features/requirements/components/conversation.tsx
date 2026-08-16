"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Loader2 } from "lucide-react";
import { Markdown } from "./markdown";

/**
 * The interview — §17.
 *
 * ## One question at a time is a UI property too
 *
 * The prompt asks for it; this reinforces it by giving the customer one input
 * and no sense that a form is waiting behind it. §15's whole point is that the
 * conversation *replaces* the requirements form.
 *
 * ## A withheld turn is replaced, not appended
 *
 * The guardrail runs on the complete text (a price can straddle two chunks), so
 * the stream is optimistic: deltas render as they arrive, and if the check
 * fails the `done` event carries a substitution that **replaces** what was
 * shown. The customer sees one message settle, which is the price of never
 * letting a number through.
 */

export interface DisplayMessage {
  role: "user" | "assistant";
  content: string;
}

export function Conversation({
  conversationId,
  initialMessages,
  onTranscriptChange,
  suggestions,
  disabled,
  disabledReason,
}: {
  conversationId: string;
  initialMessages: DisplayMessage[];
  /** Lets the page enable "review and submit" once there is enough to review. */
  onTranscriptChange?: (messages: DisplayMessage[]) => void;
  /** §17's suggested answers, alongside free text. */
  suggestions?: string[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streaming]);

  useEffect(() => {
    onTranscriptChange?.(messages);
  }, [messages, onTranscriptChange]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;

    setDraft("");
    setError(null);
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    setStreaming("");

    try {
      const response = await fetch(`/api/ai/${conversationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: trimmed }),
      });

      if (!response.ok || !response.body) {
        const detail = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? "The assistant is unavailable right now.");
      }

      await readEvents(response.body, {
        onDelta: (chunk) => setStreaming((current) => (current ?? "") + chunk),
        onDone: ({ content }) => {
          // Always the server's text, never the accumulated stream: when the
          // guardrail replaced the turn, what we rendered must be discarded.
          setMessages((current) => [...current, { role: "assistant", content }]);
          setStreaming(null);
        },
        onError: (message) => {
          setStreaming(null);
          setError(message);
        },
      });
    } catch (caught) {
      setStreaming(null);
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3" aria-live="polite" aria-busy={busy}>
        {messages.map((message, index) => (
          <Bubble key={index} role={message.role}>
            {message.role === "assistant" ? (
              <Markdown>{message.content}</Markdown>
            ) : (
              message.content
            )}
          </Bubble>
        ))}

        {streaming !== null && (
          <Bubble role="assistant">
            {streaming ? (
              <Markdown>{streaming}</Markdown>
            ) : (
              <span className="text-subtle inline-flex items-center gap-2 text-[13px]">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Thinking…
              </span>
            )}
          </Bubble>
        )}

        <div ref={endRef} />
      </div>

      {error && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            {error}{" "}
            <a href="#manual-form" className="underline underline-offset-4">
              Fill in a form instead
            </a>
            .
          </span>
        </p>
      )}

      {suggestions && suggestions.length > 0 && !busy && (
        // §17: offer options *and* free text. Chips are faster on a phone,
        // which is where a lot of this conversation happens.
        <div className="flex flex-wrap gap-2">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => void send(suggestion)}
              disabled={disabled}
              className="border-border hover:bg-surface-muted rounded-full border px-3 py-1.5 text-[12.5px]"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {disabled ? (
        <p className="border-border bg-surface-muted text-muted-foreground rounded-xl border px-3.5 py-2.5 text-[13px]">
          {disabledReason ?? "This conversation is closed."}
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
          className="border-border bg-surface flex items-end gap-2 rounded-xl border p-2"
        >
          <label htmlFor="reply" className="sr-only">
            Your answer
          </label>
          <textarea
            id="reply"
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks a line. The alternative traps
              // anyone who types a paragraph and expects Enter to submit.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Type your answer…"
            className="max-h-40 min-h-[2.5rem] flex-1 resize-y bg-transparent px-2 py-1.5 text-[14px] outline-none"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            className="bg-foreground text-background grid size-9 shrink-0 place-items-center rounded-full disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
            <span className="sr-only">Send</span>
          </button>
        </form>
      )}
    </div>
  );
}

function Bubble({ role, children }: { role: "user" | "assistant"; children: React.ReactNode }) {
  return (
    <div
      className={
        role === "user"
          ? "bg-surface-muted ml-auto max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2.5 text-[14px] whitespace-pre-wrap"
          : "border-border bg-surface mr-auto max-w-[92%] rounded-2xl rounded-bl-sm border px-3.5 py-2.5 text-[14px]"
      }
    >
      {children}
    </div>
  );
}

/**
 * Read `text/event-stream` off a `fetch` body.
 *
 * Hand-rolled rather than `EventSource`, which only does GET and cannot send a
 * body — and the message has to be a POST.
 */
async function readEvents(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onDelta: (text: string) => void;
    onDone: (payload: { content: string; replaced: boolean; truncated: boolean }) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Frames are separated by a blank line; a partial frame stays in `buffer`.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const raw = /^data: (.+)$/m.exec(frame)?.[1];
      if (!event || !raw) continue;

      let data: unknown;
      try {
        data = JSON.parse(raw);
      } catch {
        continue;
      }

      if (event === "delta") handlers.onDelta((data as { text: string }).text);
      else if (event === "done")
        handlers.onDone(data as { content: string; replaced: boolean; truncated: boolean });
      else if (event === "error") handlers.onError((data as { message: string }).message);
    }
  }
}
