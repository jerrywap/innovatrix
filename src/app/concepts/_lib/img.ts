/**
 * Unsplash placeholder helper.
 *
 * Concept pages use plain <img> deliberately: no next.config remotePatterns to
 * maintain while we are only exploring direction, and a dead photo id degrades
 * to the wrapper's gradient instead of throwing. Production uses next/image
 * (see ticket 27 — SEO, performance & observability).
 */
export function u(id: string, w = 1600, h?: number) {
  const params = new URLSearchParams({
    auto: "format",
    fit: "crop",
    w: String(w),
    q: "80",
  });
  if (h) params.set("h", String(h));
  return `https://images.unsplash.com/${id}?${params.toString()}`;
}

/** Curated placeholder set, grouped by the role each image plays. */
export const PHOTO = {
  // Teams, offices, working
  teamMeeting: "photo-1522071820081-009f0129c71c",
  teamWhiteboard: "photo-1552664730-d307ca884978",
  officeWide: "photo-1497366754035-f200968a6e72",
  officeCalm: "photo-1497215728101-856f4ea42174",
  coworking: "photo-1497032628192-86f99bcd76bc",
  deskMinimal: "photo-1557804506-669a67965ba0",
  laptopDesk: "photo-1531973576160-7125cd663d86",
  developer: "photo-1531482615713-2afd69097998",
  pairWorking: "photo-1551434678-e076c223a692",
  notesMeeting: "photo-1542744173-8e7e53415bb0",
  studioLight: "photo-1604328698692-f76ea9498e76",

  // Screens, data, product surfaces
  dashboard: "photo-1551288049-bebda4e38f71",
  analytics: "photo-1460925895917-afdab827c52f",
  charts: "photo-1559136555-9303baea8ebd",
  codeDark: "photo-1526374965328-7f61d4dc18c5",
  circuit: "photo-1518770660439-4636190af475",
  network: "photo-1451187580459-43490279c0fa",

  // Abstract / texture
  gradientSoft: "photo-1620121692029-d088224ddc74",
  shapes3d: "photo-1618005182384-a83a8bd57fbe",
  abstractGlass: "photo-1639322537228-f710d846310a",

  // Industry vignettes
  property: "photo-1560518883-ce09059eeffa",
  healthcare: "photo-1576091160399-112ba8d25d1d",
  logistics: "photo-1553413077-190dd305871c",
  retail: "photo-1441986300917-64674bd600d8",
  hospitality: "photo-1414235077428-338989a2e8c0",

  // Portraits
  p1: "photo-1494790108377-be9c29b29330",
  p2: "photo-1507003211169-0a1dd7228f2d",
  p3: "photo-1438761681033-6461ffad8d80",
  p4: "photo-1472099645785-5658abf4ff4e",
  p5: "photo-1544005313-94ddf0286df2",
  p6: "photo-1633332755192-727a05c4013d",
} as const;
