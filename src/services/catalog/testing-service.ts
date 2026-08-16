import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { ProductDoc, TestingChecklistItem } from "@/lib/db/models/catalog";
import type { TestingChecklistStatus } from "@/lib/db/enums";
import { NotFoundError } from "@/lib/errors";
import { products } from "@/repositories/product.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { DEFAULT_TESTING_CHECKLIST } from "./readiness";

/**
 * The §47 internal testing checklist.
 *
 * ## Who checked it, and when, is the point
 *
 * The checklist's value is not the ticks — it is that a named person put their
 * name against "security review" on a date. Without `checkedByUserId` and
 * `checkedAt` this is a row of booleans anyone could have set, which is
 * indistinguishable from nobody having looked.
 *
 * So a status change stamps both, and **re-stamps them on every change**: if an
 * item goes from `pass` back to `fail`, the record should say who failed it now,
 * not who passed it last month.
 *
 * ## What "complete" means is in `readiness.ts`, not here
 *
 * `checklistState()` decides that an empty checklist is incomplete and that `na`
 * needs a note. Duplicating that rule here would let the two disagree, and the
 * one that matters — the publish gate — would be the one nobody looked at.
 */

export interface ChecklistItemInput {
  item: string;
  status: TestingChecklistStatus;
  notes?: string;
}

export async function saveChecklist(
  productId: string,
  items: readonly ChecklistItemInput[],
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  const previousByItem = new Map(
    (product.testingChecklist ?? []).map((entry) => [entry.item, entry]),
  );
  const checkedByUserId = actor.type === "staff" ? toObjectId(actor.userId) : undefined;
  const now = new Date();

  const checklist: TestingChecklistItem[] = items.map((input) => {
    const previous = previousByItem.get(input.item);
    const statusChanged = previous?.status !== input.status;

    return {
      item: input.item,
      status: input.status,
      ...(input.notes ? { notes: input.notes } : {}),
      // Unchanged rows keep whoever checked them originally — re-saving the
      // form to edit one item must not relabel the other nine as checked today
      // by whoever happened to open the page.
      ...(statusChanged
        ? {
            ...(checkedByUserId ? { checkedByUserId } : {}),
            ...(input.status === "pending" ? {} : { checkedAt: now }),
          }
        : {
            ...(previous?.checkedByUserId ? { checkedByUserId: previous.checkedByUserId } : {}),
            ...(previous?.checkedAt ? { checkedAt: previous.checkedAt } : {}),
          }),
    };
  });

  const saved = await products.updateById(productId, { $set: { testingChecklist: checklist } });
  if (!saved) throw new NotFoundError("product", { id: productId });

  const changed = checklist.filter(
    (entry) => previousByItem.get(entry.item)?.status !== entry.status,
  );

  // Only write an audit row when something actually moved. Saving a form with
  // no changes is not an event, and §90's log is less useful the more of it is
  // noise.
  if (changed.length > 0) {
    await writeAuditLog({
      action: "product.testing_updated",
      actor,
      subject: { type: "product", id: productId },
      after: {
        changed: changed.map((entry) => ({ item: entry.item, status: entry.status })),
      },
    });
  }

  return saved;
}

/**
 * The checklist to render — stored rows, plus any §47 item that is missing.
 *
 * A product created before an item was added to `DEFAULT_TESTING_CHECKLIST`
 * would otherwise never be asked about it, and would pass the publish gate
 * without it. Merging on read means adding a required check applies to
 * everything not yet published, which is the point of adding one.
 */
export function checklistFor(product: ProductDoc): TestingChecklistItem[] {
  const stored = product.testingChecklist ?? [];
  const seen = new Set(stored.map((entry) => entry.item));

  const missing: TestingChecklistItem[] = DEFAULT_TESTING_CHECKLIST.filter(
    (item) => !seen.has(item),
  ).map((item) => ({ item, status: "pending" as const }));

  return [...stored, ...missing];
}
