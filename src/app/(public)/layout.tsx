import { Suspense } from "react";
import { publicEnv } from "@/config/public-env";
import { SiteJsonLd } from "@/components/json-ld";
import { PublicFooter } from "@/components/shell/public-footer";
import {
  HeaderAccount,
  HeaderAccountFallback,
  PublicHeader,
} from "@/components/shell/public-header";

/**
 * The marketing shell — §4's public surface.
 *
 * A route group, so these pages keep their URLs: `/`, `/marketplace`,
 * `/templates`.
 *
 * ## No `instant = false`, and that is the point of the Suspense boundary
 *
 * This layout used to `await getSession()` directly, which made it dynamic —
 * and a dynamic layout makes every page beneath it dynamic too, however
 * carefully the page itself is written. `/marketplace` was built with a static
 * shell and a suspended body and still came out `ƒ` in the build output,
 * because of this file.
 *
 * Suspending only the account corner is what lets the shell, the nav and each
 * page's static parts prerender while the session streams in. It reads the
 * session but never requires one: the marketplace must be browsable by someone
 * who has never heard of us.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        Site-wide structured data — §93. In the layout so `Organization` and
        `WebSite` are declared exactly once per page rather than repeated by
        every route that remembers to; the product pages' `seller` refers to the
        same `@id` instead of declaring a second entity with the same name.

        A static component with no per-request read, so it does not make this
        layout dynamic — which was the whole point of suspending the account
        corner above.
      */}
      <SiteJsonLd origin={publicEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, "")} />

      <PublicHeader
        account={
          <Suspense fallback={<HeaderAccountFallback />}>
            <HeaderAccount />
          </Suspense>
        }
      />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </>
  );
}
