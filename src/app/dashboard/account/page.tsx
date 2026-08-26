import type { Metadata } from "next";
import { requireUser } from "@/lib/auth/dal";
import { ProfileForm } from "@/features/account/components/profile-form";
import { Panel } from "@/features/account/components/panel";

export const metadata: Metadata = { title: "Account" };

/**
 * Who you are.
 *
 * This route used to be the whole account page: notification preferences plus a
 * dashed box reading "Changing your name, email address or password isn't here
 * yet." Both halves of that have moved — the preferences to their own tab, and
 * the sentence to actual forms.
 *
 * No `<Suspense>` and no skeleton: the only data is the session, which
 * `requireUser()` has already resolved and React `cache`d for the layout above.
 * A boundary around a value that is already in hand buys a flash of skeleton and
 * nothing else.
 */
export default async function Page() {
  const user = await requireUser();

  return (
    <Panel
      title="Your details"
      description="How your name appears to us, and which address we write to."
    >
      <ProfileForm
        name={user.name ?? ""}
        email={user.email}
        emailVerified={user.emailVerified}
      />
    </Panel>
  );
}
