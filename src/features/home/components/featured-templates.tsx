import { ProductCardTile } from "@/features/marketplace/components/product-card";
import { getRail } from "@/services/marketplace";
import { resolveStorefrontCurrency } from "@/services/marketplace/currency";
import { Band, SectionHead } from "./band";

/**
 * "Build your website faster" — the template catalogue, which had no band at all.
 *
 * ## Visually led, without a second card system
 *
 * The brief wants templates to feel more design-led than the software band and to
 * use larger screenshots — and it also says to reuse the existing cards rather
 * than build a parallel visual language. Both are satisfied by the **column
 * count**: three across instead of four, so the same `ProductCardTile` renders a
 * meaningfully bigger image in the same grid, with no fork to keep in sync. The
 * card's own `sizes` attribute already covers this breakpoint.
 *
 * Sitting on the plain ground directly after the muted software band is the other
 * half of the separation the brief asks for: the two catalogues must not read as
 * one undifferentiated shelf.
 */
export async function FeaturedTemplates() {
  const currency = await resolveStorefrontCurrency();
  const cards = await getRail("featured", currency, 6, "template");

  // The template catalogue is younger than the script one, so empty here is a
  // genuinely expected state rather than a fault.
  if (cards.length === 0) return null;

  return (
    <Band id="templates">
      <SectionHead
        eyebrow="Website templates"
        title="Build your website faster."
        lede="Front-ends you can put live and make your own — storefronts, dashboards, landing pages and corporate sites. Many of them free."
        action={{ href: "/templates", label: "Browse website templates" }}
      />

      {/* Three on a phone, six from `sm`. Same reasoning as the software band. */}
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 [&>*:nth-child(n+4)]:hidden sm:[&>*:nth-child(n+4)]:block">
        {cards.map((card) => (
          <ProductCardTile key={card.id} card={card} />
        ))}
      </div>
    </Band>
  );
}

export function TemplatesSkeleton() {
  return (
    <Band>
      <div className="bg-surface-muted h-[38px] w-[260px] animate-pulse rounded-full" />
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="bg-surface-muted h-[340px] animate-pulse rounded-xl" />
        ))}
      </div>
    </Band>
  );
}
