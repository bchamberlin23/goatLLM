/**
 * Design system catalog — TypeScript data, not loose markdown files.
 *
 * Each system carries a compact 9-section DESIGN.md (palette, type, spacing,
 * components, motion, voice, brand, anti-patterns) inlined as a string the
 * model reads via the system prompt. We deliberately keep these short
 * (~1500-2500 chars each) so the design stack stays under the model's
 * effective attention budget — the agent shouldn't have to skim a 10-page
 * brand book for every render.
 *
 * v1 ships 18 systems sourced from `VoltAgent/awesome-design-md`
 * (Apache-2.0). Adding more is one object literal each.
 */

export type DesignSystemCategory =
  | "starter"
  | "ai"
  | "devtools"
  | "productivity"
  | "fintech"
  | "media"
  | "automotive"
  | "other";

export interface DesignSystem {
  id: string;
  name: string;
  category: DesignSystemCategory;
  /** One sentence shown on the picker card. */
  tagline: string;
  /** 4-color signature swatch (bg, surface, accent, fg). */
  swatches: [string, string, string, string];
  /** Font stack hint shown on the picker card. */
  fonts: { display: string; body: string; mono: string };
  /** The 9-section DESIGN.md inlined verbatim. */
  designMd: string;
  /** Marks one of the two starter systems. */
  isStarter?: boolean;
}

// ── DESIGN.md template ───────────────────────────────────────────────────

function ds(
  name: string,
  body: {
    voice: string;
    palette: string;
    typography: string;
    spacing: string;
    components: string;
    motion: string;
    brand: string;
    antiPatterns: string;
  },
): string {
  return `# Design System — ${name}

## Voice & posture
${body.voice}

## Palette
${body.palette}

## Typography
${body.typography}

## Spacing & layout
${body.spacing}

## Components
${body.components}

## Motion
${body.motion}

## Brand markers
${body.brand}

## Anti-patterns
${body.antiPatterns}
`;
}

// ── Systems ───────────────────────────────────────────────────────────────

export const DESIGN_SYSTEMS: DesignSystem[] = [
  // Starters
  {
    id: "default",
    name: "Neutral Modern",
    category: "starter",
    tagline: "A calm, confident default. Cool whites, single warm accent.",
    swatches: ["#ffffff", "#f5f5f5", "#f59e42", "#111111"],
    fonts: { display: "Geist", body: "Geist", mono: "JetBrains Mono" },
    isStarter: true,
    designMd: ds("Neutral Modern", {
      voice: "Direct, knowledgeable, restrained. Speaks to builders, not buyers.",
      palette:
        "bg #ffffff · surface #f5f5f5 · sunken #fafafa · fg #111111 · mute #6b7280 · accent #f59e42 · success #16a34a · error #dc2626. One accent, one warm note.",
      typography:
        "Display: Geist 56-96px / 600 / -0.025em. Body: Geist 15-17px / 400 / 1.6. Mono: JetBrains Mono. Tabular figures wherever numbers align.",
      spacing:
        "4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 / 96. Container max 1100px, gutters 24px. 12-col grid for dense layouts, 8-col for marketing.",
      components:
        "Hairlines 1px rgba(0,0,0,0.08). Cards 12px radius. Buttons solid accent or ghost (no outline-only). Focus ring 2px accent at 30% opacity.",
      motion:
        "All transitions 150-200ms ease-out. No bouncy spring curves, no glow pulses, no parallax. Reduce-motion respected.",
      brand:
        "One accent. The most-repeated action is the most confident color (solid amber). Hairlines do the structural work.",
      antiPatterns:
        "No purple→blue gradients. No glow halos. No three-icon feature grids. No centered-everything. No second accent. No drop shadows >4px blur.",
    }),
  },
  {
    id: "warm-editorial",
    name: "Warm Editorial",
    category: "starter",
    tagline: "Print-magazine bones. Cream paper, ink, rust accent.",
    swatches: ["#faf6ee", "#f0e9d8", "#a3471d", "#1a1612"],
    fonts: { display: "GT Sectra", body: "Source Serif Pro", mono: "JetBrains Mono" },
    isStarter: true,
    designMd: ds("Warm Editorial", {
      voice: "Considered, quietly confident. The text earns the page.",
      palette:
        "bg #faf6ee · surface #f0e9d8 · ink #1a1612 · mute #5b554a · accent #a3471d (warm rust) · gold #c89b3c.",
      typography:
        "Display: GT Sectra / Tiempos Headline 64-120px / 500 / -0.02em. Body: Source Serif 17px / 400 / 1.7 / 70-72ch measure. Small caps for byline rules. Drop cap on lead paragraphs.",
      spacing:
        "Baseline 24px, all vertical rhythm in multiples. Generous gutters (32-48px). Allow asymmetry — never center everything.",
      components:
        "Hairline rules 1px ink at 20%. No card shadows. Pull quotes set in italic display, indented and oversized.",
      motion:
        "Almost none. A 200ms fade on lazy-loaded imagery is the maximum. The page reads, it does not perform.",
      brand:
        "Hand-set tracking on display headlines. Tabular figures. A single rust accent for marks of emphasis.",
      antiPatterns:
        "No sans-serif body. No gradient anything. No emoji. No purple. No glassmorphism. No 'badges' beside section heads.",
    }),
  },

  // Devtools
  {
    id: "linear-app",
    name: "Linear",
    category: "devtools",
    tagline: "Cool, structured, restrained. Type does the work.",
    swatches: ["#0d0e10", "#1c1d21", "#5e6ad2", "#f7f8f8"],
    fonts: { display: "Inter", body: "Inter", mono: "Berkeley Mono" },
    designMd: ds("Linear", {
      voice: "Engineering-precise, never marketing-fluffy. Sentences end early.",
      palette:
        "bg #0d0e10 (dark) / #ffffff (light) · surface #1c1d21 / #f4f5f8 · accent #5e6ad2 indigo · fg #f7f8f8 / #0d0e10. One indigo accent.",
      typography:
        "Inter Display 56-72px / 600 / -0.025em. Body Inter 14-15px / 1.55. Mono Berkeley Mono. Heavy use of -0.005em letter-spacing on body for density.",
      spacing:
        "4 / 8 / 12 / 16 / 24 / 32 / 48. Tight content blocks. Sidebars 240-260px, content max 720px.",
      components:
        "Hairlines 1px rgba(255,255,255,0.06). Buttons rounded-md (6px). Focus = indigo ring + subtle glow. Inline kbd chips for shortcuts.",
      motion:
        "Page transitions slide-in 220ms ease-out-quint. Hover states crisp, no >100ms delay.",
      brand:
        "Indigo accent always reserved for the primary action and the focused state. Keyboard shortcuts everywhere.",
      antiPatterns:
        "No emoji icons. No 3D illustrations. No gradient borders. No 'Trusted by 10,000+ teams' rows.",
    }),
  },
  {
    id: "vercel",
    name: "Vercel",
    category: "devtools",
    tagline: "Black, white, geist. The platonic ideal of a developer brand.",
    swatches: ["#000000", "#0a0a0a", "#fafafa", "#fafafa"],
    fonts: { display: "Geist", body: "Geist", mono: "Geist Mono" },
    designMd: ds("Vercel", {
      voice: "Confident minimalism. Black, white, one geometric accent.",
      palette:
        "bg #000000 · surface #0a0a0a / #111111 · text #fafafa · mute #888888. Optional accents: blue #0070f3, pink #ee0099, amber #f5a623 — used at most one per page.",
      typography:
        "Geist 64-96px display / 600. Geist body 14-16px / 1.55. Geist Mono for code. Heavy letter-spacing-tight on display.",
      spacing:
        "4-pt baseline. Container 1280px with 24-48px gutters. Big section paddings (96-128px) on marketing.",
      components:
        "Hairlines 1px rgba(255,255,255,0.10). Buttons black/white invert on hover. Cards have a subtle radial light at the top corner.",
      motion:
        "Subtle. Page mounts use a 320ms cubic-bezier ease-out fade-up. No swooping intros.",
      brand:
        "The triangle mark. Geist everywhere. Any color appears on at most one element per viewport.",
      antiPatterns:
        "No serif body. No second accent visible at once. No gradient text in body copy.",
    }),
  },
  {
    id: "stripe",
    name: "Stripe",
    category: "fintech",
    tagline: "Soft gradients, marketing finesse, zero-defects polish.",
    swatches: ["#ffffff", "#f6f9fc", "#635bff", "#0a2540"],
    fonts: { display: "Sohne", body: "Sohne", mono: "Sohne Mono" },
    designMd: ds("Stripe", {
      voice: "Quietly authoritative. The brand of the brand-of-the-brand.",
      palette:
        "bg #ffffff / #0a2540 (deep navy hero) · surface #f6f9fc · indigo accent #635bff · navy #0a2540. Soft top-of-page gradient permitted (and only there).",
      typography:
        "Sohne 48-80px / 600 / -0.02em. Body Sohne 16-17px / 1.55. Numbers always tabular.",
      spacing:
        "8-pt baseline. Marketing sections 120-160px tall. 12-col grid with optical hangers (-12px on quotes).",
      components:
        "Cards with 0.5px hairline + 16px radius. Soft shadow only on hover. Buttons rounded-full pill, indigo solid.",
      motion:
        "Section reveals via 480ms cubic-bezier ease-out-quart. Reduce-motion strict.",
      brand:
        "The hero gradient sweep. Indigo. The 'Stripe stripe' diagonal motif used sparingly.",
      antiPatterns:
        "No more than one hero gradient per page. No decorative purple blobs. No emoji icons.",
    }),
  },
  {
    id: "cursor",
    name: "Cursor",
    category: "devtools",
    tagline: "IDE-grade dark. Mono headlines, sharp focus rings.",
    swatches: ["#0e0e10", "#1a1a1d", "#16a34a", "#fafafa"],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    designMd: ds("Cursor", {
      voice: "Editor-aware. Speaks the language of code.",
      palette:
        "bg #0e0e10 · surface #1a1a1d · accent #16a34a green · fg #fafafa · mute #71717a.",
      typography:
        "Inter 48-64px / 600. Body Inter 14-15px. Headlines often set in JetBrains Mono for the IDE-feel.",
      spacing:
        "4-pt. Layouts feel like a code editor — gutters narrow, content dense, sidebars persistent.",
      components:
        "Buttons square-ish (4px radius). Focus rings green. Code blocks dominate marketing.",
      motion:
        "Caret-blink rhythms. Cursor demos play at the actual demo speed, never sped up.",
      brand:
        "The cursor mark. Green focus. Mono headline accents.",
      antiPatterns:
        "No glass/blur. No purple. No serif anywhere.",
    }),
  },
  {
    id: "supabase",
    name: "Supabase",
    category: "devtools",
    tagline: "Open-source-flavored dark. Green accent, hex-friendly.",
    swatches: ["#1c1c1c", "#262626", "#3ecf8e", "#ededed"],
    fonts: { display: "Custom Sans", body: "Inter", mono: "Source Code Pro" },
    designMd: ds("Supabase", {
      voice: "Open-source ethos. Builder-to-builder.",
      palette:
        "bg #1c1c1c · surface #262626 · accent #3ecf8e (green) · fg #ededed.",
      typography:
        "Custom Sans 48-64px / 600. Body Inter 14-15px. Mono Source Code Pro.",
      spacing: "4-pt. Documentation-style three-col layouts on docs surface.",
      components:
        "Cards with 0.5px hairline. Buttons green pill. Code blocks with line numbers.",
      motion: "Subtle hover lifts. No scroll-jacking.",
      brand: "Bolt mark. Green focus. Hex-pattern background allowed in hero only.",
      antiPatterns: "No gradient text. No second accent. No emoji.",
    }),
  },
  {
    id: "raycast",
    name: "Raycast",
    category: "devtools",
    tagline: "Warm dark, command-palette aesthetic, soft glow.",
    swatches: ["#1d1d1d", "#262626", "#ff6363", "#fafafa"],
    fonts: { display: "Inter", body: "Inter", mono: "JetBrains Mono" },
    designMd: ds("Raycast", {
      voice: "Friendly precision. A hacker app that loves design.",
      palette:
        "bg #1d1d1d · surface #262626 · accent #ff6363 · fg #fafafa.",
      typography:
        "Inter 48-64px / 600. Body Inter 14-15px / 1.55. Subtle uppercase microcopy at 11px.",
      spacing: "4-pt. Command-palette modals are the design vocabulary.",
      components:
        "Rounded-md buttons. Inline keyboard shortcut chips (kbd). Focus ring red-ish accent.",
      motion: "Soft 200ms transitions. Command-palette open has a subtle scale-in.",
      brand: "The Raycast mark. Coral red. Kbd chips.",
      antiPatterns: "No marketing-blue. No glow-blob backgrounds. No drop shadows >8px.",
    }),
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "devtools",
    tagline: "Error-monitoring brand. Purple, dense data, monospace.",
    swatches: ["#1a1c1f", "#26282d", "#7553ff", "#f0ecf9"],
    fonts: { display: "Rubik", body: "Rubik", mono: "Roboto Mono" },
    designMd: ds("Sentry", {
      voice: "Engineering-frank. A tool that surfaces what broke.",
      palette: "bg #1a1c1f · surface #26282d · accent #7553ff · fg #f0ecf9.",
      typography: "Rubik 48-64px / 600. Body Rubik 14-15px. Mono Roboto Mono. Headings often italic.",
      spacing: "4-pt. Dense, data-rich layouts.",
      components: "Stack-trace blocks dominate. Issue cards with severity color stripe.",
      motion: "Minimal. No animated charts on first paint.",
      brand: "Purple. Italic headings. Owl mark.",
      antiPatterns: "No green CTA. No card shadows.",
    }),
  },
  {
    id: "figma",
    name: "Figma",
    category: "productivity",
    tagline: "Multicolor canvas brand. Bold, friendly, design-forward.",
    swatches: ["#ffffff", "#f5f5f5", "#0acf83", "#1e1e1e"],
    fonts: { display: "Whyte", body: "Inter", mono: "JetBrains Mono" },
    designMd: ds("Figma", {
      voice: "Inviting, design-literate. Speaks to designers as peers.",
      palette: "bg #ffffff · surface #f5f5f5 · accents red #f24e1e, green #0acf83, blue #1abcfe, purple #a259ff (one per moment) · fg #1e1e1e.",
      typography: "Whyte 56-96px / 500-600. Body Inter 15-16px. Headlines often italic.",
      spacing: "4-pt. Generous hero whitespace.",
      components: "Rounded buttons. Multi-stop color brushstroke graphics permitted.",
      motion: "Gentle 280ms hover lifts. Cursor-pointer demos.",
      brand: "Multicolor logomark. Whyte italic display. Black-and-white photography of designers.",
      antiPatterns: "No serif. No marketing-blue alone. No three-icon grids.",
    }),
  },

  // AI
  {
    id: "anthropic",
    name: "Anthropic",
    category: "ai",
    tagline: "Quiet, careful, paper-warm. Built for trust.",
    swatches: ["#f4f0ec", "#ebe5dd", "#cc785c", "#191919"],
    fonts: { display: "Tiempos Headline", body: "Tiempos Text", mono: "Berkeley Mono" },
    designMd: ds("Anthropic", {
      voice: "Measured, values-led, careful. Reads like a research lab that builds products.",
      palette: "bg #f4f0ec · surface #ebe5dd · accent #cc785c (warm clay) · fg #191919 · mute #67635c.",
      typography: "Tiempos Headline 56-88px / 500. Tiempos Text body 17-18px / 1.65. Mono Berkeley Mono.",
      spacing: "8-pt baseline. Generous editorial measure (~70ch).",
      components: "Hairlines 1px ink at 12%. No drop shadows. Cards differentiated by surface color, not borders.",
      motion: "Almost none. The page is an essay, not an experience.",
      brand: "Tiempos serif. Clay accent. The asterisk mark used sparingly.",
      antiPatterns: "No purple. No gradients. No glow. No oversized rounded cards.",
    }),
  },
  {
    id: "openai",
    name: "OpenAI",
    category: "ai",
    tagline: "Black, white, occasional green. Reduced to inevitability.",
    swatches: ["#ffffff", "#f7f7f8", "#10a37f", "#202123"],
    fonts: { display: "Söhne", body: "Söhne", mono: "Söhne Mono" },
    designMd: ds("OpenAI", {
      voice: "Plain, technical, careful. Speaks the language of release notes.",
      palette: "bg #ffffff / #202123 (dark) · surface #f7f7f8 / #2a2b32 · accent #10a37f green · fg #202123 / #ececf1.",
      typography: "Söhne 48-72px / 500-600. Body Söhne 16-17px / 1.55.",
      spacing: "4-pt. Centered hero blocks rare; left-aligned editorial more common.",
      components: "Buttons rounded-md, often outline-only. Focus ring green.",
      motion: "Crisp, fast. <200ms transitions.",
      brand: "The OpenAI mark. Green CTA. Söhne everywhere.",
      antiPatterns: "No purple. No blob backgrounds. No emoji as iconography.",
    }),
  },
  {
    id: "cohere",
    name: "Cohere",
    category: "ai",
    tagline: "Coral-and-cream warmth, gradient hero, generous typography.",
    swatches: ["#ffffff", "#fff7f3", "#ff7759", "#0f0f0f"],
    fonts: { display: "Söhne Breit", body: "Söhne", mono: "JetBrains Mono" },
    designMd: ds("Cohere", {
      voice: "Inviting, business-savvy. Made for the buyer who reads.",
      palette: "bg #ffffff · surface #fff7f3 · accent #ff7759 (coral) · fg #0f0f0f. Hero gradient coral→cream allowed once.",
      typography: "Söhne Breit 56-88px / 500-600. Body Söhne 16-18px / 1.55.",
      spacing: "8-pt. Hero sections 120-160px. Three-up feature grids permitted with restraint.",
      components: "Rounded-2xl cards with 0.5px hairline. Coral CTA pill.",
      motion: "Section reveals 480ms cubic-bezier-ease-out.",
      brand: "Coral. Söhne Breit display. Single-color illustrations.",
      antiPatterns: "No purple. No emoji icons. No glow.",
    }),
  },
  {
    id: "mistral",
    name: "Mistral",
    category: "ai",
    tagline: "Tricolor minimal, French-elegant, typographic confidence.",
    swatches: ["#ffffff", "#fafafa", "#fa7600", "#000000"],
    fonts: { display: "Druk", body: "Inter", mono: "JetBrains Mono" },
    designMd: ds("Mistral", {
      voice: "Direct, confident, slightly French.",
      palette: "bg #ffffff · surface #fafafa · accent #fa7600 (orange) · fg #000000. Tricolor refs (orange/yellow/red) allowed in marks only.",
      typography: "Druk 64-120px / 700 / -0.025em — display only. Body Inter 16-17px / 1.55.",
      spacing: "Big. Hero sections 200px+. Single-column, generous whitespace.",
      components: "Sharp 4px corners. Orange CTA solid.",
      motion: "Almost none. Confidence reads as stillness.",
      brand: "Druk display. Tricolor. The Mistral wind glyph.",
      antiPatterns: "No rounded-xl. No serif body. No second accent visible at once.",
    }),
  },

  // Productivity
  {
    id: "notion",
    name: "Notion",
    category: "productivity",
    tagline: "Hand-drawn marks, soft cream, editorial calm.",
    swatches: ["#ffffff", "#f7f6f3", "#0070f3", "#191919"],
    fonts: { display: "Söhne", body: "Söhne", mono: "JetBrains Mono" },
    designMd: ds("Notion", {
      voice: "Friendly, organized, never corporate.",
      palette: "bg #ffffff · surface #f7f6f3 · accent #0070f3 (link blue) · fg #191919. Functional badges in muted reds, greens, ambers.",
      typography: "Söhne 48-72px / 500. Body Söhne 16-17px / 1.55. Generous inline emoji not as decoration but as content (database labels).",
      spacing: "4-pt. Document-style 720px content max.",
      components: "Toggle blocks, inline databases, callouts with emoji + body. Hairline-thin dividers.",
      motion: "Soft. Page nav fades in 200ms.",
      brand: "Hand-drawn line illustrations. The N mark. Cream surfaces.",
      antiPatterns: "No deep navy. No marketing gradient. No 3D illustrations.",
    }),
  },
  {
    id: "airbnb",
    name: "Airbnb",
    category: "other",
    tagline: "Magenta-pink hospitality, generous photography, rounded warmth.",
    swatches: ["#ffffff", "#f7f7f7", "#ff385c", "#222222"],
    fonts: { display: "Cereal", body: "Cereal", mono: "JetBrains Mono" },
    designMd: ds("Airbnb", {
      voice: "Welcoming, human, photo-led.",
      palette: "bg #ffffff · surface #f7f7f7 · accent #ff385c (rausch pink) · fg #222222.",
      typography: "Airbnb Cereal 32-56px / 600. Body Cereal 14-16px / 1.5.",
      spacing: "8-pt. Photography-first layouts. Card grids with 16-24px gaps.",
      components: "Rounded-xl cards (12-16px). Pink CTA pill. Heart-icon for favorites.",
      motion: "Soft hover scales (1.02x). Image fade-ins.",
      brand: "Bélo mark. Rausch pink. Photography-led hero.",
      antiPatterns: "No dark mode by default. No serif body.",
    }),
  },

  // Other
  {
    id: "apple",
    name: "Apple",
    category: "other",
    tagline: "Pristine surfaces, SF Pro, near-zero chrome.",
    swatches: ["#ffffff", "#f5f5f7", "#0066cc", "#1d1d1f"],
    fonts: { display: "SF Pro Display", body: "SF Pro Text", mono: "SF Mono" },
    designMd: ds("Apple", {
      voice: "Reductive, declarative. The fewest words at the largest size.",
      palette: "bg #ffffff · surface #f5f5f7 · accent #0066cc · fg #1d1d1f.",
      typography: "SF Pro Display 64-128px / 600 / -0.03em. Body SF Pro Text 17-19px / 1.4.",
      spacing: "8-pt. Hero sections occupy entire viewports. Single hero subject per fold.",
      components: "No card chrome. Photography or product render fills the canvas. CTA blue links.",
      motion: "Cinematic scroll-tied reveals. Reduce-motion respected.",
      brand: "The mark. SF Pro Display. Pristine product photography.",
      antiPatterns: "No drop shadows. No gradient borders. No emoji.",
    }),
  },
  {
    id: "tesla",
    name: "Tesla",
    category: "automotive",
    tagline: "Black-on-black, full-bleed photography, monolithic.",
    swatches: ["#000000", "#171a20", "#cc0000", "#ffffff"],
    fonts: { display: "Gotham", body: "Gotham", mono: "JetBrains Mono" },
    designMd: ds("Tesla", {
      voice: "Industrial, declarative. Lets the product be the headline.",
      palette: "bg #000000 / #ffffff · surface #171a20 / #f4f4f4 · accent #cc0000 · fg #ffffff / #171a20.",
      typography: "Gotham 56-96px / 500. Uppercase nav at 12px / 0.12em letter-spacing. Body Gotham 14-16px.",
      spacing: "Full-bleed everything. Sections are viewport-height vehicle photography.",
      components: "Pill buttons. Outline ghost CTA on hero photography.",
      motion: "Slow scroll-tied photo crossfades. No swooping intros.",
      brand: "The T mark. Gotham. Studio-lit vehicle photography.",
      antiPatterns: "No serif. No emoji. No card grids.",
    }),
  },
  {
    id: "spotify",
    name: "Spotify",
    category: "media",
    tagline: "Vibrant green-on-black, gradient album walls, energetic.",
    swatches: ["#000000", "#121212", "#1ed760", "#ffffff"],
    fonts: { display: "Spotify Mix", body: "Spotify Mix", mono: "JetBrains Mono" },
    designMd: ds("Spotify", {
      voice: "Energetic, music-led, opinionated.",
      palette: "bg #000000 · surface #121212 · accent #1ed760 (green) · fg #ffffff. Per-album dynamic gradients permitted.",
      typography: "Spotify Mix 48-80px / 700. Body Spotify Mix 14-15px / 1.5.",
      spacing: "4-pt. Album/playlist cards in dense grids.",
      components: "Rounded-xl cards. Green pill CTA. Album cover saturates the page.",
      motion: "Hover lifts on cards. Audio waveforms animate with the player.",
      brand: "The Spotify wave. Green. Gradient album walls.",
      antiPatterns: "No light mode default. No second accent CTA.",
    }),
  },
];

const BY_ID = new Map(DESIGN_SYSTEMS.map((d) => [d.id, d] as const));

export function getDesignSystem(id: string | null | undefined): DesignSystem | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function listDesignSystems(): DesignSystem[] {
  return DESIGN_SYSTEMS;
}

export function listDesignSystemsByCategory(): Record<DesignSystemCategory, DesignSystem[]> {
  const out: Record<DesignSystemCategory, DesignSystem[]> = {
    starter: [],
    ai: [],
    devtools: [],
    productivity: [],
    fintech: [],
    media: [],
    automotive: [],
    other: [],
  };
  for (const d of DESIGN_SYSTEMS) out[d.category].push(d);
  return out;
}
