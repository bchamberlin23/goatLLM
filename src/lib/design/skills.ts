/**
 * Skill catalog — TypeScript data, not loose markdown files. Each skill
 * carries the SKILL.md guidance + the seed template + reference notes
 * inline so the daemon-less goatLLM design loop never has to fan out to
 * disk or a backend at runtime.
 *
 * Adapted from `nexu-io/open-design`'s skill registry (Apache-2.0,
 * docs/skills-protocol.md). We ship a v1 subset — 14 skills — and add
 * more by appending to the SKILLS array. Adding one skill is one object
 * literal.
 */

export type SkillScenario =
  | "design"
  | "marketing"
  | "operation"
  | "engineering"
  | "product"
  | "finance"
  | "hr"
  | "personal"
  | "sales"
  | "education";

export type SkillMode = "prototype" | "deck" | "document" | "image" | "video" | "audio" | "template" | "design-system";

export interface Skill {
  id: string;
  name: string;
  scenario: SkillScenario;
  mode: SkillMode;
  /** Single-page → one viewport. Multi-frame → grid of phone/tablet frames.
   *  Deck → horizontal-swipe slide framework. */
  preview: { kind: "single-page" | "multi-frame" | "deck"; aspect?: string };
  /** One sentence shown on the picker card. */
  description: string;
  /** Inlined assets/template.html. Becomes the seed file in the project. */
  template: string;
  /** Inlined references/*.md notes (one per reference). The model reads
   *  these as side-files via the system prompt. */
  references: { name: string; body: string }[];
  /** Marks this skill as the picker default for a given mode. */
  defaultFor?: SkillMode;
}

// ── Templates ─────────────────────────────────────────────────────────────
//
// Kept as small as possible — the model fills in the real content. The
// goal is to seed a coherent grid + type rhythm + anti-AI-slop guardrails,
// not to ship a finished page.

const HTML_BASE = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        /* Direction palette is bound here at render time. */
        --bg: #ffffff;
        --fg: #111111;
        --mute: #6b7280;
        --accent: #f59e42;
        --surface: #f5f5f5;
        --hairline: rgba(0, 0, 0, 0.08);
      }
      *, *::before, *::after { box-sizing: border-box; }
      html, body { margin: 0; padding: 0; }
      body {
        background: var(--bg);
        color: var(--fg);
        font-family: 'Inter', system-ui, sans-serif;
        font-feature-settings: "ss01", "cv11";
        -webkit-font-smoothing: antialiased;
        line-height: 1.5;
      }
      .container { max-width: 1100px; margin: 0 auto; padding: 32px 24px; }
      a { color: var(--accent); text-decoration: none; }
      a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="container">
      ${body}
    </div>
  </body>
</html>`;

const PROTOTYPE_REFS = [
  {
    name: "checklist.md",
    body: `# P0 / P1 / P2 checklist

P0 — must pass before emitting <artifact>:
- Single design system. No mixed type families, no second accent color.
- Real content. No "Lorem ipsum", no fake emoji metrics, no "Trusted by 10x more teams".
- Hierarchy. The most important thing on the page is the largest, the most contrasted, or both — never neither.
- Spacing rhythm. All vertical gaps are multiples of one base unit (4 / 8 / 12 / 16).

P1 — strongly preferred:
- One restraint move that signals taste (asymmetry, intentional negative space, an editorial pull-quote).
- One density move (a stat block, a small comparison table, a real testimonial with name + role + company).

P2 — bonus:
- One detail that rewards a second look (a mark of craft — kerning, a tabular figure, a footnote).`,
  },
  {
    name: "anti-slop.md",
    body: `# Anti-AI-slop rules

Reject in your own output:
- Aggressive purple → blue gradients, decorative blob backgrounds, glowing spheres.
- Generic emoji icons (🚀 ⚡ 🎯) used as section heads.
- Three-column "Fast / Secure / Scalable" feature grids with abstract icons.
- Centered-everything layouts. Use a real grid.
- Inter as a *display* face. Inter is a UI face. Use a serif or grotesque display.
- Invented metrics. If you don't have a real number, write "—" or a labelled grey block.`,
  },
];

const DECK_REFS = [
  {
    name: "deck-framework.md",
    body: `# Deck framework rules

- Each <section class="slide"> is one slide. Horizontal swipe, no vertical scroll inside a slide.
- Slide counter in the corner. Format "01 / 12", tabular figures.
- Print stylesheet maps each slide to a page so File → Print → Save as PDF works without surprises.
- Hero / agenda / content / closing — minimum four slides.
- One typographic system per deck. No mid-deck font swap.`,
  },
  {
    name: "checklist.md",
    body: `# Deck P0 checklist

- Title slide carries the deck's strongest typographic statement. Everything else dials back.
- Body slides have one idea each. If a slide needs three bullets, one of them is the headline.
- Numbers are right-aligned tabular figures.
- No drop-shadows, no glow, no background blur.`,
  },
];

// ── Skills ────────────────────────────────────────────────────────────────

export const SKILLS: Skill[] = [
  // ── Prototype × 9 ──
  {
    id: "web-prototype",
    name: "Web prototype",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Single-page HTML — landings, marketing, hero pages.",
    template: HTML_BASE(
      "Web prototype",
      `<header style="padding: 48px 0; border-bottom: 1px solid var(--hairline);">
        <h1 style="font-size: 56px; font-weight: 600; letter-spacing: -0.02em; margin: 0;">Headline lives here.</h1>
        <p style="color: var(--mute); font-size: 18px; max-width: 60ch; margin-top: 16px;">One subhead sentence that earns the rest of the page.</p>
      </header>
      <main style="padding: 48px 0;">
        <!-- Body sections go here. -->
      </main>`,
    ),
    references: PROTOTYPE_REFS,
    defaultFor: "prototype",
  },
  {
    id: "saas-landing",
    name: "SaaS landing",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Hero / features / pricing / CTA marketing layout.",
    template: HTML_BASE(
      "SaaS landing",
      `<nav style="display:flex;justify-content:space-between;align-items:center;padding:20px 0;border-bottom:1px solid var(--hairline);"><strong>Brand</strong><a href="#cta">Get started</a></nav>
      <section style="padding:96px 0 64px;"><h1 style="font-size:64px;font-weight:600;letter-spacing:-0.025em;margin:0;max-width:18ch;">A real promise, in eight words or fewer.</h1><p style="color:var(--mute);font-size:18px;max-width:55ch;margin-top:20px;">One sentence on who it's for and what changes for them on day one.</p></section>
      <section style="padding:64px 0;border-top:1px solid var(--hairline);"><!-- features grid --></section>
      <section style="padding:64px 0;border-top:1px solid var(--hairline);"><!-- pricing --></section>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "dashboard",
    name: "Dashboard",
    scenario: "operation",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Admin / analytics layout with sidebar + dense data grid.",
    template: HTML_BASE(
      "Dashboard",
      `<div style="display:grid;grid-template-columns:220px 1fr;gap:0;min-height:80vh;border:1px solid var(--hairline);border-radius:12px;overflow:hidden;">
        <aside style="background:var(--surface);padding:20px;border-right:1px solid var(--hairline);"><strong>Workspace</strong></aside>
        <main style="padding:24px;"><h2 style="margin:0 0 16px;font-size:22px;">Overview</h2><!-- KPI row + chart + table --></main>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "pricing-page",
    name: "Pricing page",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Standalone pricing tiers + comparison table.",
    template: HTML_BASE(
      "Pricing",
      `<header style="padding:64px 0;text-align:center;"><h1 style="font-size:48px;font-weight:600;letter-spacing:-0.02em;margin:0;">Pricing.</h1><p style="color:var(--mute);font-size:17px;margin-top:12px;">One sentence on the value, then the tiers.</p></header>
      <section style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:32px 0;"><!-- tier cards --></section>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "docs-page",
    name: "Docs page",
    scenario: "engineering",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Three-column documentation layout — nav, content, on-this-page.",
    template: HTML_BASE(
      "Docs",
      `<div style="display:grid;grid-template-columns:240px 1fr 220px;gap:32px;padding:32px 0;">
        <aside style="font-size:13px;line-height:1.9;"><!-- left nav --></aside>
        <article style="font-size:15px;line-height:1.65;max-width:72ch;"><h1 style="font-size:32px;font-weight:600;letter-spacing:-0.01em;">Getting started</h1></article>
        <aside style="font-size:12px;line-height:1.7;color:var(--mute);"><!-- on this page --></aside>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "blog-post",
    name: "Blog post",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Editorial long-form post with measure, drop cap, pull quote.",
    template: HTML_BASE(
      "Blog post",
      `<article style="max-width:72ch;margin:0 auto;padding:64px 0;">
        <header><p style="color:var(--mute);font-size:13px;text-transform:uppercase;letter-spacing:0.08em;">Essay</p><h1 style="font-size:44px;font-weight:600;letter-spacing:-0.02em;line-height:1.1;">A good headline is a small contract.</h1><p style="color:var(--mute);margin-top:16px;">Author Name · 8 min read</p></header>
        <div style="margin-top:32px;font-size:18px;line-height:1.7;"><p>The first paragraph earns the rest.</p></div>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "mobile-app",
    name: "Mobile app",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "9/19.5" },
    description: "iPhone-framed app screen(s) with status bar + home indicator.",
    template: HTML_BASE(
      "Mobile app",
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:32px 0;">
        <div style="aspect-ratio:9/19.5;border:8px solid #1a1a1c;border-radius:42px;overflow:hidden;background:var(--bg);"><!-- screen 1 --></div>
        <div style="aspect-ratio:9/19.5;border:8px solid #1a1a1c;border-radius:42px;overflow:hidden;background:var(--bg);"><!-- screen 2 --></div>
        <div style="aspect-ratio:9/19.5;border:8px solid #1a1a1c;border-radius:42px;overflow:hidden;background:var(--bg);"><!-- screen 3 --></div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "social-carousel",
    name: "Social carousel",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "1/1" },
    description: "Three-card 1080×1080 social carousel with cinematic typography.",
    template: HTML_BASE(
      "Social carousel",
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;padding:32px 0;">
        <div style="aspect-ratio:1;background:var(--surface);padding:32px;border-radius:16px;display:flex;flex-direction:column;justify-content:flex-end;"><h2 style="font-size:32px;line-height:1;font-weight:600;margin:0;">Card 1</h2></div>
        <div style="aspect-ratio:1;background:var(--surface);padding:32px;border-radius:16px;display:flex;flex-direction:column;justify-content:flex-end;"><h2 style="font-size:32px;line-height:1;font-weight:600;margin:0;">Card 2</h2></div>
        <div style="aspect-ratio:1;background:var(--surface);padding:32px;border-radius:16px;display:flex;flex-direction:column;justify-content:flex-end;"><h2 style="font-size:32px;line-height:1;font-weight:600;margin:0;">Card 3</h2></div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "magazine-poster",
    name: "Magazine poster",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Single-page magazine-style poster with display type.",
    template: HTML_BASE(
      "Magazine poster",
      `<article style="aspect-ratio:8/11;background:var(--surface);padding:48px;display:flex;flex-direction:column;justify-content:space-between;">
        <header><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:var(--mute);margin:0;">Issue 01 · 2026</p></header>
        <h1 style="font-size:88px;font-weight:600;letter-spacing:-0.03em;line-height:0.95;margin:0;">Display headline.</h1>
        <footer style="font-size:13px;color:var(--mute);">A subtitle, a name, a date.</footer>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },

  // ── Deck × 3 ──
  {
    id: "simple-deck",
    name: "Simple deck",
    scenario: "design",
    mode: "deck",
    preview: { kind: "deck", aspect: "16/9" },
    description: "Minimal horizontal-swipe deck with typographic discipline.",
    template: HTML_BASE(
      "Simple deck",
      `<style>html,body{height:100%;}.deck{height:100vh;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;}.slide{flex:0 0 100vw;height:100vh;scroll-snap-align:start;display:flex;flex-direction:column;justify-content:center;padding:64px;border-right:1px solid var(--hairline);}.counter{position:fixed;bottom:24px;right:32px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums;}@media print{.slide{height:auto;page-break-after:always;}}</style>
      <div class="deck">
        <section class="slide"><h1 style="font-size:96px;font-weight:600;letter-spacing:-0.03em;margin:0;line-height:0.95;">Title slide.</h1><p style="color:var(--mute);margin-top:24px;font-size:18px;">A real subtitle, a presenter name, a date.</p></section>
        <section class="slide"><h2 style="font-size:48px;font-weight:600;letter-spacing:-0.02em;margin:0 0 24px;">Section heading</h2><p>One idea, on one slide.</p></section>
      </div>
      <div class="counter">01 / 02</div>`,
    ),
    references: DECK_REFS,
    defaultFor: "deck",
  },
  {
    id: "magazine-deck",
    name: "Magazine deck",
    scenario: "marketing",
    mode: "deck",
    preview: { kind: "deck", aspect: "16/9" },
    description: "Editorial-magazine deck — display serif, generous whitespace, pull-quotes.",
    template: HTML_BASE(
      "Magazine deck",
      `<style>html,body{height:100%;font-family:'GT Sectra','Tiempos Headline',Georgia,serif;}.deck{height:100vh;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;}.slide{flex:0 0 100vw;height:100vh;scroll-snap-align:start;padding:80px;display:grid;grid-template-rows:auto 1fr auto;}.counter{position:fixed;bottom:24px;right:32px;font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--mute);font-variant-numeric:tabular-nums;}@media print{.slide{height:auto;page-break-after:always;}}</style>
      <div class="deck">
        <section class="slide"><p style="font-family:'JetBrains Mono',monospace;font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:var(--mute);margin:0;">Issue 01</p><h1 style="font-size:120px;font-weight:500;letter-spacing:-0.025em;line-height:0.95;margin:0;">A display title in a display serif.</h1><p style="color:var(--mute);">Author name · Date</p></section>
      </div>
      <div class="counter">01 / 01</div>`,
    ),
    references: DECK_REFS,
  },
  {
    id: "weekly-update",
    name: "Weekly update",
    scenario: "operation",
    mode: "deck",
    preview: { kind: "deck", aspect: "16/9" },
    description: "Team weekly cadence as a swipe deck — progress, blockers, next.",
    template: HTML_BASE(
      "Weekly update",
      `<style>html,body{height:100%;}.deck{height:100vh;display:flex;overflow-x:auto;scroll-snap-type:x mandatory;}.slide{flex:0 0 100vw;height:100vh;scroll-snap-align:start;padding:64px;}.counter{position:fixed;bottom:24px;right:32px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--mute);font-variant-numeric:tabular-nums;}@media print{.slide{height:auto;page-break-after:always;}}</style>
      <div class="deck">
        <section class="slide"><p style="text-transform:uppercase;letter-spacing:0.1em;font-size:12px;color:var(--mute);margin:0;">Week 21 · 2026</p><h1 style="font-size:72px;font-weight:600;letter-spacing:-0.02em;margin:8px 0 0;">Weekly update</h1></section>
        <section class="slide"><h2 style="font-size:36px;margin:0 0 16px;">Progress</h2><ul style="font-size:18px;line-height:1.8;"><li>—</li></ul></section>
        <section class="slide"><h2 style="font-size:36px;margin:0 0 16px;">Blockers</h2><ul style="font-size:18px;line-height:1.8;"><li>—</li></ul></section>
        <section class="slide"><h2 style="font-size:36px;margin:0 0 16px;">Next</h2><ul style="font-size:18px;line-height:1.8;"><li>—</li></ul></section>
      </div>
      <div class="counter">01 / 04</div>`,
    ),
    references: DECK_REFS,
  },

  // ── Document × 2 ──
  {
    id: "pm-spec",
    name: "PM spec",
    scenario: "product",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Product spec doc with TOC, decisions, open questions.",
    template: HTML_BASE(
      "PM spec",
      `<article style="max-width:72ch;margin:0 auto;padding:64px 24px;font-size:15px;line-height:1.65;">
        <header><p style="color:var(--mute);text-transform:uppercase;font-size:11px;letter-spacing:0.12em;margin:0;">Spec · Draft</p><h1 style="font-size:36px;font-weight:600;letter-spacing:-0.015em;margin:8px 0 0;">Spec title</h1></header>
        <nav style="margin:32px 0;padding:16px;border:1px solid var(--hairline);border-radius:8px;font-size:13px;line-height:1.8;"><strong>Contents</strong><br/>1. Problem · 2. Approach · 3. Open questions · 4. Decisions</nav>
        <section><h2 style="font-size:22px;font-weight:600;border-bottom:1px solid var(--hairline);padding-bottom:8px;">1. Problem</h2><p>—</p></section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "kanban-board",
    name: "Kanban board",
    scenario: "operation",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Snapshot board — backlog · doing · review · done.",
    template: HTML_BASE(
      "Kanban",
      `<header style="padding:24px 0;"><h1 style="font-size:28px;font-weight:600;margin:0;">Sprint board</h1></header>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
        <section style="background:var(--surface);border-radius:12px;padding:16px;min-height:60vh;"><h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Backlog</h3></section>
        <section style="background:var(--surface);border-radius:12px;padding:16px;min-height:60vh;"><h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Doing</h3></section>
        <section style="background:var(--surface);border-radius:12px;padding:16px;min-height:60vh;"><h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Review</h3></section>
        <section style="background:var(--surface);border-radius:12px;padding:16px;min-height:60vh;"><h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Done</h3></section>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },

  // ── Additional Skills ─────────────────────────────────────────────────────
  {
    id: "wireframe-sketch",
    name: "Wireframe sketch",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Low-fidelity wireframe with grey boxes, placeholder text, layout focus.",
    template: HTML_BASE(
      "Wireframe",
      `<div style="padding:32px;border:2px dashed var(--mute);border-radius:8px;">
        <div style="background:var(--surface);height:48px;margin-bottom:24px;"></div>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:24px;">
          <div style="background:var(--surface);height:400px;"></div>
          <div style="display:flex;flex-direction:column;gap:16px;">
            <div style="background:var(--surface);height:120px;"></div>
            <div style="background:var(--surface);height:120px;"></div>
            <div style="background:var(--surface);flex:1;"></div>
          </div>
        </div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "login-flow",
    name: "Login flow",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Authentication screens — login, signup, forgot password.",
    template: HTML_BASE(
      "Login",
      `<div style="display:flex;align-items:center;justify-content:center;min-height:80vh;">
        <div style="width:400px;padding:48px;background:var(--surface);border-radius:16px;">
          <h1 style="font-size:32px;font-weight:600;margin:0 0 32px;">Sign in</h1>
          <form style="display:flex;flex-direction:column;gap:16px;">
            <input type="email" placeholder="Email" style="padding:12px;border:1px solid var(--hairline);border-radius:8px;" />
            <input type="password" placeholder="Password" style="padding:12px;border:1px solid var(--hairline);border-radius:8px;" />
            <button style="padding:12px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Sign in</button>
          </form>
        </div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "faq-page",
    name: "FAQ page",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Expandable FAQ with search, categories, contact CTA.",
    template: HTML_BASE(
      "FAQ",
      `<header style="padding:64px 0;text-align:center;">
        <h1 style="font-size:48px;font-weight:600;margin:0 0 16px;">Frequently asked questions</h1>
        <p style="color:var(--mute);font-size:18px;">Can't find what you're looking for? <a href="#contact">Contact us</a>.</p>
      </header>
      <section style="max-width:720px;margin:0 auto;">
        <details style="padding:24px;border-bottom:1px solid var(--hairline);">
          <summary style="font-size:18px;font-weight:600;cursor:pointer;">Question 1?</summary>
          <p style="color:var(--mute);margin:16px 0 0;">Answer goes here.</p>
        </details>
        <details style="padding:24px;border-bottom:1px solid var(--hairline);">
          <summary style="font-size:18px;font-weight:600;cursor:pointer;">Question 2?</summary>
          <p style="color:var(--mute);margin:16px 0 0;">Answer goes here.</p>
        </details>
      </section>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "mobile-onboarding",
    name: "Mobile onboarding",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "9/19.5" },
    description: "Three-screen onboarding flow with illustrations and CTAs.",
    template: HTML_BASE(
      "Onboarding",
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:32px 0;">
        <div style="aspect-ratio:9/19.5;border:8px solid #1a1a1c;border-radius:42px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column;justify-content:space-between;padding:48px 24px;">
          <div style="background:var(--surface);aspect-ratio:1;border-radius:50%;"></div>
          <div>
            <h2 style="font-size:24px;font-weight:600;margin:0 0 8px;">Welcome</h2>
            <p style="color:var(--mute);font-size:14px;margin:0;">Get started with our app.</p>
          </div>
          <button style="padding:16px;background:var(--accent);color:white;border:none;border-radius:12px;font-weight:600;">Next</button>
        </div>
        <div style="aspect-ratio:9/19.5;border:8px solid #1a1a1c;border-radius:42px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column;justify-content:space-between;padding:48px 24px;">
          <div style="background:var(--surface);aspect-ratio:1;border-radius:50%;"></div>
          <div>
            <h2 style="font-size:24px;font-weight:600;margin:0 0 8px;">Features</h2>
            <p style="color:var(--mute);font-size:14px;margin:0;">Discover what you can do.</p>
          </div>
          <button style="padding:16px;background:var(--accent);color:white;border:none;border-radius:12px;font-weight:600;">Next</button>
        </div>
        <div style="aspect-ratio:9/19.5;border:8px solid #1a1a1c;border-radius:42px;overflow:hidden;background:var(--bg);display:flex;flex-direction:column;justify-content:space-between;padding:48px 24px;">
          <div style="background:var(--surface);aspect-ratio:1;border-radius:50%;"></div>
          <div>
            <h2 style="font-size:24px;font-weight:600;margin:0 0 8px;">Ready?</h2>
            <p style="color:var(--mute);font-size:14px;margin:0;">Let's get started.</p>
          </div>
          <button style="padding:16px;background:var(--accent);color:white;border:none;border-radius:12px;font-weight:600;">Get started</button>
        </div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "waitlist-page",
    name: "Waitlist page",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Pre-launch waitlist with email capture and social proof.",
    template: HTML_BASE(
      "Waitlist",
      `<div style="display:flex;align-items:center;justify-content:center;min-height:80vh;text-align:center;">
        <div style="max-width:560px;">
          <h1 style="font-size:64px;font-weight:600;letter-spacing:-0.025em;margin:0 0 16px;">Something big is coming.</h1>
          <p style="color:var(--mute);font-size:18px;margin:0 0 32px;">Join the waitlist to get early access.</p>
          <form style="display:flex;gap:8px;max-width:400px;margin:0 auto;">
            <input type="email" placeholder="your@email.com" style="flex:1;padding:12px 16px;border:1px solid var(--hairline);border-radius:8px;" />
            <button style="padding:12px 24px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Join</button>
          </form>
          <p style="color:var(--mute);font-size:14px;margin:24px 0 0;">Join 1,234 others on the waitlist.</p>
        </div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "invoice",
    name: "Invoice",
    scenario: "finance",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Professional invoice with line items, totals, payment info.",
    template: HTML_BASE(
      "Invoice",
      `<article style="max-width:720px;margin:0 auto;padding:64px 24px;">
        <header style="display:flex;justify-content:space-between;align-items:start;margin-bottom:48px;">
          <div>
            <h1 style="font-size:36px;font-weight:600;margin:0;">Invoice</h1>
            <p style="color:var(--mute);margin:8px 0 0;">#INV-2026-001</p>
          </div>
          <div style="text-align:right;">
            <p style="margin:0;"><strong>Your Company</strong></p>
            <p style="color:var(--mute);font-size:14px;margin:4px 0 0;">hello@company.com</p>
          </div>
        </header>
        <table style="width:100%;border-collapse:collapse;margin-bottom:32px;">
          <thead>
            <tr style="border-bottom:2px solid var(--hairline);">
              <th style="text-align:left;padding:12px 0;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Description</th>
              <th style="text-align:right;padding:12px 0;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom:1px solid var(--hairline);">
              <td style="padding:16px 0;">Service 1</td>
              <td style="padding:16px 0;text-align:right;">$1,000.00</td>
            </tr>
          </tbody>
          <tfoot>
            <tr style="border-top:2px solid var(--hairline);">
              <td style="padding:16px 0;font-weight:600;">Total</td>
              <td style="padding:16px 0;text-align:right;font-weight:600;">$1,000.00</td>
            </tr>
          </tfoot>
        </table>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "meeting-notes",
    name: "Meeting notes",
    scenario: "operation",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Structured meeting notes with attendees, decisions, action items.",
    template: HTML_BASE(
      "Meeting notes",
      `<article style="max-width:720px;margin:0 auto;padding:64px 24px;">
        <header>
          <p style="color:var(--mute);text-transform:uppercase;font-size:11px;letter-spacing:0.12em;margin:0;">Meeting · May 27, 2026</p>
          <h1 style="font-size:36px;font-weight:600;margin:8px 0 0;">Weekly sync</h1>
        </header>
        <section style="margin:32px 0;padding:16px;background:var(--surface);border-radius:8px;">
          <h3 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Attendees</h3>
          <p style="margin:0;">Alice, Bob, Charlie</p>
        </section>
        <section style="margin-bottom:32px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Decisions</h2>
          <ul style="margin:0;padding-left:20px;line-height:1.8;">
            <li>Decision 1</li>
            <li>Decision 2</li>
          </ul>
        </section>
        <section>
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Action items</h2>
          <ul style="margin:0;padding-left:20px;line-height:1.8;">
            <li><strong>Alice:</strong> Task 1 (by Friday)</li>
            <li><strong>Bob:</strong> Task 2 (by next week)</li>
          </ul>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "resume-modern",
    name: "Resume (modern)",
    scenario: "personal",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Clean, modern resume with sections for experience, education, skills.",
    template: HTML_BASE(
      "Resume",
      `<article style="max-width:720px;margin:0 auto;padding:64px 24px;">
        <header style="text-align:center;margin-bottom:48px;">
          <h1 style="font-size:48px;font-weight:600;letter-spacing:-0.02em;margin:0;">Your Name</h1>
          <p style="color:var(--mute);font-size:18px;margin:8px 0 0;">Software Engineer · San Francisco, CA</p>
          <p style="color:var(--mute);font-size:14px;margin:8px 0 0;">email@example.com · linkedin.com/in/yourname</p>
        </header>
        <section style="margin-bottom:32px;">
          <h2 style="font-size:18px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid var(--hairline);">Experience</h2>
          <div style="margin-bottom:24px;">
            <h3 style="font-size:16px;font-weight:600;margin:0;">Senior Engineer · Company</h3>
            <p style="color:var(--mute);font-size:14px;margin:4px 0;">2022 – Present</p>
            <ul style="margin:8px 0 0;padding-left:20px;line-height:1.6;">
              <li>Accomplishment 1</li>
              <li>Accomplishment 2</li>
            </ul>
          </div>
        </section>
        <section>
          <h2 style="font-size:18px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);margin:0 0 16px;padding-bottom:8px;border-bottom:2px solid var(--hairline);">Education</h2>
          <p style="margin:0;"><strong>BS Computer Science</strong> · University · 2018</p>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "brand-guidelines",
    name: "Brand guidelines",
    scenario: "marketing",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Brand book with logo usage, colors, typography, voice.",
    template: HTML_BASE(
      "Brand guidelines",
      `<article style="max-width:960px;margin:0 auto;padding:64px 24px;">
        <header style="margin-bottom:64px;">
          <h1 style="font-size:56px;font-weight:600;letter-spacing:-0.025em;margin:0;">Brand guidelines</h1>
          <p style="color:var(--mute);font-size:18px;margin:16px 0 0;">How to use our brand assets and maintain consistency.</p>
        </header>
        <section style="margin-bottom:48px;">
          <h2 style="font-size:28px;font-weight:600;margin:0 0 24px;">Logo</h2>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;">
            <div style="aspect-ratio:16/9;background:var(--surface);border-radius:12px;display:flex;align-items:center;justify-content:center;">Primary logo</div>
            <div style="aspect-ratio:16/9;background:var(--surface);border-radius:12px;display:flex;align-items:center;justify-content:center;">Icon mark</div>
          </div>
        </section>
        <section style="margin-bottom:48px;">
          <h2 style="font-size:28px;font-weight:600;margin:0 0 24px;">Colors</h2>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
            <div style="aspect-ratio:1;background:var(--accent);border-radius:12px;"></div>
            <div style="aspect-ratio:1;background:var(--surface);border-radius:12px;"></div>
            <div style="aspect-ratio:1;background:var(--fg);border-radius:12px;"></div>
            <div style="aspect-ratio:1;background:var(--mute);border-radius:12px;"></div>
          </div>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "design-brief",
    name: "Design brief",
    scenario: "design",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Project brief with objectives, audience, deliverables, timeline.",
    template: HTML_BASE(
      "Design brief",
      `<article style="max-width:720px;margin:0 auto;padding:64px 24px;">
        <header>
          <p style="color:var(--mute);text-transform:uppercase;font-size:11px;letter-spacing:0.12em;margin:0;">Brief · Draft</p>
          <h1 style="font-size:36px;font-weight:600;margin:8px 0 0;">Project name</h1>
        </header>
        <section style="margin:32px 0;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Objective</h2>
          <p style="margin:0;">What we're trying to achieve.</p>
        </section>
        <section style="margin-bottom:32px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Target audience</h2>
          <p style="margin:0;">Who this is for.</p>
        </section>
        <section style="margin-bottom:32px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Deliverables</h2>
          <ul style="margin:0;padding-left:20px;line-height:1.8;">
            <li>Deliverable 1</li>
            <li>Deliverable 2</li>
          </ul>
        </section>
        <section>
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Timeline</h2>
          <p style="margin:0;">Key milestones and deadlines.</p>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "email-template",
    name: "Email template",
    scenario: "marketing",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Marketing email with hero, content blocks, CTA.",
    template: HTML_BASE(
      "Email",
      `<div style="max-width:600px;margin:0 auto;background:white;">
        <header style="padding:32px;text-align:center;background:var(--surface);">
          <h1 style="font-size:32px;font-weight:600;margin:0;">Your Company</h1>
        </header>
        <section style="padding:48px 32px;">
          <h2 style="font-size:28px;font-weight:600;margin:0 0 16px;">Subject line</h2>
          <p style="color:var(--mute);line-height:1.6;margin:0 0 24px;">Preview text that appears in the inbox.</p>
          <p style="line-height:1.6;margin:0 0 32px;">Email body content goes here. Keep it concise and scannable.</p>
          <a href="#" style="display:inline-block;padding:12px 24px;background:var(--accent);color:white;text-decoration:none;border-radius:8px;font-weight:600;">Call to action</a>
        </section>
        <footer style="padding:24px 32px;text-align:center;background:var(--surface);">
          <p style="color:var(--mute);font-size:14px;margin:0;">© 2026 Your Company. All rights reserved.</p>
        </footer>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "data-report",
    name: "Data report",
    scenario: "operation",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Analytics report with charts, KPIs, insights.",
    template: HTML_BASE(
      "Data report",
      `<article style="max-width:960px;margin:0 auto;padding:64px 24px;">
        <header style="margin-bottom:48px;">
          <p style="color:var(--mute);text-transform:uppercase;font-size:11px;letter-spacing:0.12em;margin:0;">Report · Q1 2026</p>
          <h1 style="font-size:36px;font-weight:600;margin:8px 0 0;">Performance overview</h1>
        </header>
        <section style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-bottom:48px;">
          <div style="padding:24px;background:var(--surface);border-radius:12px;">
            <p style="color:var(--mute);font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Revenue</p>
            <p style="font-size:32px;font-weight:600;margin:0;">$1.2M</p>
          </div>
          <div style="padding:24px;background:var(--surface);border-radius:12px;">
            <p style="color:var(--mute);font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Users</p>
            <p style="font-size:32px;font-weight:600;margin:0;">24.5K</p>
          </div>
          <div style="padding:24px;background:var(--surface);border-radius:12px;">
            <p style="color:var(--mute);font-size:13px;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 8px;">Growth</p>
            <p style="font-size:32px;font-weight:600;margin:0;">+18%</p>
          </div>
        </section>
        <section>
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Insights</h2>
          <p style="margin:0;">Key findings and recommendations.</p>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "image-poster",
    name: "Image poster",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "2/3" },
    description: "Generate a poster, illustration, or infographic via image generation.",
    template: HTML_BASE(
      "Image",
      `<div style="max-width:800px;margin:0 auto;padding:48px 24px;text-align:center;">
        <h1 style="font-size:48px;font-weight:700;margin:0 0 16px;">Poster Title</h1>
        <p style="color:var(--mute);font-size:18px;max-width:500px;margin:0 auto 32px;">Subtitle or tagline describing the visual.</p>
        <div style="width:100%;aspect-ratio:3/4;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;">
          <p style="color:var(--mute);">Image generation area</p>
        </div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "video-shortform",
    name: "Short-form video",
    scenario: "marketing",
    mode: "video",
    preview: { kind: "single-page", aspect: "9/16" },
    description: "Generate a short-form video or motion graphic for social media.",
    template: HTML_BASE(
      "Video",
      `<div style="max-width:400px;margin:0 auto;padding:24px;text-align:center;">
        <div style="width:100%;aspect-ratio:9/16;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;">
          <p style="color:var(--mute);">Video generation area</p>
        </div>
        <h2 style="font-size:20px;font-weight:600;margin:16px 0 8px;">Video Title</h2>
        <p style="color:var(--mute);font-size:13px;">0:30 · 1080×1920</p>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "audio-jingle",
    name: "Audio / jingle",
    scenario: "marketing",
    mode: "audio",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate audio — jingles, voiceovers, soundtracks, or TTS.",
    template: HTML_BASE(
      "Audio",
      `<div style="max-width:600px;margin:0 auto;padding:48px 24px;text-align:center;">
        <div style="width:100%;padding:48px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
          <h1 style="font-size:28px;font-weight:600;margin:0 0 8px;">Audio Title</h1>
          <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">0:45 · Voice / Instrumental</p>
          <div style="height:4px;background:var(--hairline);border-radius:2px;overflow:hidden;max-width:300px;margin:0 auto;">
            <div style="height:100%;width:30%;background:var(--accent);border-radius:2px;"></div>
          </div>
        </div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "design-system-generator",
    name: "Design system generator",
    scenario: "design",
    mode: "design-system",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Generate a DESIGN.md from brand brief, screenshot, or URL.",
    template: HTML_BASE(
      "Design System",
      `<div style="max-width:960px;margin:0 auto;padding:48px 24px;">
        <h1 style="font-size:32px;font-weight:600;margin:0 0 8px;"># Design System</h1>
        <p style="color:var(--mute);margin:0 0 32px;">Generated from brand input</p>
        <section style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:32px;">
          <div style="height:48px;border-radius:8px;background:var(--bg);border:1px solid var(--hairline);"></div>
          <div style="height:48px;border-radius:8px;background:var(--surface);border:1px solid var(--hairline);"></div>
          <div style="height:48px;border-radius:8px;background:var(--accent);"></div>
          <div style="height:48px;border-radius:8px;background:var(--mute);"></div>
          <div style="height:48px;border-radius:8px;background:var(--fg);"></div>
        </section>
        <div style="margin-bottom:24px;"><h3 style="font-size:18px;font-weight:600;margin:0 0 12px;">Typography</h3><p style="font-size:32px;font-weight:700;margin:0;">Display · Body</p><p style="font-size:16px;margin:4px 0 0;">Body text sample</p></div>
        <div style="margin-bottom:24px;"><h3 style="font-size:18px;font-weight:600;margin:0 0 12px;">Components</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;"><div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;text-align:center;font-size:13px;">Button</div><div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;text-align:center;font-size:13px;">Input</div><div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;text-align:center;font-size:13px;">Card</div></div></div>
      </div>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "sales-proposal",
    name: "Sales proposal",
    scenario: "sales",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Client proposal with pricing, timeline, and case studies.",
    template: HTML_BASE(
      "Proposal",
      `<article style="max-width:800px;margin:0 auto;padding:64px 24px;">
        <header style="margin-bottom:48px;">
          <p style="color:var(--mute);text-transform:uppercase;font-size:11px;letter-spacing:0.12em;margin:0;">Proposal · Client name</p>
          <h1 style="font-size:36px;font-weight:600;margin:8px 0 0;">Project proposal</h1>
        </header>
        <section style="margin-bottom:48px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Scope</h2>
          <p style="line-height:1.7;margin:0;">Define the project scope and deliverables.</p>
        </section>
        <section style="margin-bottom:48px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Pricing</h2>
          <div style="padding:24px;background:var(--surface);border-radius:12px;">
            <p style="font-size:32px;font-weight:600;margin:0;">$X,XXX</p>
            <p style="color:var(--mute);font-size:13px;margin:4px 0 0;">One-time · Net 30</p>
          </div>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
  {
    id: "course-outline",
    name: "Course outline",
    scenario: "education",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Course syllabus with modules, objectives, and schedule.",
    template: HTML_BASE(
      "Course",
      `<article style="max-width:800px;margin:0 auto;padding:64px 24px;">
        <header style="margin-bottom:48px;">
          <h1 style="font-size:36px;font-weight:600;margin:0;">Course title</h1>
          <p style="color:var(--mute);margin:8px 0 0;">Instructor · Term · Level</p>
        </header>
        <section style="margin-bottom:48px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Overview</h2>
          <p style="line-height:1.7;margin:0;">Course description and learning objectives.</p>
        </section>
        <section style="margin-bottom:48px;">
          <h2 style="font-size:22px;font-weight:600;margin:0 0 16px;">Modules</h2>
          <div style="display:grid;gap:16px;">
            <div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;">
              <p style="font-weight:600;margin:0;">Week 1: Introduction</p>
              <p style="color:var(--mute);font-size:13px;margin:4px 0 0;">Topics covered this week.</p>
            </div>
            <div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;">
              <p style="font-weight:600;margin:0;">Week 2: Core concepts</p>
              <p style="color:var(--mute);font-size:13px;margin:4px 0 0;">Topics covered this week.</p>
            </div>
          </div>
        </section>
      </article>`,
    ),
    references: PROTOTYPE_REFS,
  },
];

const BY_ID = new Map(SKILLS.map((s) => [s.id, s] as const));

export function getSkill(id: string | null | undefined): Skill | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function listSkills(): Skill[] {
  return SKILLS;
}

export function listSkillsByScenario(): Record<SkillScenario, Skill[]> {
  const out: Record<SkillScenario, Skill[]> = {
    design: [],
    marketing: [],
    operation: [],
    engineering: [],
    product: [],
    finance: [],
    hr: [],
    sales: [],
    education: [],
    personal: [],
  };
  for (const s of SKILLS) out[s.scenario].push(s);
  return out;
}

export function getDefaultSkill(mode: SkillMode): Skill {
  return SKILLS.find((s) => s.defaultFor === mode) ?? SKILLS[0];
}
