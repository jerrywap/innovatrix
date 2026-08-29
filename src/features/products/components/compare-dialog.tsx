"use client";

import { useState } from "react";
import { Code2, Sparkles, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "./rich-text-editor";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Yours and the suggestion, side by side, both editable.
 *
 * ## Why both sides can be edited
 *
 * Because neither is finished. The suggestion is a draft with a good sentence
 * and a wrong one in it, and reading your own version next to it is the moment
 * you notice what your version was missing. Making the left side read-only would
 * turn a comparison into an ultimatum.
 *
 * `review-panel.tsx` reached the same conclusion about AI output for a customer:
 * the model's answer is *a starting position*, and a control the human operates
 * is what accepts it.
 *
 * ## Every field is controlled, deliberately
 *
 * Not `defaultValue`. `review-panel.tsx:43-55` records what that cost there — a
 * `defaultValue` field silently restored the model's original text over the
 * customer's edits when the form re-rendered. The same hazard applies to any
 * dialog that survives a parent render.
 *
 * ## The dialog writes nothing itself
 *
 * `DialogContent` portals to `document.body`, so everything in here is **outside
 * the wizard form's DOM subtree** — an input in this dialog would never be
 * submitted, however correct it looked. So the dialog returns a value through
 * `onAccept` and the caller writes it into the form's own control. That is
 * `AgreementGate`'s pattern: the dialog decides, a real input in the form
 * carries.
 */

export interface Feature {
  title: string;
  detail?: string;
}

/* ────────────────────────────────────────────── prose */

export function CompareProseDialog({
  open,
  onOpenChange,
  title,
  mine,
  suggested,
  onMineChange,
  onSuggestedChange,
  onAccept,
  limit,
  rich,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  mine: string;
  suggested: string;
  onMineChange: (value: string) => void;
  onSuggestedChange: (value: string) => void;
  /** Called with whichever side won, already including any edits made here. */
  onAccept: (value: string) => void;
  /**
   * The value is rich text, so show it as rich text.
   *
   * Only the product description passes this. The summary and the two SEO fields
   * are plain strings with hard character limits — a formatting toolbar over a
   * 160-character meta description would be offering something the field cannot
   * store.
   */
  rich?: boolean;
  /**
   * The field's hard character limit, where it has one.
   *
   * Only the SEO fields pass it, and there the limit *is* the brief — 70 for a
   * title, 160 for a description, refused by `productSeoSchema` above that. The
   * prompt states it, but a model asked for 155 characters sometimes writes 180,
   * and the honest place to find that out is here rather than on save. Shown, not
   * enforced: truncating somebody's sentence mid-word is worse than letting them
   * see the number and cut it.
   */
  limit?: number;
}) {
  /*
   * Over the limit, the side cannot be accepted — it is not silently trimmed.
   *
   * Clamping was the first version and it cut mid-word, which is data loss
   * wearing a tidy edge: the author gets a sentence that stops at "keeps the
   * whole day in". Refusing instead puts the decision where the counter already
   * is, beside the text, with the exact number of characters to lose. It is also
   * the only reading consistent with what the count claims to be — a limit shown
   * rather than one enforced behind your back.
   */
  const tooLong = (value: string) => limit !== undefined && value.length > limit;

  return (
    <CompareShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      onKeepMine={() => onAccept(mine)}
      onUseSuggested={() => onAccept(suggested)}
      {...(tooLong(mine) ? { keepMineDisabled: `Over ${limit} characters` } : {})}
      {...(tooLong(suggested) ? { useSuggestedDisabled: `Over ${limit} characters` } : {})}
    >
      <Pane label="Yours" {...(limit ? { count: mine.length, limit } : {})}>
        <ProsePane
          value={mine}
          onChange={onMineChange}
          label="Your version"
          rich={rich ?? false}
        />
      </Pane>

      <Pane label="Suggested" accent {...(limit ? { count: suggested.length, limit } : {})}>
        <ProsePane
          value={suggested}
          onChange={onSuggestedChange}
          label="The suggested version"
          rich={rich ?? false}
        />
      </Pane>
    </CompareShell>
  );
}

/**
 * One side of a prose comparison — rendered, or as its source.
 *
 * ## Why rich is the default and source is still there
 *
 * The description round-trips as HTML because that is what preserves headings
 * and lists through the model. That made both panes a wall of tags: comparing
 * `<h2>What it does</h2><p>Gracia Daily takes <strong>online…` against another
 * one of those is not reading, it is parsing. So the default is the rendered
 * document, edited the same way the field itself is edited.
 *
 * The source view stays because the round trip is the thing most likely to go
 * wrong, and "what did the model actually return" is the question you ask when
 * it does. It is one toggle, not a mode anyone has to understand.
 *
 * ## The editor is remounted on toggle, deliberately
 *
 * `RichTextEditor` seeds from `content` once — that is what keeps it
 * uncontrolled, and what stops every keystroke round-tripping through JSON. So
 * `key` carries the view, and switching to source and back re-seeds from
 * whatever the string now holds. Typing inside one view never remounts it.
 */
function ProsePane({
  value,
  onChange,
  label,
  rich,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  rich: boolean;
}) {
  const [source, setSource] = useState(false);

  if (!rich) {
    return (
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className="min-h-[220px] flex-1 font-mono text-[12.5px]"
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {source ? (
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-label={`${label}, as HTML`}
          className="min-h-[220px] flex-1 font-mono text-[12px]"
        />
      ) : (
        <RichTextEditor
          key={`rich-${source}`}
          defaultHtml={value}
          onChangeHtml={onChange}
          placeholder="Nothing here yet."
          className="min-h-0 flex-1"
        />
      )}

      <button
        type="button"
        onClick={() => setSource((on) => !on)}
        className="text-subtle hover:text-foreground inline-flex w-fit items-center gap-1.5 text-[11.5px] transition"
      >
        {source ? (
          <Type className="size-3" aria-hidden />
        ) : (
          <Code2 className="size-3" aria-hidden />
        )}
        {source ? "Show formatted" : "Show HTML"}
        <span className="sr-only"> for {label}</span>
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────── features */

export function CompareFeaturesDialog({
  open,
  onOpenChange,
  mine,
  suggested,
  onMineChange,
  onSuggestedChange,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mine: Feature[];
  suggested: Feature[];
  onMineChange: (value: Feature[]) => void;
  onSuggestedChange: (value: Feature[]) => void;
  onAccept: (value: Feature[]) => void;
}) {
  return (
    <CompareShell
      open={open}
      onOpenChange={onOpenChange}
      title="Suggested features"
      onKeepMine={() => onAccept(mine)}
      onUseSuggested={() => onAccept(suggested)}
    >
      <Pane label={`Yours (${mine.length})`}>
        <FeatureList rows={mine} onChange={onMineChange} side="mine" />
      </Pane>

      <Pane label={`Suggested (${suggested.length})`} accent>
        <FeatureList rows={suggested} onChange={onSuggestedChange} side="suggested" />
      </Pane>
    </CompareShell>
  );
}

function FeatureList({
  rows,
  onChange,
  side,
}: {
  rows: Feature[];
  onChange: (rows: Feature[]) => void;
  /** Only for the accessible names — two lists on one screen need telling apart. */
  side: "mine" | "suggested";
}) {
  const label = side === "mine" ? "your" : "the suggested";

  const update = (index: number, patch: Partial<Feature>) =>
    onChange(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)));

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
      {rows.length === 0 && (
        <p className="text-subtle py-6 text-center text-[13px]">Nothing here.</p>
      )}

      {rows.map((row, index) => (
        <div
          key={index}
          className="border-border flex flex-col gap-1.5 rounded-lg border p-2.5"
        >
          <div className="flex items-start gap-2">
            <Input
              value={row.title}
              onChange={(event) => update(index, { title: event.target.value })}
              aria-label={`Title of ${label} feature ${index + 1}`}
              maxLength={120}
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, at) => at !== index))}
              className="text-subtle hover:text-foreground shrink-0 px-1 py-1.5 text-[12px]"
            >
              Remove
              <span className="sr-only">
                {" "}
                {label} feature {index + 1}
              </span>
            </button>
          </div>
          <Input
            value={row.detail ?? ""}
            onChange={(event) => update(index, { detail: event.target.value })}
            aria-label={`Detail of ${label} feature ${index + 1}`}
            placeholder="Optional — one sentence of detail"
            maxLength={500}
            className="text-[13px]"
          />
        </div>
      ))}

      <button
        type="button"
        onClick={() => onChange([...rows, { title: "" }])}
        className="border-border hover:bg-surface-muted mt-1 w-fit rounded-full border px-3 py-1.5 text-[12.5px]"
      >
        Add a feature
      </button>
    </div>
  );
}

/* ────────────────────────────────────────────── the shell */

/**
 * The layout, shared so the two dialogs cannot drift.
 *
 * `flex flex-col gap-0 p-0` + `max-h-[86vh]` on the content, `min-h-0 flex-1
 * overflow-y-auto` on the body — `agreement-gate.tsx`'s recipe, and `min-h-0` is
 * what makes the flex child actually scroll rather than pushing the footer off.
 *
 * `md:grid-cols-2`, not `lg:`. Tailwind breakpoints are viewport-based, not
 * container-based, so on a 1100px dialog `lg:` would still be deciding from the
 * window width — `md:` is the point at which two panes of prose are genuinely
 * readable side by side.
 */
function CompareShell({
  open,
  onOpenChange,
  title,
  children,
  onKeepMine,
  onUseSuggested,
  keepMineDisabled,
  useSuggestedDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: React.ReactNode;
  onKeepMine: () => void;
  onUseSuggested: () => void;
  /** Why that side cannot be taken — becomes the button's `title`. */
  keepMineDisabled?: string;
  useSuggestedDisabled?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[86vh] w-[min(100%,1100px)] flex-col gap-0 p-0 sm:max-w-[1100px]">
        <DialogHeader className="border-border border-b px-5 py-4 text-left">
          <DialogTitle className="font-display flex items-center gap-2 text-[17px] tracking-[-0.02em]">
            <Sparkles className="text-signal-text size-4" aria-hidden />
            {title}
          </DialogTitle>
          <DialogDescription className="text-[13px]">
            Edit either side before you choose. Nothing is saved until you save the step.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 md:grid-cols-2">
          {children}
        </div>

        {/*
          `mx-0 mb-0` cancels `DialogFooter`'s own `-mx-4 -mb-4`, which exist to
          bleed it to the edge of a `p-4` content. This content is `p-0`, so
          uncancelled they pull the bar outside the dialog — the same fix, and the
          same reason, as `agreement-gate.tsx`.
        */}
        <DialogFooter className="border-border mx-0 mb-0 flex-row items-center justify-end gap-2 border-t px-5 py-3.5">
          {/*
            Both buttons name what they do — `confirm-dialog.tsx`'s rule. "Keep
            mine" is not a cancel: it commits the edits made to the left pane.
          */}
          <Button
            type="button"
            variant="outline"
            onClick={onKeepMine}
            disabled={Boolean(keepMineDisabled)}
            {...(keepMineDisabled ? { title: keepMineDisabled } : {})}
          >
            Keep mine
          </Button>
          <Button
            type="button"
            onClick={onUseSuggested}
            disabled={Boolean(useSuggestedDisabled)}
            {...(useSuggestedDisabled ? { title: useSuggestedDisabled } : {})}
          >
            Use suggested
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Pane({
  label,
  accent = false,
  count,
  limit,
  children,
}: {
  label: string;
  /** The suggestion, marked once at the top rather than per row. */
  accent?: boolean;
  count?: number;
  limit?: number;
  children: React.ReactNode;
}) {
  const over = count !== undefined && limit !== undefined && count > limit;

  return (
    <section
      className={`flex min-h-0 flex-col gap-2 rounded-xl border p-3 ${
        accent ? "border-signal/30 bg-signal-soft/30" : "border-border"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        {/*
          Provenance is a heading, not a badge — `review-panel.tsx`'s conclusion
          about labelling AI output, and it applies to a whole pane even more
          cleanly than to a row.
        */}
        <h3 className="text-subtle font-mono text-[10px] tracking-[0.14em] uppercase">
          {label}
        </h3>

        {count !== undefined && limit !== undefined && (
          /*
            `aria-live="polite"` so somebody typing towards the limit is told when
            they cross it — the colour alone carries that for sighted readers and
            for nobody else. Polite rather than assertive: it changes on every
            keystroke, and an assertive region would talk over the typing.
          */
          <span
            aria-live="polite"
            className={`font-mono text-[10.5px] tabular-nums ${
              over ? "text-[var(--danger)]" : "text-subtle"
            }`}
          >
            {count} / {limit}
            {over && <span className="sr-only"> — too long to save</span>}
          </span>
        )}
      </div>

      {children}
    </section>
  );
}
