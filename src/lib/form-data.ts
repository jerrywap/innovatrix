/**
 * `FormData` → a nested object, using bracket notation in field names.
 *
 * ## Why `formDataToObject` is not enough
 *
 * The existing helper in `action-result.ts` collapses repeated keys into a
 * positional array. For a flat form that is exactly right. For a **repeater**
 * it is a silent data-corruption bug, and the product pricing form is full of
 * repeaters.
 *
 * Consider three price rows where the middle amount is left blank:
 *
 * ```
 * prices.currency = GBP     prices.amount = 299.99
 * prices.currency = USD     prices.amount =            ← blank, omitted
 * prices.currency = NGN     prices.amount = 598000
 * ```
 *
 * Collapsing by key gives `currency: [GBP, USD, NGN]` and
 * `amount: [299.99, 598000]`. Zipped back together, **NGN is priced at
 * £299.99's amount and the row that was blank silently takes the next row's
 * value**. Nothing throws. Nobody notices until a customer is charged the wrong
 * price in the wrong currency.
 *
 * Naming the fields `prices[0][amount]` removes the class of bug entirely: the
 * index is in the name, so a missing value leaves a hole rather than shifting
 * everything after it.
 *
 * ## Prototype pollution
 *
 * Field names come from a POST body, so `__proto__[isAdmin]=true` is a request
 * anyone can make. Assigning through such a key mutates `Object.prototype` for
 * the whole process. Those keys are dropped, and every object is created with
 * a null prototype so there is nothing to pollute in the first place.
 */

/** Keys that must never be used as an object path segment. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** `a[0][b]` and `a.b` both parse; the bracket form is what forms should use. */
const SEGMENT = /[^[\].]+/g;

export interface ParseOptions {
  /**
   * Fields whose value should stay a `File` rather than being read as text.
   * Uploads normally go straight to storage (ticket 05), so this is rare.
   */
  fileFields?: readonly string[];
  /** Guards against a hand-crafted body nesting a thousand levels deep. */
  maxDepth?: number;
}

/**
 * Parse `FormData` into a nested plain object suitable for `parseInput`.
 *
 * Arrays come back dense and in index order — a form that submits rows 0 and 2
 * yields two entries, not a hole at index 1, because Zod's array schemas do not
 * expect sparse input.
 */
export function parseNestedFormData(
  formData: FormData,
  options: ParseOptions = {},
): Record<string, unknown> {
  const { fileFields = [], maxDepth = 8 } = options;
  const root: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

  for (const [rawKey, rawValue] of formData.entries()) {
    const segments = rawKey.match(SEGMENT);
    if (!segments || segments.length === 0) continue;
    if (segments.length > maxDepth) continue;
    if (segments.some((segment) => FORBIDDEN_KEYS.has(segment))) continue;

    const value =
      rawValue instanceof File && !fileFields.includes(rawKey) ? undefined : rawValue;
    if (value === undefined) continue;

    assign(root, segments, value);
  }

  return densify(root) as Record<string, unknown>;
}

function assign(
  target: Record<string, unknown>,
  segments: string[],
  value: FormDataEntryValue,
) {
  let node: Record<string, unknown> = target;

  for (let i = 0; i < segments.length - 1; i += 1) {
    const key = segments[i]!;
    const existing = node[key];

    if (typeof existing !== "object" || existing === null) {
      node[key] = Object.create(null) as Record<string, unknown>;
    }
    node = node[key] as Record<string, unknown>;
  }

  const last = segments[segments.length - 1]!;

  // A repeated *leaf* name is still a legitimate multi-value field — a group of
  // checkboxes sharing `categoryIds`. Only that case collapses to an array.
  const existing = node[last];
  if (existing === undefined) {
    node[last] = value;
  } else if (Array.isArray(existing)) {
    existing.push(value);
  } else {
    node[last] = [existing, value];
  }
}

/**
 * Turn objects whose keys are all integers into real arrays, and drop the
 * gaps. Recurses depth-first so nested repeaters convert too.
 */
function densify(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof File) return value;
  if (Array.isArray(value)) return value.map(densify);

  const entries = Object.entries(value as Record<string, unknown>);
  const looksLikeArray = entries.length > 0 && entries.every(([key]) => /^\d+$/.test(key));

  if (looksLikeArray) {
    return entries.sort(([a], [b]) => Number(a) - Number(b)).map(([, item]) => densify(item));
  }

  // A plain object again, so callers and Zod see something ordinary. The null
  // prototype was only needed while keys from the request were being assigned.
  const out: Record<string, unknown> = {};
  for (const [key, item] of entries) out[key] = densify(item);
  return out;
}
