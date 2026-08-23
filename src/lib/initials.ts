/**
 * Initials, for when there is no picture.
 *
 * Extracted from `account-menu.tsx`, which drew exactly this and kept it
 * private. A vendor byline needs the same fallback, and a second copy would be a
 * second answer to "what are the initials of «Acme Software Ltd»" — the
 * interesting cases being precisely the ones a copy gets wrong.
 *
 * `[\s@.]+` is what makes it work on an email as well as a name:
 * `ada.lovelace@example.com` yields "AL" rather than "AD". Falls back to `?`
 * rather than an empty string, because an empty monogram is an unexplained gap
 * where a broken avatar would at least look broken.
 *
 * Just the function, deliberately — not a `<Monogram>` component. The two places
 * that draw it want different sizes, shapes and, more importantly, opposite
 * answers on whether the initials are `aria-hidden`: in the account menu they are
 * the trigger's only visible text and so *are* its accessible name (WCAG 2.5.3),
 * while in a byline the name sits next to them and announcing both says the same
 * thing twice. A shared component would have to be told which, at which point it
 * is carrying a prop instead of a decision.
 */
export function initialsOf(value: string): string {
  const parts = value
    .trim()
    .split(/[\s@.]+/)
    .filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? (parts[1]?.[0] ?? "") : "";
  return (first + second).toUpperCase();
}
