import Link from "next/link";
import Image from "next/image";
import type { Route } from "next";

/**
 * What the product does today, in the listing's own words.
 *
 * ## Why the page needed this
 *
 * `/customize/[slug]` put the product's name in the heading and then showed the
 * customer nothing else about it. Three opener chips — "I want to change how it
 * looks", "I need it to work differently", "I need it to connect to something
 * else" — were true of every one of the thousand products in the catalogue, which
 * is what made them useless: a chip that would fit anything tells you nothing
 * about what you are looking at. So the customer was asked what they wanted
 * changed about something the page declined to describe.
 *
 * This is the concrete material to react to. "Pipeline stages — move an enquiry
 * from first contact to won or lost" is a thing you can point at and say *that,
 * but for jobs rather than enquiries*, which is a requirement. "I need it to work
 * differently" is not.
 *
 * ## It quotes, it does not summarise
 *
 * Every line is the listing's own text: the summary, the vendor's feature titles
 * and details, the category and industry terms. Nothing here is generated from
 * them, and nothing is inferred. That is not a stylistic preference — a
 * paraphrase of a capability is a claim about a capability, and
 * `options-form.tsx` puts it plainly to whoever writes these fields: an offer it
 * cannot honour is worse than no offer. We are further from the software than
 * they are.
 *
 * ## No price, anywhere
 *
 * The customer is one click from the listing, where the price is. Repeating it
 * beside an interview about work nobody has scoped invites exactly the arithmetic
 * §73 forbids — and puts a figure on screen next to an assistant that is not
 * allowed to discuss figures.
 */
export interface ListingSummary {
  name: string;
  slug: string;
  summary: string;
  category?: string;
  industry?: string;
  features: { title: string; detail?: string }[];
  image?: { url: string; alt: string };
}

export function ListingPanel({ listing }: { listing: ListingSummary }) {
  // Six is where a reference panel becomes a page. The listing has the rest.
  const shown = listing.features.slice(0, 6);
  const hidden = listing.features.length - shown.length;

  return (
    <aside className="border-border bg-surface flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
      <div className="flex items-start gap-3.5">
        {listing.image && (
          <span className="border-border bg-surface-muted relative size-12 shrink-0 overflow-hidden rounded-xl border">
            <Image
              src={listing.image.url}
              alt={listing.image.alt}
              fill
              sizes="48px"
              className="object-cover"
            />
          </span>
        )}

        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            What you&rsquo;re changing
          </p>
          <h2 className="font-display text-[16px] leading-tight tracking-[-0.02em]">
            {listing.name}
          </h2>
          {(listing.category || listing.industry) && (
            <p className="text-subtle text-[12px]">
              {[listing.category, listing.industry].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      </div>

      <p className="text-muted-foreground text-[13px] leading-relaxed">{listing.summary}</p>

      {shown.length > 0 && (
        <div className="border-border flex flex-col gap-2.5 border-t pt-4">
          <p className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            What it does now
          </p>

          {/*
            A list, not cards. The brief is explicit about not nesting a rounded
            rectangle inside a rounded rectangle, and six of them inside this
            panel would be exactly that — while making a reference list look like
            six things to act on.
          */}
          <ul className="flex flex-col gap-2">
            {shown.map((feature) => (
              <li key={feature.title} className="text-[13px] leading-snug">
                <span className="font-medium">{feature.title}</span>
                {feature.detail && (
                  <span className="text-muted-foreground"> &mdash; {feature.detail}</span>
                )}
              </li>
            ))}
          </ul>

          {hidden > 0 && (
            <p className="text-subtle text-[12px]">
              and {hidden} more on the{" "}
              <Link
                href={`/marketplace/${listing.slug}` as Route}
                className="underline underline-offset-2"
              >
                listing
              </Link>
              .
            </p>
          )}
        </div>
      )}

      {/*
        Said here rather than left implied. Somebody reading a feature list is
        deciding whether to ask for a change to one of them, and the honest state
        of that question is "ask, and a person will tell you" — the assistant is
        forbidden from confirming feasibility and should not be the one to imply
        it either.
      */}
      <p className="text-subtle border-border border-t pt-3 text-[12px] leading-relaxed">
        Anything here can be changed, removed or added to. Say what you need and we&rsquo;ll
        tell you what it takes.
      </p>
    </aside>
  );
}
