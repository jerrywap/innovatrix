/**
 * URL slugs.
 *
 * A slug is public and semi-permanent: it appears in `/marketplace/atlas-crm`,
 * in every link anyone has ever shared, and in `products.facets` as
 * `"cat:crm"`. So this module is deliberately conservative — it produces a
 * narrow, predictable character set and never silently produces an empty
 * string.
 *
 * `scripts/seed.ts` carried a private copy of this; it should now import from
 * here so the seed and the admin form cannot disagree about what
 * "HR & Rota" slugifies to.
 */

const MAX_SLUG_LENGTH = 80;

/**
 * Turn a human name into a slug.
 *
 * `&` becomes `and` rather than being dropped, because "HR & Rota" → `hr-rota`
 * reads as a typo while `hr-and-rota` reads as a name. Accents are stripped via
 * NFKD so "Café" and "Cafe" collide rather than becoming two categories nobody
 * can tell apart.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    // Combining marks left behind by NFKD — é → e + U+0301.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, "");

  return slug;
}

/** Does this string already look like a slug we would have produced? */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= MAX_SLUG_LENGTH;
}

/**
 * Find a slug not already taken.
 *
 * The suffix is **random, not sequential**. `acme-2` tells the world that
 * `acme` exists — a small disclosure, but a free one to avoid — and a counter
 * needs a read-then-write that races under concurrent creation. A random
 * suffix needs neither.
 *
 * This is a courtesy, not the guarantee: `products.slug` and
 * `{kind, slug}` on taxonomies both carry unique indexes, and those are what
 * actually decide. A caller must still handle the duplicate-key error, because
 * two requests can pass this check simultaneously and only one can win.
 */
export async function uniqueSlug(
  desired: string,
  isTaken: (candidate: string) => Promise<boolean>,
  options: { attempts?: number } = {},
): Promise<string> {
  const base = slugify(desired) || "item";
  const attempts = options.attempts ?? 5;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = attempt === 0 ? base : `${trim(base)}-${suffix()}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // Exhausted the polite attempts. Two suffixes makes a collision vanishingly
  // unlikely, and the unique index is still the backstop if it happens.
  return `${trim(base)}-${suffix()}${suffix()}`;
}

/** Leave room for a suffix without breaching the length cap. */
function trim(base: string): string {
  return base.slice(0, MAX_SLUG_LENGTH - 10).replace(/-+$/g, "");
}

/** No lookalike-ambiguous characters — a slug gets read aloud and retyped. */
function suffix(): string {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  let out = "";
  for (let i = 0; i < 4; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}
