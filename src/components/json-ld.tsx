import { publicEnv } from "@/config/public-env";

/**
 * Site-wide structured data, and the shared renderer — §93.
 *
 * ## Why `dangerouslySetInnerHTML`
 *
 * There is no alternative for a `<script>`: JSX escapes its children, and an
 * escaped `&quot;` inside `application/ld+json` is invalid JSON that Google
 * silently drops. The input is always a **typed object** put through
 * `JSON.stringify`, never a string, and `</script>` inside a value is escaped
 * below. `json-ld.tsx` in `features/product` carries the same note — this is
 * the second and last sanctioned use.
 */

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escapeForScript(JSON.stringify(data)) }}
    />
  );
}

/**
 * `Organization` + `WebSite`, once, in the public layout.
 *
 * `Organization` is what lets a search engine associate the name, logo and
 * links with an entity rather than a string. `WebSite` carries
 * `SearchAction`, which is what a sitelinks search box is built from.
 *
 * Both are `@id`-anchored on the origin so the product pages' `seller` can
 * refer to the same entity rather than declaring a second one with the same
 * name — two Organizations called CoSetup is worse than none.
 */
export function SiteJsonLd({ origin }: { origin: string }) {
  const name = publicEnv.NEXT_PUBLIC_APP_NAME;

  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@graph": [
          {
            "@type": "Organization",
            "@id": `${origin}/#organization`,
            name,
            url: origin,
            description:
              "A software acquisition and delivery platform: buy what already exists, " +
              "have it adapted, or commission it outright.",
          },
          {
            "@type": "WebSite",
            "@id": `${origin}/#website`,
            url: origin,
            name,
            publisher: { "@id": `${origin}/#organization` },
            potentialAction: {
              "@type": "SearchAction",
              target: {
                "@type": "EntryPoint",
                urlTemplate: `${origin}/marketplace?q={search_term_string}`,
              },
              "query-input": "required name=search_term_string",
            },
          },
        ],
      }}
    />
  );
}

export interface Crumb {
  name: string;
  /** Absolute path. Omitted on the last crumb, which is the current page. */
  path?: string;
}

/**
 * `BreadcrumbList` — §93.
 *
 * Mirrors the visible breadcrumb rather than inventing a second hierarchy: the
 * structured data and the rendered nav disagreeing is a policy violation, not
 * just untidy. The final crumb deliberately has no `item`, which is how
 * schema.org expresses "you are here".
 */
export function BreadcrumbJsonLd({ crumbs, origin }: { crumbs: Crumb[]; origin: string }) {
  return (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: crumbs.map((crumb, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: crumb.name,
          ...(crumb.path ? { item: `${origin}${crumb.path}` } : {}),
        })),
      }}
    />
  );
}

/**
 * `</script>` inside a product name would end the block early and turn the rest
 * of the JSON into markup. Escaping `<` is the standard fix and stays valid
 * JSON — `<` parses back to `<`.
 */
function escapeForScript(json: string): string {
  return json.replace(/</g, "\\u003c");
}
