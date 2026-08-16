import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { KeyRound, Lock, MonitorPlay } from "lucide-react";
import { getSession } from "@/lib/auth/dal";
import { revealCredentials, type RevealedCredential } from "@/services/catalog/demo-service";
import { viewerOwnsProduct } from "@/services/marketplace/detail";
import type { ProductDetail } from "@/services/marketplace/detail";
import { CopyField } from "./copy-field";

/**
 * The demo panel — §9.
 *
 * ## The gate is *before* the component, not inside it
 *
 * This is the acceptance criterion that is easiest to get subtly wrong:
 *
 * > Demo credentials for an `owners_only` product are absent from the HTML
 * > **and the RSC payload** for a non-owner.
 *
 * Rendering `{canSee && <Credentials rows={rows} />}` satisfies the UI and
 * fails the criterion — React serialises everything in scope for a client
 * component's props, so `rows` travels to the browser whether it is drawn or
 * not. Even in a pure Server Component tree, holding the plaintext in a
 * variable near a client boundary is one refactor away from shipping it.
 *
 * So `revealCredentials()` returns **`null`** for a viewer who does not
 * qualify, and there is nothing in scope to leak. The panel below that point
 * cannot render a secret because it was never given one.
 *
 * ## Uncached, deliberately
 *
 * Everything else on this page is a cached read. This one is not, and must not
 * be: it varies by viewer, and one owner's page load would otherwise poison the
 * entry the next anonymous visitor reads.
 */
export async function DemoPanel({ product }: { product: ProductDetail }) {
  const { demo } = product;

  // Nothing configured at all — the section simply does not exist.
  if (!demo.publicUrl && !demo.hasCredentials) return null;

  const session = await getSession();
  const isStaff = session?.user.isStaff ?? false;
  const organizationId = session?.activeOrganizationId ?? undefined;

  const access = await revealCredentials(product.id, {
    isAuthenticated: Boolean(session),
    ownsProduct: await viewerOwnsProduct(organizationId, product.id),
    isStaff,
    // For §90's audit row, which the service writes for a *gated* reveal only.
    // Nothing here changes what is shown — `canRevealCredentials` decides that
    // from the three flags above.
    ...(session?.user.id ? { userId: session.user.id } : {}),
    ...(organizationId ? { organizationId } : {}),
  });

  return (
    <section id="demo" className="flex flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <MonitorPlay className="text-subtle size-4" aria-hidden />
        <h2 className="font-display text-[19px] tracking-[-0.02em]">Try it</h2>
      </div>

      {demo.publicUrl && (
        <a
          href={demo.publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="border-border bg-surface flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-[13.5px] transition-colors hover:border-[var(--signal)]/40"
        >
          <span className="font-medium">Open the live demo</span>
          <span className="text-subtle font-mono text-[11px]">↗ opens in a new tab</span>
        </a>
      )}

      {demo.instructions && (
        <p className="text-muted-foreground text-[13.5px] leading-relaxed">
          {demo.instructions}
        </p>
      )}

      {demo.hasCredentials &&
        (access ? (
          <Credentials
            credentials={access.credentials}
            {...(access.customerUrl ? { customerUrl: access.customerUrl } : {})}
            {...(access.adminUrl ? { adminUrl: access.adminUrl } : {})}
          />
        ) : (
          <LockedNotice
            exposure={demo.exposure}
            roles={demo.roles.map((role) => role.label ?? role.role)}
            signedIn={Boolean(session)}
            slug={product.slug}
          />
        ))}

      {demo.resetSchedule && (
        <p className="text-subtle text-[12px]">
          The demo data resets: {demo.resetSchedule}. Anything you change there is temporary.
        </p>
      )}
    </section>
  );
}

function Credentials({
  credentials,
  customerUrl,
  adminUrl,
}: {
  credentials: readonly RevealedCredential[];
  customerUrl?: string;
  adminUrl?: string;
}) {
  return (
    <div className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4">
      {(customerUrl ?? adminUrl) && (
        <div className="flex flex-wrap gap-2">
          {customerUrl && <DemoLink href={customerUrl} label="Customer view" />}
          {adminUrl && <DemoLink href={adminUrl} label="Admin view" />}
        </div>
      )}

      <div className="flex flex-col gap-3">
        {credentials.map((credential) => (
          <div key={credential.role} className="flex flex-col gap-1.5">
            <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
              {credential.label ? `${credential.role} — ${credential.label}` : credential.role}
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {credential.username && (
                <CopyField label="Username" value={credential.username} />
              )}
              {credential.password ? (
                <CopyField label="Password" value={credential.password} secret />
              ) : (
                <p className="text-subtle self-center text-[12px]">
                  No password stored for this role.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DemoLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="border-border hover:bg-surface-muted rounded-lg border px-3 py-1.5 text-[12.5px]"
    >
      {label} ↗
    </a>
  );
}

/**
 * What a viewer who does not qualify sees.
 *
 * It names the roles that exist and what unlocks them, because "there is
 * something here you cannot see" is more useful than silence — and the role
 * *names* were already in the public payload, so saying them leaks nothing.
 */
function LockedNotice({
  exposure,
  roles,
  signedIn,
  slug,
}: {
  exposure: string;
  roles: readonly string[];
  signedIn: boolean;
  slug: string;
}) {
  const needsAccount = exposure === "authenticated" && !signedIn;

  return (
    <div className="border-border bg-surface-muted flex gap-3 rounded-xl border border-dashed px-4 py-3.5">
      <Lock className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex flex-col gap-1.5">
        <p className="text-[13.5px] font-medium">
          Sign-in details for {roles.length} role{roles.length === 1 ? "" : "s"} are available
        </p>
        <p className="text-muted-foreground text-[12.5px]">
          {needsAccount
            ? "Create a free account or sign in to see them."
            : "These are shared with customers who own this product."}
        </p>
        {needsAccount ? (
          <Link
            href={`/login?next=/marketplace/${slug}` as Route}
            className="w-fit text-[12.5px] underline underline-offset-4"
          >
            Sign in
          </Link>
        ) : (
          <span className="text-subtle flex items-center gap-1.5 text-[12px]">
            <KeyRound className="size-3" aria-hidden />
            Buying the product unlocks them.
          </span>
        )}
      </div>
    </div>
  );
}
