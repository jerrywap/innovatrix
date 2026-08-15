import {
  Bricolage_Grotesque,
  DM_Sans,
  Fraunces,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  Instrument_Serif,
  Manrope,
  Newsreader,
} from "next/font/google";

/* 01 — Meridian was selected and promoted to the real site.
   Its typefaces now live in src/lib/fonts.ts and load from the root layout. */

/* 02 — Dialogue: warm, humanist, conversational */
export const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
});
export const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

/* 03 — Catalogue: editorial magazine */
export const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
});
export const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

/* 04 — Blueprint: engineered, technical */
export const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-plex-sans",
});
export const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-plex-mono",
});

/* 05 — Atelier: cinematic, commissioned */
export const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: ["400"],
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});
export const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});
