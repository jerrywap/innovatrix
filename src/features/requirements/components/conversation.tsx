"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowUp, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/shell/brand-mark";
import { splitAssistantOptions } from "@/lib/assistant-options";
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
 *
 * ## Not a chat app, and the difference is in the details
 *
 * The conversation is an input mechanism for a project brief, not the product.
 * Three things keep it on the right side of that line, and each of them was the
 * generic-chatbot behaviour before:
 *
 * - **The assistant's turns are attributed.** An unlabelled bordered bubble is
 *   the messaging-app idiom; a turn with the brand mark and a role beside it
 *   reads as CoSetup working on your problem. No invented consultant name, and
 *   no "AI" — whether a model is involved is our implementation detail.
 * - **Options are tappable.** The prompt has always asked the assistant to offer
 *   two to four concrete answers and it always did — inside its prose, where the
 *   customer read them and then typed one out by hand. They now arrive on a
 *   channel (`splitAssistantOptions`) and render as chips after every turn.
 * - **Scrolling is not hijacked.** See `useAutoScroll`.
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
  initialDraft,
  disabled,
  disabledReason,
  onFallback,
}: {
  conversationId: string;
  initialMessages: DisplayMessage[];
  /** Lets the page enable "review and submit" once there is enough to review. */
  onTranscriptChange?: (messages: DisplayMessage[]) => void;
  /** §17's suggested answers, alongside free text. */
  suggestions?: string[];
  /**
   * What they already typed, somewhere else — the homepage's "what are you
   * looking to build?" box (COS-7).
   *
   * It lands in the textarea **unsent**. Auto-sending would make a `GET` write
   * messages, so following `?brief=…` from a crawler or a shared link would
   * create rows; and it would take their own words out of their hands before
   * they had a chance to read them back. Prefilled, focused, editable.
   */
  initialDraft?: string;
  disabled?: boolean;
  disabledReason?: string;
  /**
   * §104's escape hatch, offered on an error.
   *
   * A callback rather than the `#manual-form` anchor this used to be: that
   * anchor pointed at an element which only exists after the customer has sent
   * a message *and* clicked "Write it out myself", so on the error that most
   * needed it — a failure on the very first message — it pointed at nothing and
   * clicking it did nothing at all.
   */
  onFallback?: () => void;
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState(initialDraft ?? "");
  /**
   * The options the assistant offered on its last turn.
   *
   * `null` means "it has not answered yet", which is what makes the opener chips
   * from the server show at the start and disappear the moment the customer says
   * anything — including when the assistant offers nothing back, where an empty
   * array is a real answer and must not fall through to the openers again.
   */
  const [offered, setOffered] = useState<string[] | null>(null);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  /*
   * A signal rather than a dependency array: `useAutoScroll` needs to fire when
   * the thread grows *or* the stream advances, and a hook taking a spread array
   * cannot be statically checked by the exhaustive-deps rule — which is a real
   * limitation, not a lint annoyance, because the values it should watch would
   * then be invisible to it. One derived string is watchable.
   */
  const scrollSignal = `${messages.length}:${streaming?.length ?? -1}`;
  const { scrollAnchorRef, viewportRef, rememberScrollIntent } = useAutoScroll(scrollSignal);

  useEffect(() => {
    onTranscriptChange?.(messages);
  }, [messages, onTranscriptChange]);

  const send = useCallback(
    async function send(text: string) {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      setDraft("");
      setError(null);
      setBusy(true);
      // Sending answers the last question, so its options stop being an answer
      // to anything. Cleared before the request, not after it, or they sit there
      // tappable while the reply streams in above them.
      setOffered([]);
      setMessages((current) => [...current, { role: "user", content: trimmed }]);
      setStreaming("");
      // A new turn is always worth following, however far up they had scrolled.
      rememberScrollIntent(true);

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
          onDone: ({ content, options }) => {
            // Always the server's text, never the accumulated stream: when the
            // guardrail replaced the turn, what we rendered must be discarded.
            setMessages((current) => [...current, { role: "assistant", content }]);
            setStreaming(null);
            setOffered(options ?? []);
          },
          onError: (message) => {
            setStreaming(null);
            setError(message);
          },
        });
      } catch (caught) {
        setStreaming(null);
        /*
         * Take the optimistic message back.
         *
         * It was appended before the request so the customer sees their own words
         * immediately. When the request never lands, leaving it there tells them
         * we have it — and the server does not, because the turn is persisted by
         * the route and this one never reached it. Restoring the draft is the
         * other half: their sentence returns to the box they typed it in, ready
         * to send again.
         */
        setMessages((current) =>
          current[current.length - 1]?.content === trimmed ? current.slice(0, -1) : current,
        );
        setDraft((current) => (current.length > 0 ? current : trimmed));
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, conversationId, rememberScrollIntent],
  );

  // The server's openers until the assistant has offered its own. See `offered`.
  const chips = offered ?? suggestions ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div
        ref={viewportRef}
        className="flex flex-col gap-5"
        aria-live="polite"
        aria-busy={busy}
      >
        {messages.map((message, index) =>
          message.role === "assistant" ? (
            <AssistantTurn key={index}>
              <Markdown>{message.content}</Markdown>
            </AssistantTurn>
          ) : (
            <CustomerTurn key={index}>{message.content}</CustomerTurn>
          ),
        )}

        {streaming !== null && (
          <AssistantTurn>
            {streaming ? (
              /*
               * Stripped here as well as on the server.
               *
               * The marker is the last thing the model writes, so without this
               * the customer watches `::options::` type itself out and then
               * vanish when the `done` frame lands. Same function, so there is
               * one definition of what a marker is.
               */
              <Markdown>{splitAssistantOptions(streaming).text}</Markdown>
            ) : (
              <span className="text-subtle inline-flex items-center gap-1.5 text-[13px]">
                Thinking
                <ThinkingDots />
              </span>
            )}
          </AssistantTurn>
        )}

        <div ref={scrollAnchorRef} />
      </div>

      {error && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
          <span>
            {error}{" "}
            {onFallback && (
              <>
                <button
                  type="button"
                  onClick={onFallback}
                  className="underline underline-offset-4"
                >
                  Fill in a form instead
                </button>
                .
              </>
            )}
          </span>
        </p>
      )}

      {chips.length > 0 && !busy && (
        // §17: offer options *and* free text. Chips are faster on a phone,
        // which is where a lot of this conversation happens.
        <div className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => void send(chip)}
              disabled={disabled}
              className="border-border hover:border-border-strong hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-left text-[12.5px] transition-colors"
            >
              {chip}
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
          className="border-border bg-surface focus-within:border-border-strong flex items-end gap-2 rounded-2xl border p-2 transition-colors"
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
            placeholder={
              messages.length === 0 ? "Tell us in your own words…" : "Type your answer…"
            }
            /*
             * `field-sizing-content` grows the box with the text and
             * `resize-none` takes the drag handle away, which is the trade: the
             * handle existed because the box could not grow itself. Browsers
             * without it fall back to the `rows={2}` box and a scrollbar, which
             * is what everyone had before.
             */
            className="field-sizing-content max-h-40 min-h-[2.75rem] flex-1 resize-none bg-transparent px-2 py-1.5 text-[14px] outline-none"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length === 0}
            /*
             * The accent arrives with the text, so the button being live is
             * something you can see rather than something you try. Disabled is
             * a muted surface rather than a faded accent — a 40%-opacity orange
             * circle reads as broken, not as waiting.
             */
            className={`grid size-9 shrink-0 place-items-center rounded-full transition-colors ${
              busy || draft.trim().length === 0
                ? "bg-surface-muted text-muted-foreground"
                : "bg-signal text-signal-contrast"
            }`}
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

/**
 * The assistant's turn, attributed.
 *
 * A bordered bubble with nobody's name on it is the chat-widget idiom, and it is
 * what this looked like. The mark and the label say who is doing the work — and
 * say it once per turn rather than once per page, because the customer's own
 * messages sit between them.
 *
 * "Discovery" rather than "AI assistant" is the §32 rule. What the customer needs
 * to understand is that CoSetup is working out what they need; whether a model is
 * involved changes nothing they can act on.
 */
function AssistantTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <BrandMark className="text-foreground size-[15px]" />
        <span className="text-[12.5px] font-medium">CoSetup</span>
        <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
          Discovery
        </span>
      </div>
      {/*
        Indented to the label rather than boxed. Removing the border is what stops
        the alternating bubbles reading as a messaging app — the assistant's side
        is now typography on the page, and the customer's is the only thing with a
        fill, which is also the correct emphasis: their words are the evidence.
      */}
      <div className="pl-[23px] text-[14px] leading-relaxed">{children}</div>
    </div>
  );
}

function CustomerTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface-muted border-border ml-auto max-w-[85%] rounded-2xl rounded-br-sm border px-3.5 py-2.5 text-[14px] whitespace-pre-wrap">
      {children}
    </div>
  );
}

/**
 * Three dots, staggered.
 *
 * A spinner says "the page is loading"; this says "somebody is composing", which
 * is what is happening. The global `prefers-reduced-motion` block in
 * `globals.css` collapses the durations to nothing, leaving three static dots —
 * a correct end state rather than a frozen mid-animation, so no per-element
 * `motion-reduce` override is needed.
 */
function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="bg-subtle size-1 animate-pulse rounded-full"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * Follow the conversation, unless the customer is reading something else.
 *
 * The old effect called `scrollIntoView` on every `messages`/`streaming` change —
 * which is every streaming delta, several times a second. Scroll up to re-read an
 * answer while the next one generates and it dragged you back down, repeatedly,
 * with no way to win. The behaviour customers describe as "it keeps jumping".
 *
 * So intent is sampled **before** the DOM updates, in a layout effect: if they
 * were already near the bottom they were following along and we keep them there;
 * if they had scrolled away they are reading and we leave them alone. Sending a
 * message overrides it — see `rememberScrollIntent` at the call site — because
 * having just typed something you always want to see the reply.
 *
 * `block: "end"` and no `behavior`, deliberately: smooth scrolling on every delta
 * queues animations faster than they finish.
 */
function useAutoScroll(signal: string) {
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const rememberScrollIntent = useCallback((force?: boolean) => {
    if (force) {
      following.current = true;
      return;
    }
    const anchor = scrollAnchorRef.current;
    if (!anchor) return;
    // Distance from the anchor to the bottom of the window. Within a couple of
    // lines counts as following; anything more is deliberate.
    following.current = anchor.getBoundingClientRect().top - window.innerHeight < 120;
  }, []);

  useLayoutEffect(() => {
    // Runs before paint, so this reads where the customer *was*, not where the
    // new content has just pushed them.
    rememberScrollIntent();
  });

  useEffect(() => {
    if (following.current) scrollAnchorRef.current?.scrollIntoView({ block: "end" });
  }, [signal]);

  return { scrollAnchorRef, viewportRef, rememberScrollIntent };
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
    onDone: (payload: {
      content: string;
      options?: string[];
      replaced: boolean;
      truncated: boolean;
    }) => void;
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
        handlers.onDone(
          data as {
            content: string;
            options?: string[];
            replaced: boolean;
            truncated: boolean;
          },
        );
      else if (event === "error") handlers.onError((data as { message: string }).message);
    }
  }
}
