import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { SavedProduct, SearchLog } from "@/lib/db/models/catalog";

/**
 * Bookmarks and zero-result search logging — §6, §74.
 *
 * Both are small, both are the kind of thing that grows a subtle bug if written
 * inline in an action, and both are deliberately **not** org-scoped — see
 * `SavedProductDoc` for why a bookmark belongs to a person.
 */

/**
 * Save or unsave, returning the new state.
 *
 * A toggle rather than separate calls, because the button is a toggle and
 * splitting it invites the two halves to disagree about what "already saved"
 * means. The unique index makes a double-click idempotent rather than a
 * duplicate-key error.
 */
export async function toggleSaved(
  userId: string,
  productId: string,
): Promise<{ saved: boolean }> {
  await connectToDatabase();

  const filter = { userId: toObjectId(userId), productId: toObjectId(productId) };
  const removed = await SavedProduct.deleteOne(filter);
  if (removed.deletedCount > 0) return { saved: false };

  try {
    await SavedProduct.create(filter);
  } catch (error) {
    // Two clicks racing: the index refused the second insert, and the correct
    // answer is still "it is saved".
    if (!isDuplicateKey(error)) throw error;
  }

  return { saved: true };
}

export async function isSaved(userId: string, productId: string): Promise<boolean> {
  await connectToDatabase();

  const exists = await SavedProduct.exists({
    userId: toObjectId(userId),
    productId: toObjectId(productId),
  });

  return exists !== null;
}

/** Which of these products this user has saved — one query for a whole grid. */
export async function savedAmong(
  userId: string,
  productIds: readonly string[],
): Promise<Set<string>> {
  if (productIds.length === 0) return new Set();
  await connectToDatabase();

  const rows = await SavedProduct.find({
    userId: toObjectId(userId),
    productId: { $in: productIds.map((id) => toObjectId(id)) },
  })
    .select({ productId: 1 })
    .lean();

  return new Set(rows.map((row) => String(row.productId)));
}

/** The `/dashboard/saved` list, newest first. Bounded, per §94. */
export async function listSavedProductIds(userId: string, limit = 100): Promise<string[]> {
  await connectToDatabase();

  const rows = await SavedProduct.find({ userId: toObjectId(userId) })
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .select({ productId: 1 })
    .lean();

  return rows.map((row) => String(row.productId));
}

/* ────────────────────────────────────────────── zero-result searches */

/**
 * Record a search that found nothing — §74.
 *
 * ## Never throws
 *
 * This runs on the read path of a page that has already decided what to render.
 * A failed write here must not turn "no results, here are some categories" into
 * a 500 — the log is a business input, not part of the response.
 *
 * ## Normalised before it is counted
 *
 * `"CRM  "`, `"crm"` and `"C R M"` are the same question asked three ways. The
 * whole value of this collection is that a human can read it and see what is in
 * demand, and three spellings of one term buries the signal.
 */
export async function logZeroResultSearch(
  term: string,
  options: { hadFilters?: boolean } = {},
): Promise<void> {
  const normalised = term.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 120);

  // A single character tells nobody anything, and a visitor mid-typing
  // generates one of these per keystroke.
  if (normalised.length < 3) return;

  try {
    await connectToDatabase();
    await SearchLog.updateOne(
      { term: normalised },
      {
        $inc: { count: 1 },
        $set: { lastSeenAt: new Date(), hadFilters: Boolean(options.hadFilters) },
      },
      { upsert: true },
    );
  } catch (error) {
    console.warn("[marketplace] could not log a zero-result search", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** The list somebody actually reads — most-asked first. */
export async function topMissedSearches(limit = 50) {
  await connectToDatabase();

  return SearchLog.find({})
    .sort({ count: -1, lastSeenAt: -1 })
    .limit(Math.min(limit, 200))
    .lean();
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  );
}
