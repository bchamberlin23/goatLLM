---
name: taste-check
description: "Use for a fast anti-slop frontend/UI taste pass. Good for landing pages, portfolios, redesigns, artifacts, and visual polish. For deep design work, pair with impeccable."
mode: both
license: Adapted from Leonxlnx/taste-skill concepts.
---

# Taste Check

Run a focused taste pass on UI work. This is a companion to `impeccable`, not a replacement. Use `impeccable` for full design strategy, responsive systems, or implementation-heavy design tasks.

Start by reading the room:
- What is the surface: product UI, dashboard, landing page, portfolio, docs, or artifact?
- Who is scanning it and what do they need to decide?
- What existing design system or brand rules apply?
- What category cliches should this avoid?

Audit against these checks:
- One clear visual idea. If the page uses cards, gradients, icons, shadows, and giant type all at once, pick a lane.
- No AI defaults: decorative blobs, purple-blue gradients, centered hero plus three feature cards, glass panels everywhere, repeated equal cards.
- Typography fits the surface. Dense tools use smaller, tighter type. Hero scale belongs only to true heroes.
- Layout has rhythm. Do not repeat the same section family over and over.
- Color is disciplined. One accent unless the project design system explicitly says otherwise.
- Buttons fit on one line, contrast passes, and duplicate CTA labels are unified.
- Empty, loading, error, disabled, hover, and focused states are present when the component can enter them.
- Mobile is redesigned, not squeezed.

For goatLLM UI changes specifically, follow `DESIGN.md`: Geist, JetBrains Mono, amber `#f59e42` as the only accent, dark workshop surfaces, and no decorative gradients or blobs.

When reporting, give the smallest useful set of changes. Point at the specific component or section. Do not write a manifesto.
