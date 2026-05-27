export const CRAFT_TYPOGRAPHY = `## Craft: Typography

Universal typography rules that apply on top of any DESIGN.md. The design system decides *which* fonts; these rules decide *how* they behave at every size.

### Type scale
Use a multiplicative scale (1.2 or 1.25), capped at 6-8 sizes per artifact. Seven named roles:
- Display: 48-72px
- H1: 32-48px
- H2: 24-32px
- H3: 20-24px
- Body: 15-18px
- Small: 13-14px
- Caption: 11-12px

### Line height (leading)
- Display/H1: 1.0-1.2 (tight)
- Body: 1.5-1.6
- Small: 1.5

### Letter-spacing (the "make or break" rule)
This is the single most-skipped rule in AI-generated design:
- Body text: \`0\`
- Small text: \`+0.01em\` to \`+0.02em\`
- UI labels/buttons: \`+0.02em\`
- **ALL CAPS: \`+0.06em\` to \`+0.1em\` (required, no exceptions)**
- Headings 32px+: \`-0.01em\` to \`-0.02em\`
- Display 48px+: \`-0.02em\` to \`-0.03em\`

### Font pairing
Maximum 2 typefaces per artifact. Always declare system fallback chain. Never set \`font-family: system-ui\` alone on a heading.

### Line length
Body copy limited to 50-75 characters per line (\`max-width: 65ch\`).

### Three-weight system
Exactly 3 weights: Read (400/450), Emphasize (510/550), Announce (590/600). Weight 700+ rarely needed.

### Common mistakes (lintable)
- ALL CAPS without tracking >= 0.06em
- Display text without negative tracking
- More than 3 type sizes above the fold
- Mixed serif/slab without role split
- \`text-align: justify\` on body copy
`;

export const CRAFT_COLOR = `## Craft: Color

Universal color rules applied on top of the active DESIGN.md. The design system supplies palette tokens; these rules enforce how to *use* them.

### Palette structure (four layers)
- Neutrals: 70-90% of pixels (\`--bg\`, \`--surface\`, \`--fg\`, \`--muted\`, \`--border\`)
- Accent (one): 5-10% (\`--accent\` only — never invent a second)
- Semantic: 0-5% (\`--success\`, \`--warn\`, \`--danger\`)
- Effect: <1% (gradients, glows; rarely justified)

### Accent discipline
Hard cap of **at most 2 visible uses of \`--accent\` per screen**. Links count as accent. Hover/focus rings count as accent. This is the single biggest readability failure in AI-generated UIs.

### Contrast minimums (gates, not goals)
- Body text (<=16px): 4.5:1
- Large text (>18px or 14px bold): 3:1
- UI components against adjacent surfaces: 3:1
- When brand color clashes, darken accent to 600-level shade for text use.

### Dark themes
No pure black (\`#000\`) or pure white (\`#fff\`). Background \`#0f0f0f\`, foreground \`#f0f0f0\`. Prefer semi-transparent white borders (\`rgba(255,255,255,0.08)\`) over solid dark borders.

### Semantic color naming
Always name tokens by purpose (\`--accent\`, \`--success\`), never by hue (\`--blue-500\`).

### Anti-defaults
- Indigo \`#6366f1\` (Tailwind \`indigo-500\`) is the most reliable AI-slop tell.
- Two-stop "trust" gradient (purple-to-blue, blue-to-cyan) on a hero is the second most reliable tell.
- Decorative gradients with no functional purpose are flagged.
`;

export const CRAFT_ANTI_AI_SLOP = `## Craft: Anti-AI-Slop

Concrete, checkable rules that distinguish "designed by a human who has shipped product" from "default LLM output."

### Seven Cardinal Sins (P0 — must-fix)
1. Default Tailwind indigo as accent (specific hex list: \`#6366f1\`, \`#4f46e5\`, \`#4338ca\`, \`#3730a3\`, \`#8b5cf6\`, \`#7c3aed\`, \`#a855f7\`)
2. Two-stop "trust" gradient on the hero
3. Emoji as feature icons (sparkles, rocket, target, lightning, fire, bulb inside headings, buttons, list items, or icon classes)
4. Sans-serif on display text when the seed binds a serif
5. Rounded card with colored left-border accent (the "AI dashboard tile")
6. Invented metrics ("10x faster", "99.9% uptime")
7. Filler copy (lorem ipsum, "feature one/two/three", placeholder text)

### Soft tells (P1 — should fix)
- Standard "Hero → Features → Pricing → FAQ → CTA" sequence with no variation
- External placeholder image CDNs (unsplash, placehold.co, placekitten, picsum)
- More than ~12 raw hex values outside \`:root\`
- \`var(--accent)\` used 6+ times in rendered body

### Polish tells (P2 — nice to fix)
- Decorative blob/wave SVG backgrounds
- Perfect symmetric layout with no visual tension

### How to add soul
- Aim for ~80% proven patterns + ~20% distinctive choice
- The 20% should live in: one bold visual move, voice/microcopy, one memorable micro-interaction, one product-specific detail
- Litmus test: "If a reviewer screenshots the artifact and someone outside the project can identify which product it's from — you have soul."
`;

export const CRAFT_SECTIONS = {
  typography: CRAFT_TYPOGRAPHY,
  color: CRAFT_COLOR,
  "anti-ai-slop": CRAFT_ANTI_AI_SLOP,
} as const;

export type CraftSection = keyof typeof CRAFT_SECTIONS;

export function getCraftSection(name: CraftSection): string {
  return CRAFT_SECTIONS[name];
}

export function getCraftBlock(sections: CraftSection[]): string {
  if (sections.length === 0) return "";
  return sections.map((s) => CRAFT_SECTIONS[s]).join("\n\n");
}
