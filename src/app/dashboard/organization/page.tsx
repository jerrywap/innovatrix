import { redirect } from "next/navigation";

/**
 * `/dashboard/organization` → `/dashboard/account/billing`.
 *
 * This route used to render a hardcoded empty state — "Members, roles and billing
 * details" with nothing behind it, however many members an organisation had. It
 * was deliberately kept out of the navigation for that reason, and the comment on
 * `CUSTOMER_NAV` said it would return "the moment tickets 03/24 give it members,
 * roles and billing details to show".
 *
 * Billing details now exist, on the account screen where somebody looking for
 * their own invoice address will actually look. So this becomes a redirect rather
 * than a second home for the same form: the URL has been linked from nowhere but
 * has certainly been typed, and a dead end that says "nothing to manage yet" is
 * worse than an honest hand-off.
 *
 * Members and roles are still unbuilt. When they are, they belong here, and this
 * redirect goes.
 */
export default function Page(): never {
  redirect("/dashboard/account/billing");
}
