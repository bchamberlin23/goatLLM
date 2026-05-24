/**
 * Visual directions — 5 deterministic OKLch palettes + font stacks the agent
 * binds into the seed template's `:root` when the user has no brand spec.
 *
 * Directly adapted from `nexu-io/open-design`'s discovery fallback (see
 * apps/daemon/src/prompts/directions.ts upstream — Apache-2.0). We keep the
 * five-school taxonomy but tighten the palettes to OKLch so the seed values
 * round-trip cleanly into Tailwind 4's color system.
 *
 * The directions theme the *artifact*, never the goatLLM shell.
 */

export interface Direction {
  id: "editorial" | "modern-minimal" | "tech-utility" | "brutalist" | "soft-warm";
  name: string;
  mood: string;
  /** OKLch tokens. Each value is a CSS-ready color string. */
  palette: {
    bg: string;
    fg: string;
    accent: string;
    mute: string;
    surface: string;
  };
  fonts: {
    display: string;
    body: string;
    mono: string;
  };
  /** Reference publications / brands that anchor the visual stance. */
  refs: string[];
}

export const DIRECTIONS: Direction[] = [
  {
    id: "editorial",
    name: "Editorial — Monocle / FT",
    mood: "Print magazine. Ink, cream, warm rust. Generous serifs, tight grids.",
    palette: {
      bg: "oklch(0.97 0.012 80)",
      fg: "oklch(0.18 0.02 60)",
      accent: "oklch(0.55 0.16 35)",
      mute: "oklch(0.62 0.018 70)",
      surface: "oklch(0.93 0.016 80)",
    },
    fonts: {
      display: "'GT Sectra', 'Tiempos Headline', 'Playfair Display', Georgia, serif",
      body: "'Source Serif Pro', 'Lora', Georgia, serif",
      mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
    },
    refs: ["Monocle", "FT Weekend", "NYT Magazine", "The Atlantic"],
  },
  {
    id: "modern-minimal",
    name: "Modern minimal — Linear / Vercel",
    mood: "Cool, structured, minimal accent. Grotesk type, generous whitespace.",
    palette: {
      bg: "oklch(0.99 0.002 250)",
      fg: "oklch(0.20 0.012 260)",
      accent: "oklch(0.58 0.20 265)",
      mute: "oklch(0.65 0.012 260)",
      surface: "oklch(0.96 0.004 260)",
    },
    fonts: {
      display: "'Inter Display', 'Geist', 'Inter', system-ui, sans-serif",
      body: "'Inter', 'Geist', system-ui, sans-serif",
      mono: "'Geist Mono', 'JetBrains Mono', monospace",
    },
    refs: ["Linear", "Vercel", "Stripe", "Raycast"],
  },
  {
    id: "tech-utility",
    name: "Tech utility — Bloomberg / Bauhaus",
    mood: "Information density. Monospace bones, terminal palette, functional decoration.",
    palette: {
      bg: "oklch(0.16 0.012 240)",
      fg: "oklch(0.94 0.008 240)",
      accent: "oklch(0.78 0.16 60)",
      mute: "oklch(0.65 0.012 240)",
      surface: "oklch(0.20 0.014 240)",
    },
    fonts: {
      display: "'JetBrains Mono', 'IBM Plex Mono', 'Berkeley Mono', monospace",
      body: "'Inter', 'IBM Plex Sans', system-ui, sans-serif",
      mono: "'JetBrains Mono', 'IBM Plex Mono', monospace",
    },
    refs: ["Bloomberg Terminal", "ClickHouse", "ArchiveBox", "Bauhaus tools"],
  },
  {
    id: "brutalist",
    name: "Brutalist — Businessweek / Achtung",
    mood: "Raw. Oversized type, no shadows, harsh accents, intentional asymmetry.",
    palette: {
      bg: "oklch(0.99 0.002 90)",
      fg: "oklch(0.10 0.005 90)",
      accent: "oklch(0.68 0.24 25)",
      mute: "oklch(0.50 0.005 90)",
      surface: "oklch(0.94 0.004 90)",
    },
    fonts: {
      display: "'Druk', 'Helvetica Now Display', 'Helvetica Neue', sans-serif",
      body: "'Helvetica Now Text', 'Helvetica Neue', Arial, sans-serif",
      mono: "'JetBrains Mono', monospace",
    },
    refs: ["Bloomberg Businessweek", "Achtung", "032c", "Brutalist Web"],
  },
  {
    id: "soft-warm",
    name: "Soft warm — Notion / Apple Health",
    mood: "Generous, low contrast, peachy neutrals. Rounded, gentle, calm.",
    palette: {
      bg: "oklch(0.98 0.014 60)",
      fg: "oklch(0.28 0.018 50)",
      accent: "oklch(0.74 0.13 30)",
      mute: "oklch(0.65 0.018 50)",
      surface: "oklch(0.95 0.018 60)",
    },
    fonts: {
      display: "'Lora', 'GT Sectra Display', Georgia, serif",
      body: "'Inter', 'SF Pro Text', system-ui, sans-serif",
      mono: "'JetBrains Mono', monospace",
    },
    refs: ["Notion marketing", "Apple Health", "Calm", "Headspace"],
  },
];

const BY_ID = new Map(DIRECTIONS.map((d) => [d.id, d] as const));

export function getDirection(id: string | null | undefined): Direction | undefined {
  if (!id) return undefined;
  return BY_ID.get(id as Direction["id"]);
}

export function listDirections(): Direction[] {
  return DIRECTIONS;
}
