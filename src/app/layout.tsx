import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * `shadcn init` adds a Geist import here and puts `--font-sans` on it. That
 * silently swaps Meridian's typeface for a second one on every shadcn
 * component, which is a brand change wearing the clothes of a setup step.
 * Removed: `--font-sans` is mapped to Archivo in `globals.css` instead, so a
 * shadcn Button and a hand-written heading share a voice.
 */

export const metadata: Metadata = {
  title: {
    default: "Innovatrix — Find, customise, build and run your software",
    template: "%s · Innovatrix",
  },
  description:
    "A software acquisition and delivery platform. Buy what already exists, have it adapted, or commission it outright — then have it installed, supported and maintained.",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes writes the resolved class onto
    // <html> before React hydrates, so server and client markup differ by design.
    <html lang="en" className={`${fontVariables} h-full`} suppressHydrationWarning>
      <body className="flex min-h-full flex-col antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
