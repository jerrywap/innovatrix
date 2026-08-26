import { Band, SectionHead } from "@/components/band";
import { SERVICES } from "../data";

/**
 * "Software is only the beginning."
 *
 * ## Positioned as the next step, not the proposition
 *
 * The brief is explicit that services must not dominate the homepage — CoSetup is
 * not an agency — so this band comes eighth, after everything a visitor can buy or
 * commission, and it is typographic rather than illustrated. It frames each
 * service as something that happens *to* software you now have, which is also what
 * the name is about: the "Run it" of the headline.
 *
 * This absorbs the old lifecycle scroller — nine stage words in a horizontal
 * strip — which named the internal process rather than what the customer gets.
 */
export function Services() {
  return (
    <Band id="services" tone="muted">
      <SectionHead
        eyebrow="Services"
        title="Software is only the beginning."
        lede="Getting it installed, connected and kept alive is the part that usually stalls. It is also the part we do — on anything you bought here, and on what we built for you."
        action={{ href: "/services", label: "See what we handle" }}
      />

      <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {SERVICES.map((service, index) => (
          <li
            key={service.title}
            className="border-border bg-surface flex flex-col rounded-[22px] border p-5"
          >
            <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] tabular-nums">
              {String(index + 1).padStart(2, "0")}
            </span>
            <h3 className="mt-2.5 text-[16px] font-medium tracking-[-0.02em]">
              {service.title}
            </h3>
            <p className="text-muted-foreground mt-1.5 text-[13.5px] leading-relaxed">
              {service.body}
            </p>
          </li>
        ))}
      </ul>
    </Band>
  );
}
