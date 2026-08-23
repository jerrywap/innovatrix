import "server-only";
import { Suspense } from "react";
import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { initialsOf } from "@/lib/initials";
import { getVendorProfile } from "@/services/marketplace/storefront";

/**
 * "by «vendor»", with their logo — vendor ticket 11, and the answer to "who made this".
 *
 * Above the summary and linked, because a buyer weighing a third-party product
 * asks who is behind it *before* reading what it does. Rendered as nothing at all
 * for a first-party product: "by CoSetup" on a platform called CoSetup is noise,
 * which is why the page guards on `product.vendor` rather than this component
 * having a no-vendor branch.
 *
 * ## The name is not suspended; only the picture is
 *
 * The vendor's name and slug already ride in the cached `ProductDetail`, so they
 * are available in the same pass that renders the heading. Only the **logo** needs
 * a second read, and it waits inside a fixed-size box — so nothing above the hero
 * can shift once it arrives, and a slow vendor query cannot delay the product
 * name.
 *
 * `getVendorProfile` is already `"use cache"` and tagged, so this is not an extra
 * query per view; on a product page that renders the storefront link anyway it is
 * usually the same cache entry.
 *
 * ## `object-contain` in a rounded square, not a circle
 *
 * It is a company logo, not a face. A circle crops wordmarks, and `object-cover`
 * crops them further. `rounded-xs` rather than the theme's `--radius-md`, which is
 * `1rem` — on a 24px box that is very nearly a circle.
 */
export function VendorByline({ vendor }: { vendor: { slug: string; name: string } }) {
  return (
    <p className="flex items-center gap-2 text-[13.5px]">
      <span className="border-border bg-surface-muted relative size-6 shrink-0 overflow-hidden rounded-xs border">
        {/*
          The monogram is both the fallback-while-loading and the
          fallback-forever, which is what makes the box never change size: there
          is no state in which it is empty.
        */}
        <Suspense fallback={<Initials name={vendor.name} />}>
          <VendorLogo slug={vendor.slug} name={vendor.name} />
        </Suspense>
      </span>

      <span>
        <span className="text-subtle">by </span>
        <Link
          href={`/vendors/${vendor.slug}` as Route}
          className="underline underline-offset-4"
        >
          {vendor.name}
        </Link>
      </span>
    </p>
  );
}

async function VendorLogo({ slug, name }: { slug: string; name: string }) {
  const profile = await getVendorProfile(slug);
  if (!profile?.logoUrl) return <Initials name={name} />;

  return (
    <Image
      src={profile.logoUrl}
      // Empty, not the vendor's name: the name is the link beside it, and a
      // screen reader reading it twice is noise rather than information.
      alt=""
      fill
      sizes="24px"
      className="object-contain"
    />
  );
}

/**
 * `aria-hidden`, unlike the same initials in the account menu.
 *
 * There they are the trigger's only visible text, so under WCAG 2.5.3 they are
 * its accessible name. Here the vendor's name is the next thing on the line, so
 * announcing "AS, by Acme Software" reads one fact twice.
 */
function Initials({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="text-muted-foreground absolute inset-0 flex items-center justify-center text-[9px] font-semibold"
    >
      {initialsOf(name)}
    </span>
  );
}
