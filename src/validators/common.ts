import { z } from "zod";
import { CURRENCIES, fromDecimal, type CurrencyCode } from "@/lib/money";
import { REFERENCE_PREFIXES } from "@/lib/references";

/**
 * Shared Zod primitives.
 *
 * These import the *same* constants the Mongoose schemas use, so a currency or
 * a reference prefix added in one place is immediately valid in the other.
 * There is no second list to keep in sync.
 */

export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, "Not a valid id");

export const currencySchema = z.enum(
  Object.keys(CURRENCIES) as [keyof typeof CURRENCIES, ...(keyof typeof CURRENCIES)[]],
);

/** Money on the wire is always minor units — never a decimal (§84). */
export const moneySchema = z.object({
  amount: z.number().int("Money must be an integer in minor units"),
  currency: currencySchema,
});

export const positiveMoneySchema = moneySchema.extend({
  amount: z.number().int().positive(),
});

export const referenceSchema = z
  .string()
  .regex(
    new RegExp(`^(${Object.keys(REFERENCE_PREFIXES).join("|")})-\\d{4}-\\d{4,}$`),
    "Not a valid business reference",
  );

export const slugSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and hyphens");

/**
 * The same rule, as HTML input attributes — spread onto any field that stores a slug.
 *
 * ## Why this exists rather than four hand-written `pattern` attributes
 *
 * There were four, on the licence-package key, the add-on key, the product address and the
 * taxonomy address, and **none of them had a `title`**. A `pattern` with no `title` makes the
 * browser say "Please match the requested format." and nothing else: the field is refused, the
 * rule is never stated, and there is no way to find out what it is. A vendor reported exactly
 * that on the licence key.
 *
 * They had also drifted. `[a-z0-9]+(-[a-z0-9]+)*` accepts a single character while `slugSchema`
 * requires two, so `"a"` passed the browser and was refused by the server — the form saying yes
 * and the action saying no about the same value.
 *
 * Keeping the pair here, four lines apart, is what makes them hard to separate: changing the Zod
 * rule without changing this is a diff that reads wrong.
 *
 * The `title` wording matches the Zod message deliberately, so the browser bubble and a
 * server-side field error say the same thing rather than two versions of it.
 */
export const SLUG_INPUT_ATTRS = {
  pattern: "[a-z0-9]+(-[a-z0-9]+)*",
  minLength: 2,
  maxLength: 80,
  title:
    "Lowercase letters, numbers and hyphens — at least two characters, like “single-site”.",
} as const;

/**
 * Pagination. Mirrors the repository's clamp (ticket 01) so an over-large
 * `limit` is rejected at the boundary rather than silently reduced later —
 * the caller finds out they asked for too much.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const sortDirectionSchema = z.enum(["asc", "desc"]).default("desc");

/**
 * An HTML checkbox or switch, as it actually arrives.
 *
 * An unchecked box sends **nothing at all** — the key is simply absent — so the
 * schema has to be optional and default to false. `z.coerce.boolean()` cannot
 * be used here: it is `Boolean(input)`, which makes the string `"false"` true.
 */
export const checkboxSchema = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean()])
  .optional()
  .transform((v) => v === "on" || v === "true" || v === true);

/** Trims, and turns "" into undefined so empty form fields don't become empty strings. */
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === "" ? undefined : v));

/* ────────────────────────────────────────────── "" is not `undefined` */

/**
 * The gap `optionalText` closed for strings, closed for everything else.
 *
 * `z.url().optional()` accepts `undefined` — and **an empty text input submits
 * `""`**, not `undefined`. So every field written that way is labelled
 * "(optional)" and then refuses to save while blank, with the message "Invalid
 * URL" pointing at a field the person deliberately left empty. That shipped on
 * the SEO share image and on all three demo URLs, whose own hint says "leave
 * blank if there isn't one".
 *
 * `optionalText` above already had the answer; what was missing was a sibling
 * for the non-string cases, so each call site hand-wrote `.optional()` and
 * inherited the bug. These live four lines from it so the family is hard to
 * separate.
 *
 * ## Why `z.preprocess` and not `z.union([z.literal(""), inner])`
 *
 * A union reports failure as `invalid_union`, which renders as "Invalid input"
 * and loses the inner schema's message. The whole complaint being fixed here is
 * that the message was unhelpful, so a fix that degrades the message on a
 * *genuinely* malformed value trades one bad error for another.
 *
 * Trimming happens here rather than in each schema, because `" "` in a URL field
 * is the same intent as `""` and neither is a URL.
 */
const blankToUndefined = <T extends z.ZodType>(inner: T) =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed === "" ? undefined : trimmed;
  }, inner.optional());

/**
 * A URL field that is allowed to be empty.
 *
 * The default message names the shape wanted instead of judging the input:
 * "Invalid URL" does not tell somebody who typed `example.com` that the scheme
 * is what is missing.
 */
export const optionalUrl = (error = "Enter a full address, like https://example.com") =>
  blankToUndefined(z.url(error));

/**
 * An id field that is allowed to be empty — a `<select>` with nothing chosen.
 *
 * A native `<select>` whose selected option has `value=""` submits `""`, which
 * is precisely the state "no specific type" needs to be expressible. Without
 * this the field cannot be left alone *or* cleared once set.
 */
export const optionalId = () => blankToUndefined(objectIdSchema);

/**
 * A number field that is allowed to be empty, falling back to a stated default.
 *
 * `z.coerce.number()` on `""` is **`0`**, because `Number("")` is `0` — so a
 * blank "Activations" reported "Too small: expected >=1" and a blank support
 * period silently became zero months rather than the twelve the placeholder
 * promised. Coercion has to be reached only once there is something to coerce.
 *
 * `min` defaults to 0 rather than being required: the bounds that matter are
 * always the upper one and the fallback, and a required `min: 0` at every call
 * site is noise that invites a copy-paste of the wrong number.
 */
export const countFromForm = (fallback: number, bounds: { min?: number; max: number }) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce
      .number()
      .int()
      .min(bounds.min ?? 0)
      .max(bounds.max)
      .default(fallback),
  );

export const emailSchema = z.email().toLowerCase().trim();

/* ────────────────────────────────────────────── money from a form */

/**
 * A price typed by a human — `299.99` — parsed into integer minor units.
 *
 * ## Why not `z.coerce.number().transform((n) => n * 100)`
 *
 * Three reasons, each of which has cost somebody real money somewhere:
 *
 * 1. **The exponent is per currency.** JPY has none, so `× 100` turns ¥1,000
 *    into ¥100,000. `fromDecimal` reads the exponent from the `CURRENCIES`
 *    registry, which is why the currency has to be known here rather than
 *    applied later.
 * 2. **Floats.** `29.99 * 100` is `2998.9999999999995`. `fromDecimal` rounds
 *    half-up at the currency's precision.
 * 3. **Pasted values.** `1,299.99` and `£1 299.99` are what comes out of a
 *    spreadsheet. `fromDecimal` strips separators; `Number()` returns `NaN`.
 *
 * ## The try/catch is load-bearing
 *
 * `fromDecimal` throws `MoneyError`, which is **not** a `DomainError` — so an
 * uncaught one is logged and returned to the customer as the generic "something
 * went wrong" rather than as "check this field". Catching it here turns a bad
 * amount into an ordinary field error. Never let `MoneyError` escape a
 * validator.
 */
export const decimalAmountSchema = (currency: CurrencyCode) =>
  z.union([z.string(), z.number()]).transform((value, ctx) => {
    try {
      return fromDecimal(value, currency).amount;
    } catch {
      ctx.addIssue({ code: "custom", message: "Enter an amount like 299.99" });
      return z.NEVER;
    }
  });

/**
 * A whole per-currency price map, as the pricing form submits it.
 *
 * Fixed rows keyed by currency code — `prices[GBP]`, `prices[USD]` — rather
 * than an indexed array of `{currency, amount}` pairs. Two things fall out:
 * index-pairing cannot misalign when a row is left blank, and "not sold in this
 * currency" is expressible as **an empty field**, which is what an admin would
 * do anyway (§43).
 *
 * Empty and whitespace-only entries are dropped rather than rejected, so
 * clearing a price is how you withdraw a currency.
 */
export const priceMapSchema = z
  .record(z.string(), z.union([z.string(), z.number()]).optional())
  .transform((raw, ctx) => {
    const prices: Array<{ currency: CurrencyCode; amount: number }> = [];

    for (const [code, value] of Object.entries(raw)) {
      if (value === undefined || String(value).trim() === "") continue;

      if (!(code in CURRENCIES)) {
        ctx.addIssue({ code: "custom", path: [code], message: `Unknown currency ${code}.` });
        continue;
      }

      try {
        prices.push(fromDecimal(value, code as CurrencyCode));
      } catch {
        ctx.addIssue({
          code: "custom",
          path: [code],
          message: "Enter an amount like 299.99, or leave it blank.",
        });
      }
    }

    return prices;
  });
