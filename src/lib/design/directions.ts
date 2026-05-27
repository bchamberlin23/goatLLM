export interface Direction {
  id: string;
  name: string;
  mood: string;
  references: string[];
  displayFont: string;
  bodyFont: string;
  monoFont?: string;
  palette: {
    bg: string;
    surface: string;
    fg: string;
    muted: string;
    border: string;
    accent: string;
  };
  posture: string[];
}

export const DIRECTIONS: Direction[] = [
  {
    id: "editorial-monocle",
    name: "Editorial — Monocle / FT magazine",
    mood: "Print-magazine feel for explicitly editorial or publishing briefs. Generous whitespace, large serif headlines, restrained palette of neutral paper + ink + a single brand-justified accent. Do not use this as the default for commerce, SaaS, dashboards, or product utilities.",
    references: ["Monocle", "The Financial Times Weekend", "NYT Magazine", "It's Nice That"],
    displayFont: "'Iowan Old Style', 'Charter', Georgia, serif",
    bodyFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
    palette: {
      bg: "oklch(98% 0.004 95)",
      surface: "oklch(100% 0.002 95)",
      fg: "oklch(20% 0.018 70)",
      muted: "oklch(48% 0.012 70)",
      border: "oklch(90% 0.006 95)",
      accent: "oklch(52% 0.10 28)",
    },
    posture: [
      "serif display, sans body, mono for metadata only",
      "no shadows, no rounded cards — borders + whitespace do the work",
      "one decisive image, cropped only at the bottom",
      "kicker / eyebrow in mono uppercase, one accent color, used at most twice; never create peach/pink/orange-beige page washes unless the brand/reference requires them",
    ],
  },
  {
    id: "modern-minimal",
    name: "Modern minimal — Linear / Vercel",
    mood: "Quiet, precise, software-native. System fonts, crisp neutral foundations, and a small but visible product palette (primary + secondary + status/accent) so the interface feels shipped rather than greyscale. The chrome stays restrained while interaction states, illustrations, charts, and product moments carry color.",
    references: ["Linear", "Vercel", "Notion 2024", "Stripe docs"],
    displayFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', system-ui, sans-serif",
    bodyFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    palette: {
      bg: "oklch(99% 0.002 240)",
      surface: "oklch(100% 0 0)",
      fg: "oklch(18% 0.012 250)",
      muted: "oklch(54% 0.012 250)",
      border: "oklch(92% 0.005 250)",
      accent: "oklch(58% 0.18 255)",
    },
    posture: [
      "tight letter-spacing on display sizes (-0.02em)",
      "hairline borders only, no shadows except dropdowns/modals",
      "mono numerics with `font-variant-numeric: tabular-nums`",
      "sticky frosted nav, content-led layouts with one product illustration, device mockup, or data visualization when it clarifies the product",
      "controlled color system: primary action color + one secondary signal + status colors; avoid monochrome/unstyled outputs, but never flood every card with gradients",
    ],
  },
  {
    id: "human-approachable",
    name: "Human / approachable — Airbnb / Duolingo",
    mood: "Friendly and tactile without the generic cozy canvas. Uses a clean neutral background, product-led color system, generous radii, and clear hierarchy. Good for consumer tools, marketplaces, wellness, education, translation, AI assistants, and indie SaaS when the brand has not supplied a palette.",
    references: ["Airbnb", "Duolingo product surfaces", "Miro", "Mercury"],
    displayFont: "'Söhne', 'Avenir Next', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
    bodyFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', system-ui, sans-serif",
    palette: {
      bg: "oklch(98% 0.004 240)",
      surface: "oklch(100% 0 0)",
      fg: "oklch(20% 0.02 240)",
      muted: "oklch(50% 0.018 240)",
      border: "oklch(90% 0.006 240)",
      accent: "oklch(56% 0.12 170)",
    },
    posture: [
      "sans display with strong weight contrast, system body for readability",
      "comfortable radii (12–18px) paired with crisp grid alignment",
      "primary action color plus a secondary/domain accent and clear status colors; use color to separate panels, states, and product moments",
      "subtle elevation only on interactive cards; tasteful gradients/glows are allowed for hero/device/product moments, never as a full-page beige/pastel wash",
      "avoid generic pastel/beige gradients; use real product screenshots, data, or labelled placeholders",
    ],
  },
  {
    id: "tech-utility",
    name: "Tech / utility — Datadog / GitHub",
    mood: "Data-dense, monospace-friendly, dark or light + grid. Made for engineers and operators who want information per square inch, not vibes.",
    references: ["Datadog", "GitHub", "Cloudflare dashboard", "Sentry"],
    displayFont: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif",
    bodyFont: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif",
    monoFont: "'JetBrains Mono', 'IBM Plex Mono', ui-monospace, Menlo, monospace",
    palette: {
      bg: "oklch(98% 0.005 250)",
      surface: "oklch(100% 0 0)",
      fg: "oklch(22% 0.02 240)",
      muted: "oklch(50% 0.018 240)",
      border: "oklch(90% 0.008 240)",
      accent: "oklch(58% 0.16 145)",
    },
    posture: [
      "sans display + sans body (one family) is OK here — utility trumps editorial",
      "tabular numerics everywhere, mono for code / IDs / hashes",
      "dense tables with hairline borders, no row striping",
      "inline status pills (success / warn / danger) with restrained tinted backgrounds",
      "avoid: hero images, oversized headlines, marketing copy — show the product instead",
    ],
  },
  {
    id: "brutalist-experimental",
    name: "Brutalist / experimental — Are.na / Yale",
    mood: "Loud type. Visible grid. System sans + a single oversized serif. Deliberate ugliness as confidence. Great for art, indie, agency, manifesto pages.",
    references: ["Are.na", "Yale Center for British Art", "mschf", "Read.cv"],
    displayFont: "'Times New Roman', 'Iowan Old Style', Georgia, serif",
    bodyFont: "ui-monospace, 'IBM Plex Mono', 'JetBrains Mono', Menlo, monospace",
    palette: {
      bg: "oklch(98% 0.004 240)",
      surface: "oklch(100% 0 0)",
      fg: "oklch(15% 0.02 100)",
      muted: "oklch(40% 0.02 100)",
      border: "oklch(15% 0.02 100)",
      accent: "oklch(60% 0.22 25)",
    },
    posture: [
      "display = serif at extreme sizes (clamp(80px, 12vw, 200px))",
      "body = monospace — yes, monospace as body, deliberately",
      "borders are full-strength fg (1.5–2px), not muted greys",
      "asymmetric layouts: one column 70%, the other 30%",
      "almost no border-radius (0–2px). No shadows. No gradients.",
      "underline links, no hover decoration — let the typography carry it",
    ],
  },
];

const BY_ID = new Map(DIRECTIONS.map((d) => [d.id, d] as const));

export function getDirection(id: string | null | undefined): Direction | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function listDirections(): Direction[] {
  return DIRECTIONS;
}

export function renderDirectionSpecBlock(): string {
  const lines: string[] = [
    "## Direction library — bind into `:root` when the user picks one",
    "",
    "Each direction below carries a CSS-ready palette (OKLch values) and font stacks. When the user selects one in the direction-form, replace the seed template's `:root` block with that direction's palette and font stacks **verbatim** — do not improvise. Posture cues describe how that direction *behaves* (border weight, radius, accent budget); honour them in the layout choices.",
    "",
  ];
  for (const d of DIRECTIONS) {
    lines.push(`### ${d.name}  \`(id: ${d.id})\``);
    lines.push("");
    lines.push(`**Mood:** ${d.mood}`);
    lines.push("");
    lines.push(`**References:** ${d.references.join(", ")}.`);
    lines.push("");
    lines.push("**Palette (drop into `:root`):**");
    lines.push("");
    lines.push("```css");
    lines.push(`:root {`);
    lines.push(`  --bg:      ${d.palette.bg};`);
    lines.push(`  --surface: ${d.palette.surface};`);
    lines.push(`  --fg:      ${d.palette.fg};`);
    lines.push(`  --muted:   ${d.palette.muted};`);
    lines.push(`  --border:  ${d.palette.border};`);
    lines.push(`  --accent:  ${d.palette.accent};`);
    lines.push("");
    lines.push(`  --font-display: ${d.displayFont};`);
    lines.push(`  --font-body:    ${d.bodyFont};`);
    if (d.monoFont) lines.push(`  --font-mono:    ${d.monoFont};`);
    lines.push(`}`);
    lines.push("```");
    lines.push("");
    lines.push("**Posture:**");
    for (const p of d.posture) lines.push(`- ${p}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function findDirectionByLabel(label: string): Direction | undefined {
  const trimmed = label.trim();
  return DIRECTIONS.find((d) => d.name === trimmed || d.id === trimmed);
}
