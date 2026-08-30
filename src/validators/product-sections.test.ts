import { describe, expect, it } from "vitest";
import {
  productBasicsSchema,
  licencePackageFormSchema,
  classificationWithPrimary,
  productClassificationSchema,
  productDemoSchema,
  productMediaSchema,
  productSeoSchema,
} from "./product-sections";

/**
 * The four reported wizard bugs, at the schemas that caused them.
 *
 * `common.test.ts` covers the helpers; this covers the wiring. Both are needed,
 * because the bug was never in the helper — `optionalText` was always right — it
 * was that each call site hand-wrote `.optional()` and inherited the same hole.
 * A correct helper nobody reached for is what shipped four broken fields.
 *
 * Pure: `FormData`-shaped plain objects in, parsed values out.
 */

describe("SEO — “says optional but still validates if empty”", () => {
  it("saves with every field blank", () => {
    // The report, verbatim: "SEO says optional but still validate if empty
    // Please check the highlighted fields. / Invalid URL".
    const result = productSeoSchema.parse({
      seo: { title: "", description: "", ogImageUrl: "" },
    });

    expect(result.seo).toEqual({
      title: undefined,
      description: undefined,
      ogImageUrl: undefined,
    });
  });

  it("still refuses a share image that is not a URL", () => {
    expect(
      productSeoSchema.safeParse({ seo: { ogImageUrl: "example.com/og.png" } }).success,
    ).toBe(false);
  });
});

describe("demo — the same hole, and its own hint told people to leave it blank", () => {
  it("saves with all three URLs blank", () => {
    // The demo step's hint says "Leave blank if there isn't one" and then the
    // step could not be saved that way. Not reported, and it would have been.
    const result = productDemoSchema.parse({
      demo: { exposure: "authenticated", publicUrl: "", customerUrl: "", adminUrl: "" },
    });

    expect(result.demo.publicUrl).toBeUndefined();
    expect(result.demo.customerUrl).toBeUndefined();
    expect(result.demo.adminUrl).toBeUndefined();
  });

  it("saves a credential row whose optional URL is blank", () => {
    const result = productDemoSchema.parse({
      demo: {
        exposure: "authenticated",
        credentials: [{ role: "Admin", url: "", username: "admin", password: "hunter2" }],
      },
    });

    expect(result.demo.credentials[0]!.url).toBeUndefined();
  });
});

describe("classification — “selecting product type is not free”", () => {
  it("saves with no product type chosen", () => {
    // A native `<select>` whose selected option is `value=""` submits `""`, and
    // `objectIdSchema.optional()` answered "Not a valid id" — so a field labelled
    // "(optional)" made the whole step unsaveable on a fresh draft.
    const result = productClassificationSchema.parse({ productTypeId: "" });
    expect(result.productTypeId).toBeUndefined();
  });

  it("clears a type that was previously set", () => {
    // Absent is not merely tolerated, it is the instruction: `saveClassification`
    // routes it to `$unset`. Without an empty option there was no way back.
    expect(productClassificationSchema.parse({}).productTypeId).toBeUndefined();
  });

  /**
   * This one pins current behaviour as **intended**, which is the point of it.
   *
   * An unticked checkbox submits nothing at all, so an absent `categoryIds` is
   * indistinguishable from "the editor cleared every category" — and `[]` is the
   * right reading, because clearing has to be possible.
   *
   * That is what made the data loss the *form's* bug rather than the schema's:
   * React's pre-action `form.reset()` reverted the Radix checkboxes to first
   * paint, they submitted nothing, and the next save wrote these empty arrays
   * over what had just been stored — reporting success. Fixing it here would have
   * been fixing the wrong layer, and would have removed the ability to clear.
   */
  it("reads absent taxonomy lists as an explicit empty selection", () => {
    const result = productClassificationSchema.parse({});
    expect(result.categoryIds).toEqual([]);
    expect(result.industryIds).toEqual([]);
    expect(result.technologyIds).toEqual([]);
  });
});

describe("media — an uploaded file with no URL field", () => {
  it("accepts a row carrying a storage key and a blank url", () => {
    // The two are alternatives, and the uploader fills exactly one. Before this,
    // the blank half of the pair failed with "Invalid URL" and the friendlier
    // refine below never got to speak.
    const result = productMediaSchema.parse({
      media: [{ kind: "screenshot", storageKey: "products/x/a.png", url: "", alt: "A list" }],
    });

    expect(result.media[0]!.url).toBeUndefined();
    expect(result.media[0]!.storageKey).toBe("products/x/a.png");
  });

  it("lets the readable refine reject a row with neither", () => {
    const result = productMediaSchema.safeParse({
      media: [{ kind: "screenshot", storageKey: "", url: "", alt: "" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toBe(
        "Every image needs either an uploaded file or a URL.",
      );
    }
  });

  it("defaults a blank sort order to zero rather than refusing it", () => {
    const result = productMediaSchema.parse({
      media: [{ kind: "screenshot", url: "https://example.test/a.png", sortOrder: "" }],
    });
    expect(result.media[0]!.sortOrder).toBe(0);
  });
});

describe("licence packages — blank numbers keep their advertised defaults", () => {
  it("falls back to 1 / 12 / 12 instead of 0 / 0 / 0", () => {
    // `Number("")` is 0. So a blank Activations field reported "Too small:
    // expected >=1" — an unexplained refusal — while blank support and update
    // periods quietly stored zero months, which is wrong data rather than an
    // error, and would only surface as a customer's expired licence.
    const result = licencePackageFormSchema.parse({
      key: "single",
      name: "Single installation",
      licenceType: "single_installation",
      activationLimit: "",
      supportMonths: "",
      updateMonths: "",
      prices: {},
    });

    expect(result.activationLimit).toBe(1);
    expect(result.supportMonths).toBe(12);
    expect(result.updateMonths).toBe(12);
  });
});

describe("basics — the description arrives as JSON text, not an object", () => {
  /**
   * The bug this pins.
   *
   * `RichTextEditor` posts the tree as JSON in a hidden input, and no form
   * flattener decodes a *value*. The schema said `richTextDocumentSchema`, so
   * every save from the Basics step failed with "expected object, received
   * string" — on both surfaces, for as long as the step existed. Four actions had
   * each grown a private `JSON.parse` wrapper; the two shared section-save paths
   * had none.
   */
  const doc = JSON.stringify({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }],
  });

  const basics = (description: unknown) =>
    productBasicsSchema.safeParse({
      name: "Atlas CRM",
      summary: "A CRM for small teams",
      description,
    });

  it("accepts the editor's JSON string", () => {
    const result = basics(doc);
    expect(result.success).toBe(true);
    expect(result.data?.description?.type).toBe("doc");
  });

  it("treats a blank field as no description, so clearing one works", () => {
    for (const blank of ["", "   "]) {
      const result = basics(blank);
      expect(result.success, blank).toBe(true);
      expect(result.data?.description).toBeUndefined();
    }
  });

  it("accepts an already-decoded object, so a pre-decoding caller is not broken", () => {
    const result = basics({ type: "doc", content: [] });
    expect(result.success).toBe(true);
    expect(result.data?.description?.type).toBe("doc");
  });

  /**
   * The hazard beside the bug, and the reason this is not `.catch(undefined)`.
   *
   * `descriptionFields()` turns `undefined` into a `$unset`. Every private wrapper
   * this replaced mapped unreadable input to `undefined` — so a corrupted payload
   * silently erased a description that had been fine a moment earlier. It has to
   * fail instead.
   */
  it("refuses unreadable JSON rather than wiping the description", () => {
    const result = basics("{not json");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["description"]);
    expect(result.error?.issues[0]?.message).toMatch(/could not read/i);
  });

  it("still enforces the node allowlist through the decode", () => {
    const script = JSON.stringify({
      type: "doc",
      content: [{ type: "script", content: [] }],
    });
    expect(basics(script).success).toBe(false);
  });
});

describe("classificationWithPrimary", () => {
  const CAT_A = "6a8355409d4bd1e3ed755b30";
  const CAT_B = "6a8355409d4bd1e3ed755b31";
  const GONE = "6a8355409d4bd1e3ed755b32";

  /**
   * The primary is always a member of `categoryIds`. Each of these three is the
   * shape of a real request, and each fails **silently** if the rule slips: a
   * breadcrumb naming a term the product does not carry, or a canonical pointing
   * at a landing page it does not appear on.
   */
  it("falls back to the first category when none is submitted", () => {
    // The ordinary path — the form omits the field entirely when there is only
    // one category, because there is nothing to choose.
    const result = classificationWithPrimary.parse({ categoryIds: [CAT_A, CAT_B] });
    expect(result.primaryCategoryId).toBe(CAT_A);
  });

  it("keeps a submitted primary that is one of the categories", () => {
    const result = classificationWithPrimary.parse({
      categoryIds: [CAT_A, CAT_B],
      primaryCategoryId: CAT_B,
    });
    expect(result.primaryCategoryId).toBe(CAT_B);
  });

  it("falls back rather than rejecting a primary that is not among them", () => {
    // A stale form, or a hand-posted body. A validation error here would be a
    // dead end the person cannot act on; the first category is a correct answer.
    const result = classificationWithPrimary.parse({
      categoryIds: [CAT_A],
      primaryCategoryId: GONE,
    });
    expect(result.primaryCategoryId).toBe(CAT_A);
  });

  it("clears it when there are no categories at all", () => {
    // `undefined` is what `saveClassification` turns into an `$unset`, so this is
    // what stops a stripped product keeping a dangling pointer.
    const result = classificationWithPrimary.parse({ categoryIds: [] });
    expect(result.primaryCategoryId).toBeUndefined();
  });
});
