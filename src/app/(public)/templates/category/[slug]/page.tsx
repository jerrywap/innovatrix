import { notFound, permanentRedirect } from "next/navigation";
import type { Route } from "next";
import { categoryLandingPath } from "@/config/catalogue";
import { getTaxonomyIndex } from "@/services/marketplace";
import { categoryBySlug } from "@/services/marketplace/taxonomy-tree";

/**
 * The old template-category landing URL — a 308, like its marketplace twin.
 *
 * Same reasoning in full at `marketplace/category/[slug]/page.tsx`: the
 * destination needs a database lookup so it cannot be a `next.config.ts` entry or
 * a `proxy.ts` rule, the lookup is unscoped because the question is where a term
 * lives rather than whether this shop may show it, and a page that always
 * redirects needs neither `generateStaticParams` nor `generateMetadata`.
 *
 * The one asymmetry worth stating: a `script`-scoped term arriving here is sent
 * to `/marketplace/…`. That is not a leak, it is the ownership rule — a term has
 * exactly one home and `categoryLandingPath` is the only thing that decides which.
 */
export default async function Page({ params }: PageProps<"/templates/category/[slug]">) {
  const { slug } = await params;

  const taxonomy = await getTaxonomyIndex("all");
  const term = categoryBySlug(taxonomy, slug);
  if (!term) notFound();

  permanentRedirect(categoryLandingPath(term) as Route);
}
