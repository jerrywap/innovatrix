"use client";

import { useState } from "react";
import Image from "next/image";
import { X } from "lucide-react";

/**
 * Screenshots, with a lightbox — §8.
 *
 * ## The first image is *not* rendered here
 *
 * It is a plain `next/image` in the Server Component above, with `priority`.
 * That matters for one measurable reason: the hero image is the LCP element,
 * and an LCP that waits for this bundle to download, parse and hydrate is an
 * LCP that misses the 2.5s target on a throttled connection for no benefit —
 * nobody clicks a lightbox before the page has painted.
 *
 * So this island owns the thumbnails and the overlay only, and hydrates late.
 */
export function Gallery({
  images,
  productName,
}: {
  images: ReadonlyArray<{ url: string; alt: string }>;
  productName: string;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  if (images.length <= 1) return null;

  return (
    <>
      <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {images.map((image, index) => (
          <li key={image.url}>
            <button
              type="button"
              onClick={() => setOpenIndex(index)}
              className="border-border focus-visible:ring-ring relative block aspect-[4/3] w-full overflow-hidden rounded-lg border focus-visible:ring-2 focus-visible:outline-none"
            >
              <Image
                src={image.url}
                alt={image.alt}
                fill
                sizes="120px"
                className="object-cover"
              />
              <span className="sr-only">
                Open screenshot {index + 1} of {images.length}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {openIndex !== null && images[openIndex] && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${productName} screenshot ${openIndex + 1}`}
          className="bg-background/95 fixed inset-0 z-100 flex items-center justify-center p-6 backdrop-blur"
          onClick={() => setOpenIndex(null)}
          // Escape closes it. A lightbox that traps you until you find the X is
          // the most common accessibility failure in this pattern.
          onKeyDown={(event) => {
            if (event.key === "Escape") setOpenIndex(null);
          }}
          tabIndex={-1}
          ref={(node) => node?.focus()}
        >
          <button
            type="button"
            onClick={() => setOpenIndex(null)}
            className="border-border bg-background absolute top-5 right-5 rounded-full border p-2"
          >
            <X className="size-4" aria-hidden />
            <span className="sr-only">Close the screenshot</span>
          </button>

          <div className="relative h-full max-h-[80vh] w-full max-w-[1100px]">
            <Image
              src={images[openIndex].url}
              alt={images[openIndex].alt}
              fill
              sizes="(min-width: 1100px) 1100px, 100vw"
              className="object-contain"
            />
          </div>
        </div>
      )}
    </>
  );
}
