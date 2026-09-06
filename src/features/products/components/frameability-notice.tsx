import "server-only";
import { MonitorX } from "lucide-react";
import { frameabilityOf } from "@/services/marketplace/frameability";
import { embeddable } from "@/features/preview/targets";
import type { AdminProductView } from "@/services/catalog/product-view";

/**
 * Tells whoever is filling in the demo step that one of their addresses will
 * never appear in the preview — ticket 31, item 4.
 *
 * ## Why the warning lives on the step rather than in the save result
 *
 * `saveDemoAction` redirects on success (`continueTo`), so anything returned in
 * its `ActionResult` is thrown away by the navigation that follows. Rendering
 * the verdict as part of the step instead means it is there when the vendor
 * arrives, still there when they come back, and current every time — which a
 * value captured at save time would not be.
 *
 * ## Nothing is stored
 *
 * The first draft of ticket 31 had this verdict written onto `ProductDoc`. It
 * does not need to be: `frameability` is cached per **URL**, so the probe this
 * component runs is the same entry the preview page reads, and the two cannot
 * disagree. Storing it would have added a field that goes stale the moment a
 * vendor puts Cloudflare in front of their demo, and — by design — broken the
 * build in `template-sibling.ts` until someone bucketed it. A cache key is the
 * cheaper answer.
 *
 * ## Silence when everything is fine
 *
 * No green tick, no "all three addresses check out". This step already carries a
 * credentials warning that has to be read; a second permanent box teaches people
 * to skim both.
 */
export async function FrameabilityNotice({ product }: { product: AdminProductView }) {
  const fields = [
    { label: "Public demo", url: product.demo.publicUrl },
    { label: "Customer view", url: product.demo.customerUrl },
    { label: "Admin view", url: product.demo.adminUrl },
  ].filter((field): field is { label: string; url: string } => Boolean(field.url));

  if (fields.length === 0) return null;

  // Non-https never reaches the probe: `embeddable()` refuses it for the preview
  // too, and an `http` frame on an https page is blocked as mixed content before
  // any header is read. Different cause, same outcome, and a different fix — so
  // it is reported separately rather than folded into "blocked".
  const insecure = fields.filter(({ url }) => !embeddable(url));
  const secure = fields.filter(({ url }) => embeddable(url));

  const verdicts = await frameabilityOf(secure.map(({ url }) => url));
  const blocked = secure.filter(({ url }) => verdicts.get(url) === "blocked");

  if (insecure.length === 0 && blocked.length === 0) return null;

  const hosts = [...new Set(blocked.map(({ url }) => hostOf(url)))].filter(Boolean);

  return (
    <div
      role="note"
      className="flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 px-3.5 py-3"
    >
      <MonitorX
        className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
        aria-hidden
      />
      <div className="min-w-0 text-[12.5px] leading-relaxed">
        <p>
          <strong className="font-medium">
            {blocked.length + insecure.length === 1
              ? "One of these addresses can't be shown inside CoSetup."
              : "Some of these addresses can't be shown inside CoSetup."}
          </strong>{" "}
          Buyers get a link to open the demo in a new tab instead of a live preview on the
          product page. The listing still works — the preview is just less useful.
        </p>

        {insecure.length > 0 && (
          <p className="mt-2">
            <FieldNames fields={insecure} /> {insecure.length === 1 ? "is" : "are"} not{" "}
            <code className="font-mono text-[11.5px]">https</code>. A demo has to be served over
            https before a browser will show it here at all.
          </p>
        )}

        {blocked.length > 0 && (
          <>
            <p className="mt-2">
              <FieldNames fields={blocked} /> {blocked.length === 1 ? "refuses" : "refuse"} to
              be embedded. To fix that
              {hosts.length === 1 ? ` on ${hosts[0]}` : ""}:
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-4">
              <li>
                Remove the <code className="font-mono text-[11.5px]">X-Frame-Options</code>{" "}
                header — <code className="font-mono text-[11.5px]">DENY</code> and{" "}
                <code className="font-mono text-[11.5px]">SAMEORIGIN</code> both block us, and
                many frameworks send one without being asked.
              </li>
              <li>
                If the site sends a{" "}
                <code className="font-mono text-[11.5px]">Content-Security-Policy</code>, add{" "}
                <code className="font-mono text-[11.5px]">https://cosetup.net</code> to its{" "}
                <code className="font-mono text-[11.5px]">frame-ancestors</code> list.
              </li>
              <li>
                Make sure the demo is reachable without signing in. A password page, a staging
                login or a host&rsquo;s &ldquo;deployment protection&rdquo; screen can&rsquo;t
                be embedded even when the app behind it could be.
              </li>
            </ul>
            <p className="text-muted-foreground mt-2">
              To check it yourself:{" "}
              <code className="font-mono text-[11.5px]">
                curl -sI {blocked[0]?.url} | grep -i frame
              </code>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function FieldNames({ fields }: { fields: ReadonlyArray<{ label: string }> }) {
  const names = fields.map(({ label }) => label);
  const text =
    names.length <= 1
      ? (names[0] ?? "")
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return <strong className="font-medium">{text}</strong>;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
