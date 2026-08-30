import { notFound, permanentRedirect } from "next/navigation";
import type { Route } from "next";
import { categoryLandingPath } from "@/config/catalogue";
import { getTaxonomyIndex } from "@/services/marketplace";
import { categoryBySlug } from "@/services/marketplace/taxonomy-tree";

/**
 * The old category landing URL. Now a 308, and nothing else.
 *
 * Categories moved to `/marketplace/{parent}` and `/marketplace/{parent}/{child}`
 * when the vocabulary gained a second tier. This route stays because every URL
 * indexed under the old shape, every inbound link and every bookmark runs through
 * it — and a 404 here throws away whatever ranking the catalogue has. **308, not
 * 302**: it is the one search engines transfer ranking through.
 *
 * ## Why it is a page rather than a config entry
 *
 * `next.config.ts` `redirects()` is static, and the destination is not: a child's
 * home is two segments deep and the parent has to be looked up. `proxy.ts` cannot
 * do it either — its docblock forbids database access outright, because the proxy
 * runs on prefetches and a query here would multiply traffic by the number of
 * links on a page.
 *
 * ## The lookup is deliberately unscoped
 *
 * Every other landing page passes a catalogue scope so a term belonging to the
 * other shop 404s rather than rendering an empty grid. This one is the opposite
 * case: the question is "where does this term live now", and `categoryLandingPath`
 * answers it from the term's own scope. A `template` category arriving here is
 * sent to `/templates/…`, which is its home.
 *
 * That is also a bug fix. Unscoped *rendering* is what this page used to do, and
 * it meant a template category under `/marketplace/category/` drew a real heading
 * over a scripts-only grid. Redirecting on the same lookup turns the leak into
 * the correct answer.
 *
 * ## No `generateStaticParams`, and no `generateMetadata`
 *
 * A page that always redirects never renders a `<head>`, so metadata would be
 * dead code; and prerendering a route whose every param is a redirect is at best
 * pointless. Three routes here already build under Cache Components with no
 * `generateStaticParams` — `vendors/[slug]`, `customize/[slug]`, `preview/[slug]`
 * — so this is precedented rather than novel.
 *
 * There is no `<Suspense>` in this file, so the guard has nowhere to drift to;
 * `loading-boundaries.test.ts` is satisfied either way.
 */
export default async function Page({ params }: PageProps<"/marketplace/category/[slug]">) {
  const { slug } = await params;

  const taxonomy = await getTaxonomyIndex("all");
  const term = categoryBySlug(taxonomy, slug);
  if (!term) notFound();

  permanentRedirect(categoryLandingPath(term) as Route);
}
