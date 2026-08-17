import type { ActionResult } from "@/lib/action-result";

/**
 * The actions a version panel needs, as one object.
 *
 * Vendor ticket 06 gave versions and files a **second surface**: staff at
 * `/admin/products/[id]/versions` and a vendor at
 * `/dashboard/selling/products/[id]/versions`. The components are the same because
 * the model is; what differs is the guard, the scope and the audit actor behind each
 * action.
 *
 * One prop rather than nine. Nine optional action props on three components is a
 * prop-drill nobody keeps in step, and the failure is silent — a component still
 * renders, it just calls the staff action from the vendor's screen and gets a 403 the
 * vendor cannot act on.
 *
 * Each surface's **page** builds the set from its own action module, so a server
 * action reference crosses the RSC boundary as a reference (which is allowed) and no
 * component imports an action it should not be able to call.
 */
export interface VersionActionSet {
  createVersion: FormAction;
  updateVersion: FormAction;
  releaseVersion: FormAction;
  deprecateVersion: FormAction;
  deleteVersion: FormAction;
  removeFile: FormAction;
  requestUpload: (
    input: unknown,
  ) => Promise<
    ActionResult<{
      url: string;
      key: string;
      headers: Record<string, string>;
      expiresAt: string;
    }>
  >;
  confirmUpload: (input: unknown) => Promise<ActionResult<{ fileId: string }>>;
  downloadUrl: (fileId: string) => Promise<ActionResult<{ url: string }>>;
}

type FormAction = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;
