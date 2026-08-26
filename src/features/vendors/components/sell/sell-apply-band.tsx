import Image from "next/image";
import Link from "next/link";
import { placeholder, SHOT } from "@/lib/placeholder-images";

/**
 * The close — the page's one photograph, and the two actions.
 *
 * ## Why the photograph is here and nowhere else
 *
 * Everything above this is drawn from tokens, because the subject up there is
 * software and a photograph of software is a photograph of a screen. Down here the
 * subject is the person deciding, so a photograph has a job — and having exactly one
 * makes it read as a deliberate change of register rather than as stock filler.
 *
 * It is scrimmed the way the homepage hero's is: the type sits on flat colour, never
 * on the image, so contrast is the token contrast and cannot drift with the viewport.
 * `tone="inverse"` is not used here because the photograph *is* the interruption —
 * two competing dark treatments in one band is one too many.
 *
 * ## Presence raised, contrast held
 *
 * The first pass sat at 50% and read as washed out — a photograph apologising for
 * being there. It is 72% now, and the horizontal scrim went *up* rather than down to
 * pay for it: opaque page colour until 48% of the width, which is past where the
 * text ends. So the image gained presence only on the half of the band that carries
 * no type, and nothing about the contrast changed.
 */
export function SellApplyBand() {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <Image
          src={placeholder(SHOT.workspace, 1600)}
          alt=""
          fill
          sizes="100vw"
          className="object-cover object-center opacity-[0.72] dark:opacity-[0.3]"
        />
        {/* the type's ground: opaque on the left, clearing to the right */}
        <div className="from-background via-background/92 absolute inset-0 bg-gradient-to-r via-48% to-transparent" />
        {/* and the edges, so the band never ends on a line */}
        <div className="to-background absolute inset-x-0 top-0 h-24 bg-gradient-to-t from-transparent" />
        <div className="to-background absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent" />
      </div>

      <div className="relative mx-auto max-w-[1400px] px-5 py-24 lg:px-10 lg:py-32">
        {/*
          Two measures, not one. `ch` resolves against the element's own font size, so a
          46ch container built for the paragraph is about 370px — which is right for
          body text and wraps a 51px heading onto three lines with an orphan. The
          heading takes the container's width; only the paragraph is narrowed.
        */}
        <div className="max-w-[620px]">
          <h2 className="text-[clamp(1.9rem,4.4vw,3.2rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance">
            Built something worth selling?
          </h2>
          <p className="text-muted-foreground mt-5 max-w-[46ch] text-[16px] leading-relaxed">
            Apply in a few minutes. We review every vendor application before you start listing,
            and you accept the vendor agreement as part of it.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard/selling/apply"
              className="bg-signal text-signal-contrast rounded-full px-6 py-3 text-[14px] font-medium transition hover:opacity-90"
            >
              Apply to sell
            </Link>
            <Link
              href="/terms/vendor"
              className="border-border bg-surface hover:border-border-strong rounded-full border px-6 py-3 text-[14px] font-medium transition"
            >
              Read the vendor agreement
            </Link>
          </div>

          <p className="text-subtle mt-5 text-[12.5px]">
            Free to apply &middot; you&rsquo;ll need a CoSetup account
          </p>
        </div>
      </div>
    </section>
  );
}
