import type { Metadata } from "next";
import { ConceptSwitcher } from "./_components/switcher";
import {
  bricolage,
  dmSans,
  fraunces,
  instrumentSerif,
  manrope,
  newsreader,
  plexMono,
  plexSans,
} from "./_lib/fonts";

export const metadata: Metadata = {
  title: "Innovatrix — Landing page concepts",
  description: "Five brand directions for the Innovatrix landing page.",
  robots: { index: false, follow: false },
};

const fontVars = [
  fraunces.variable,
  dmSans.variable,
  bricolage.variable,
  newsreader.variable,
  plexSans.variable,
  plexMono.variable,
  instrumentSerif.variable,
  manrope.variable,
].join(" ");

export default function ConceptsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${fontVars} isolate`}>
      {children}
      <ConceptSwitcher />
    </div>
  );
}
