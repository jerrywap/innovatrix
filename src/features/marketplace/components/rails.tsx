import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { cookies } from "next/headers";
import {
  CURRENCY_COOKIE,
  RECENTLY_VIEWED_COOKIE,
  toStorefrontCurrency,
} from "@/config/storefront";
import { getCardsBySlug, getRail } from "@/services/marketplace";
import type { CatalogueScope } from "@/config/catalogue";
import { parseRecentlyViewed } from "@/services/marketplace/recently-viewed";
import { ProductCardTile } from "./product-card";

/**
 * Discovery rails — §6.
 *
 * ## Only on the unfiltered listing
 *
 * A visitor who has filtered to "CRM, Laravel, under £500" has told you exactly
 * what they want. Putting "Featured" and "Most bought" above those results
 * pushes the thing they asked for below the fold to show them something they
 * did not. So the page renders rails **or** a filtered grid, never both.
 *
 * ## Recently viewed needs no account
 *
 * It reads a cookie the product page writes (ticket 09). That is what makes the
 * criterion — "survives a page refresh and does not require login" — true, and
 * it is also why the cookie's contents are treated as untrusted on the way in:
 * `parseRecentlyViewed` drops anything that is not a slug.
 */
export async function DiscoveryRails({ catalogue }: { catalogue: CatalogueScope }) {
  const jar = await cookies();
  const currency = toStorefrontCurrency(jar.get(CURRENCY_COOKIE)?.value);
  const recentSlugs = parseRecentlyViewed(jar.get(RECENTLY_VIEWED_COOKIE)?.value);

  const [recent, featured, popular] = await Promise.all([
    // All three scoped: a "recently viewed" rail on /templates showing yesterday's
    // CRM is the split leaking, and so is a "featured" rail from the other shop.
    getCardsBySlug(recentSlugs, currency, catalogue),
    getRail("featured", currency, 3, catalogue),
    getRail("popular", currency, 3, catalogue),
  ]);

  return (
    <div className="flex flex-col gap-10">
      {recent.length > 0 && (
        <Rail
          title="Where you left off"
          description="The last few products you looked at."
          cards={recent.slice(0, 3)}
        />
      )}

      <Rail
        title="Featured"
        description="Hand-picked, and usually the most complete."
        cards={featured}
      />

      <Rail
        title="Most bought"
        description="What other teams have actually installed."
        cards={popular}
        href="/marketplace?sort=popular"
      />
    </div>
  );
}

function Rail({
  title,
  description,
  cards,
  href,
}: {
  title: string;
  description: string;
  cards: Awaited<ReturnType<typeof getRail>>;
  href?: string;
}) {
  if (cards.length === 0) return null;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-[17px] tracking-[-0.02em]">{title}</h2>
          <p className="text-muted-foreground text-[13px]">{description}</p>
        </div>
        {href && (
          <Link
            href={href as Route}
            className="text-subtle text-[12.5px] whitespace-nowrap underline underline-offset-4"
          >
            See all
          </Link>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <ProductCardTile key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}
