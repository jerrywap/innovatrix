import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AuthCard } from "@/features/auth/components/auth-card";
import { AcceptInviteForm } from "@/features/auth/components/accept-invite-form";
import { AcceptVendorInviteForm } from "@/features/vendors/components/accept-invite-form";
import { getAuth } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/dal";
import { findOpenInvitation } from "@/services/vendors/member-service";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Accept your invitation" };

/**
 * Invitation landing page — §76, and vendor ticket 03.
 *
 * Three states, in order of what the visitor needs:
 *
 * 1. **Signed out** → send them to register (or sign in) and come straight back
 *    here. Accepting requires an account, and an invitation email is often the
 *    first time someone hears of us.
 * 2. **Signed in as the wrong person** → say so explicitly rather than silently
 *    failing. An invitation belongs to an address, not to a browser.
 * 3. **Signed in as the invitee** → show what they're joining and let them
 *    accept. The accept itself is a POST, never a GET: a bare link that joins
 *    an organization would fire from any email client's link prefetcher.
 *
 * ## Two kinds of invitation, one page
 *
 * `?id=` is an **organization** invitation, owned end to end by Better Auth.
 * `?vendorInvite=` is a **vendor team** invitation, owned by us — Better Auth's
 * invitation is org-scoped and a vendor is deliberately not an `Organization`, so
 * that flow could not be reused. What *is* reused is this page and its three
 * states, because a second accept page would be a second place for the
 * wrong-recipient check to be got wrong.
 *
 * The branch is taken on the query parameter and the two never mix: a vendor
 * invite id passed as `?id=` finds nothing in `organizationInvitations`, and the
 * expiry copy is the honest answer to that.
 */
export default async function AcceptInvitePage({ searchParams }: PageProps<"/accept-invite">) {
  const params = await searchParams;
  const vendorInviteId = Array.isArray(params.vendorInvite)
    ? params.vendorInvite[0]
    : params.vendorInvite;

  if (vendorInviteId) return <VendorInvite invitationId={vendorInviteId} />;

  const invitationId = Array.isArray(params.id) ? params.id[0] : params.id;

  if (!invitationId) {
    return (
      <AuthCard title="Invitation not found" description="That link is missing its reference.">
        <p className="text-muted-foreground text-[13.5px]">
          Ask whoever invited you to send it again.
        </p>
      </AuthCard>
    );
  }

  const session = await getSession();
  if (!session) {
    redirect(`/register?next=${encodeURIComponent(`/accept-invite?id=${invitationId}`)}`);
  }

  const invitation = await getAuth()
    .api.getInvitation({ query: { id: invitationId }, headers: await headers() })
    .catch(() => null);

  if (!invitation) {
    return (
      <AuthCard
        title="This invitation has expired"
        description="Invitations are valid for 48 hours."
        footer={
          <Link href="/dashboard" className="text-signal-text hover:underline">
            Go to your dashboard
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">
          Ask whoever invited you to send a new one.
        </p>
      </AuthCard>
    );
  }

  if (invitation.email.toLowerCase() !== session.user.email.toLowerCase()) {
    return (
      <AuthCard
        title="This invitation is for someone else"
        description={`It was sent to ${invitation.email}, and you're signed in as ${session.user.email}.`}
        footer={
          <Link href="/login" className="text-signal-text hover:underline">
            Sign in as someone else
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">
          Sign in with the invited address to accept it.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Join ${invitation.organizationName}`}
      description={`You've been invited as ${invitation.role}.`}
    >
      <AcceptInviteForm invitationId={invitationId} />
    </AuthCard>
  );
}

/**
 * The vendor half — vendor ticket 03.
 *
 * The same four states as above, with one extra: **email not yet verified**. That
 * is the platform's own rule (§75) and it bites harder here, because a member is
 * one promotion away from a payout account. The service re-checks all of it — this
 * is the explanation, not the enforcement.
 */
async function VendorInvite({ invitationId }: { invitationId: string }) {
  const session = await getSession();
  if (!session) {
    redirect(
      `/register?next=${encodeURIComponent(`/accept-invite?vendorInvite=${invitationId}`)}`,
    );
  }

  const invitation = await findOpenInvitation(invitationId).catch(() => null);

  if (!invitation) {
    return (
      <AuthCard
        title="This invitation has expired"
        description="Invitations are valid for 48 hours."
        footer={
          <Link href="/dashboard" className="text-signal-text hover:underline">
            Go to your dashboard
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">
          Ask whoever invited you to send a new one.
        </p>
      </AuthCard>
    );
  }

  if (invitation.email !== session.user.email.toLowerCase()) {
    return (
      <AuthCard
        title="This invitation is for someone else"
        description={`It was sent to ${invitation.email}, and you're signed in as ${session.user.email}.`}
        footer={
          <Link href="/login" className="text-signal-text hover:underline">
            Sign in as someone else
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">
          Sign in with the invited address to accept it.
        </p>
      </AuthCard>
    );
  }

  if (!session.user.emailVerified) {
    return (
      <AuthCard
        title="Confirm your email first"
        description={`We sent a link to ${session.user.email}.`}
        footer={
          <Link href="/verify-email" className="text-signal-text hover:underline">
            Resend the confirmation
          </Link>
        }
      >
        <p className="text-muted-foreground text-[13.5px]">
          Joining a vendor account gives you access to its products, so we need to know the
          address is yours. Come back to this link afterwards — it stays valid until it expires.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={`Sell as ${invitation.vendorName}`}
      description={
        invitation.role === "owner"
          ? "You've been invited as the owner."
          : "You've been invited as a team member."
      }
    >
      <p className="text-muted-foreground mb-4 text-[13.5px]">
        You&rsquo;ll be able to work on this vendor&rsquo;s products, releases and support.
        Payout details stay with the owner.
      </p>
      <AcceptVendorInviteForm invitationId={invitation.id} />
    </AuthCard>
  );
}
