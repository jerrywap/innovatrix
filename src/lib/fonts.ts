import { Archivo, JetBrains_Mono } from "next/font/google";

/**
 * Innovatrix typefaces — the Meridian direction.
 *
 * Archivo: a grotesque that holds up at display sizes with tight tracking, and
 * stays legible at 13px in a dense staff table. JetBrains Mono carries labels,
 * references (ORD-2026-1254) and anything the eye should read as a value
 * rather than prose.
 */
export const display = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

export const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const fontVariables = `${display.variable} ${mono.variable}`;
