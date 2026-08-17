import { redirect } from "next/navigation";

/**
 * `/staff/dashboard` → `/staff`.
 *
 * Not a route anybody designed — a route somebody *typed*, during the smoke
 * test, because every other portal in the world puts its landing page there.
 * It 404'd. A redirect costs one file and removes a dead end that reads as a
 * broken product.
 */
export default function Page(): never {
  redirect("/staff");
}
