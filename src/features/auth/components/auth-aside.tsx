import { LayoutTemplate, Package, Wand2 } from "lucide-react";
import { BRAND } from "@/config/brand";
import { HERO_PATHS } from "@/features/home/data";

/**
 * What the auth pages say while somebody is filling in a form.
 *
 * ## Why these three, and why they are borrowed rather than written
 *
 * `HERO_PATHS` is the platform's offer in three lines, and it is already the
 * first thing a visitor reads on the home page. Restating it here in fresh words
 * would be two descriptions of one product, drifting apart the first time either
 * is edited — the failure `brand.ts` was created to end. So this reads the same
 * data, and a change to the offer changes both surfaces at once.
 *
 * The import crosses from `features/auth` into `features/home`, which is worth a
 * word: the module is named for where the copy first appeared, not for who owns
 * it. If a third surface ever wants the same three, that is the moment to move
 * it to `config/`, not before.
 *
 * ## Deliberately inert
 *
 * No links, no data, no session read. Three reasons, in order of weight:
 *
 * - **The page has one job.** The layout's own docblock refuses a nav bar here
 *   because "a nav bar full of links is an invitation to abandon it
 *   half-finished". A panel of links would be the same invitation wearing a
 *   different coat, so these are statements rather than destinations.
 * - **It must not make the route dynamic.** Anything cookie- or database-backed
 *   would put a read behind every sign-in; `instant = false` on the layout keeps
 *   the current behaviour, and static content keeps it honest.
 * - **It is decoration for the form, not competition with it.** Muted, no
 *   filled buttons, nothing that outranks the one control on the page.
 *
 * Hidden below `lg` — see the layout.
 */

const PATH_ICONS = { package: Package, layout: LayoutTemplate, wand: Wand2 } as const;

export function AuthAside() {
  return (
    <aside className="flex flex-col gap-8" aria-label="About CoSetup">
      <p className="font-display max-w-[18ch] text-[28px] leading-[1.15] tracking-[-0.03em]">
        {BRAND.tagline}
      </p>

      <ul className="flex flex-col gap-5">
        {HERO_PATHS.map((path) => {
          const Icon = PATH_ICONS[path.icon];

          return (
            <li key={path.title} className="flex gap-3.5">
              <span
                aria-hidden
                className="border-border bg-surface text-signal-text grid size-9 shrink-0 place-items-center rounded-xl border"
              >
                <Icon className="size-4" />
              </span>

              <div className="flex flex-col gap-1">
                <span className="text-[14px] font-medium">{path.title}</span>
                <span className="text-muted-foreground max-w-[42ch] text-[13px] leading-relaxed">
                  {path.body}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
