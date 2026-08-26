/**
 * Unsplash placeholders.
 *
 * Every one of these is replaced by a real product screenshot before launch
 * (ticket 06 uploads them, ticket 27 serves them through next/image). Kept in
 * one module so the swap is a single file, not a hunt.
 */
export function placeholder(id: string, w = 1200, h?: number) {
  const params = new URLSearchParams({ auto: "format", fit: "crop", w: String(w), q: "80" });
  if (h) params.set("h", String(h));
  return `https://images.unsplash.com/${id}?${params.toString()}`;
}

export const SHOT = {
  dashboard: "photo-1551288049-bebda4e38f71",
  property: "photo-1560518883-ce09059eeffa",
  roster: "photo-1522071820081-009f0129c71c",
  logistics: "photo-1553413077-190dd305871c",
  healthcare: "photo-1576091160399-112ba8d25d1d",
  retail: "photo-1441986300917-64674bd600d8",
  analytics: "photo-1460925895917-afdab827c52f",
  office: "photo-1497366754035-f200968a6e72",
  /*
   * The one photograph on `/sell`, behind its closing band.
   *
   * A workspace detail rather than a person at a laptop — the landing brief rules out
   * that shot specifically, and a vendor page aimed at developers is the last place it
   * would land. Scrimmed heavily either way; it is atmosphere, not evidence.
   */
  workspace: "photo-1499951360447-b19be8fe80f5",
} as const;
