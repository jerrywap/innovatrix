import { z } from "zod";
import { REVIEW_REPORT_REASONS, REVIEW_STATUSES } from "@/lib/db/enums";
import { objectIdSchema, optionalText } from "@/validators/common";

/**
 * Review form schemas — vendor ticket 10.
 *
 * Neither `"use server"` nor `"server-only"`, so a client component validates against the
 * same module the action does.
 *
 * Note what a customer's form does **not** carry: no `productId`. The entitlement names the
 * product, the organisation and the version, so there is no field in which to claim to be
 * reviewing something else.
 */

/** 1–5, whole stars. A half-star average is derived; a half-star *rating* is not offered. */
const ratingSchema = z.coerce
  .number()
  .int("Whole stars only.")
  .min(1, "Pick between one and five stars.")
  .max(5, "Pick between one and five stars.");

/**
 * The body has a floor as well as a ceiling.
 *
 * "ok" is a rating, not a review, and a page of one-word reviews is worse than a page with
 * none — it looks like a product nobody could be bothered to describe. Twenty characters is
 * roughly a sentence.
 */
const bodySchema = z
  .string()
  .trim()
  .min(20, "A sentence or two — what did it do well, or badly?")
  .max(4000);

export const reviewSubmitSchema = z.object({
  entitlementId: objectIdSchema,
  rating: ratingSchema,
  title: optionalText(120),
  body: bodySchema,
});

export const reviewEditSchema = z.object({
  reviewId: objectIdSchema,
  rating: ratingSchema,
  title: optionalText(120),
  body: bodySchema,
});

export const reviewDismissSchema = z.object({ entitlementId: objectIdSchema });

export const vendorResponseSchema = z.object({
  reviewId: objectIdSchema,
  body: z.string().trim().min(2, "Say something.").max(2000),
});

export const reviewReportSchema = z.object({
  reviewId: objectIdSchema,
  reason: z.enum(REVIEW_REPORT_REASONS),
  detail: optionalText(1000),
});

/**
 * Moderation.
 *
 * `published` is in the enum so a hidden review can be restored — hiding is meant to be
 * reversible, and a one-way door would make staff hesitate to use it.
 */
export const reviewModerateSchema = z.object({
  reviewId: objectIdSchema,
  status: z.enum(REVIEW_STATUSES),
  reason: optionalText(500),
});
