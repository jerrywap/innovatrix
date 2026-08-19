import type { MetadataRoute } from "next";
import { publicEnv } from "@/config/public-env";
import { BRAND } from "@/config/brand";

/**
 * The web app manifest — §93.
 *
 * Not a PWA, and this does not make it one: no service worker, no offline
 * anything. What it does is give a browser a name, a theme colour and a start
 * URL when somebody adds the marketplace to a phone home screen, and stop
 * Lighthouse reporting an absent manifest — which is a real point against the
 * SEO score the ticket asks for.
 *
 * `display: "browser"` rather than `"standalone"` is deliberate: this is a
 * website, and an installed copy that hides the address bar makes a checkout
 * flow feel less trustworthy, not more.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${publicEnv.NEXT_PUBLIC_APP_NAME} — ${BRAND.tagline.replace(/\.$/, "")}`,
    short_name: publicEnv.NEXT_PUBLIC_APP_NAME,
    description:
      "Buy software that already exists, have it adapted to how you work, or commission it outright.",
    start_url: "/",
    display: "browser",
    // The same pair as the root layout's `viewport.themeColor`, so the browser
    // chrome matches the page rather than flashing a different colour.
    background_color: "#fbfaf7",
    theme_color: "#fbfaf7",
  };
}
