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
  // ── Additional prototype skills ─────────────────────────────────────
  {
    id: "dating-web",
    name: "Dating web app",
    scenario: "personal",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Consumer dating / matchmaking dashboard with profiles, matches, and chat.",
    template: HTML_BASE("Dating", `<div style="max-width:1200px;margin:0 auto;padding:24px;">
      <header style="display:flex;justify-content:space-between;align-items:center;margin-bottom:32px;padding:16px 24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
        <h1 style="font-size:22px;font-weight:600;margin:0;">Dateflow</h1>
        <nav style="display:flex;gap:24px;font-size:14px;color:var(--mute);">
          <span style="color:var(--accent);font-weight:600;">Discover</span><span>Matches</span><span>Messages</span><span>Profile</span>
        </nav>
      </header>
      <div style="display:grid;grid-template-columns:280px 1fr;gap:24px;">
        <aside style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
          <h2 style="font-size:14px;font-weight:600;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.08em;color:var(--mute);">Filters</h2>
          <div style="margin-bottom:16px;"><p style="font-size:12px;color:var(--mute);margin:0 0 6px;">Age range</p><div style="height:4px;background:var(--hairline);border-radius:2px;"><div style="width:60%;height:100%;background:var(--accent);border-radius:2px;"></div></div></div>
          <div style="margin-bottom:16px;"><p style="font-size:12px;color:var(--mute);margin:0 0 6px;">Distance</p><div style="height:4px;background:var(--hairline);border-radius:2px;"><div style="width:40%;height:100%;background:var(--accent);border-radius:2px;"></div></div></div>
          <div><p style="font-size:12px;color:var(--mute);margin:0 0 8px;">Interests</p><div style="display:flex;flex-wrap:wrap;gap:6px;">${["Travel","Music","Fitness","Food","Art","Tech"].map(t=>`<span style="padding:4px 10px;font-size:12px;border:1px solid var(--hairline);border-radius:100px;">${t}</span>`).join("")}</div></div>
        </aside>
        <main style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">${[1,2,3,4,5,6].map(i=>`<div style="border-radius:16px;border:1px solid var(--hairline);overflow:hidden;background:var(--surface);">
          <div style="aspect-ratio:3/4;background:var(--bg);display:flex;align-items:center;justify-content:center;"><span style="font-size:48px;opacity:0.1;">♥</span></div>
          <div style="padding:12px;"><p style="font-size:15px;font-weight:600;margin:0;">Person ${i}, 28</p><p style="font-size:12px;color:var(--mute);margin:4px 0 0;">2 miles away</p></div>
        </div>`).join("")}</main>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "gamified-app",
    name: "Gamified app",
    scenario: "personal",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "9/19.5" },
    description: "Three-frame gamified mobile app with XP, levels, and daily quests.",
    template: HTML_BASE("Quest", `<div style="max-width:1200px;margin:0 auto;display:flex;gap:24px;padding:24px;">
      ${[{t:"Today's Quests",xp:"240 XP"},{t:"Level 7",xp:"70%"},{t:"Streak",xp:"12 days"}].map((s,i)=>`<div style="flex:1;background:var(--surface);border:1px solid var(--hairline);border-radius:24px;overflow:hidden;">
        <div style="padding:24px;text-align:center;">
          <div style="width:48px;height:48px;border-radius:50%;background:var(--accent);margin:0 auto 16px;display:flex;align-items:center;justify-content:center;color:white;font-weight:700;">${i+1}</div>
          <h2 style="font-size:18px;font-weight:600;margin:0 0 4px;">${s.t}</h2>
          <p style="font-size:14px;color:var(--accent);margin:0;">${s.xp}</p>
          <div style="margin-top:16px;height:6px;background:var(--hairline);border-radius:3px;overflow:hidden;"><div style="width:${60+i*15}%;height:100%;background:var(--accent);border-radius:3px;"></div></div>
        </div>
        <div style="padding:16px;">${["Complete 3 tasks","Read 10 minutes","Exercise 20 min"].map(t=>`<div style="padding:10px 12px;margin-bottom:8px;background:var(--bg);border:1px solid var(--hairline);border-radius:8px;display:flex;justify-content:space-between;align-items:center;"><span style="font-size:13px;">${t}</span><span style="font-size:11px;color:var(--accent);">+50 XP</span></div>`).join("")}</div>
      </div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "sprite-animation",
    name: "Sprite animation",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Pixel / 8-bit animated explainer with CSS sprite-sheet animations.",
    template: HTML_BASE("8-Bit", `<div style="max-width:960px;margin:0 auto;padding:48px 24px;text-align:center;background:var(--bg);">
      <div style="font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:var(--accent);margin-bottom:16px;">Press Start</div>
      <h1 style="font-size:48px;font-weight:800;margin:0 0 24px;">8-Bit Adventure</h1>
      <div style="width:120px;height:120px;margin:0 auto 24px;background:var(--surface);border:2px solid var(--fg);border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:48px;">🎮</div>
      <p style="font-size:16px;color:var(--mute);max-width:400px;margin:0 auto 32px;">Pixel-perfect retro design with CSS keyframe animations.</p>
      <div style="display:flex;justify-content:center;gap:16px;">
        <button style="padding:12px 24px;background:var(--accent);color:white;border:none;border-radius:4px;font-size:14px;font-weight:700;">Play</button>
        <button style="padding:12px 24px;background:transparent;border:2px solid var(--fg);border-radius:4px;font-size:14px;font-weight:700;">Options</button>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "motion-hero",
    name: "Motion hero",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Single-frame motion-design hero with looping CSS animations.",
    template: HTML_BASE("Motion", `<div style="max-width:960px;margin:0 auto;padding:64px 24px;text-align:center;">
      <div style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin-bottom:24px;">In Motion</div>
      <h1 style="font-size:clamp(36px,8vw,72px);font-weight:700;margin:0 0 24px;line-height:1.1;">Design that<br/>moves you.</h1>
      <p style="font-size:18px;color:var(--mute);max-width:500px;margin:0 auto 40px;">Kinetic typography, animated layouts, and CSS-driven motion graphics.</p>
      <div style="display:flex;justify-content:center;gap:32px;font-size:14px;color:var(--mute);"><span>Animation</span><span>Typography</span><span>Motion</span></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "email-marketing",
    name: "Email marketing",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Brand product-launch HTML email — masthead, hero, CTA, specs grid.",
    template: HTML_BASE("Email", `<div style="max-width:600px;margin:0 auto;background:white;color:#1a1a1a;">
      <div style="padding:24px;text-align:center;background:var(--accent);color:white;"><h1 style="font-size:24px;font-weight:700;margin:0;">Product Launch</h1></div>
      <div style="padding:32px;"><h2 style="font-size:28px;font-weight:600;margin:0 0 12px;">Introducing the future.</h2>
      <p style="color:#666;line-height:1.6;margin:0 0 24px;">A new way to work, built from the ground up for teams that ship fast.</p>
      <a href="#" style="display:inline-block;padding:14px 28px;background:var(--accent);color:white;text-decoration:none;border-radius:8px;font-weight:600;">Learn more →</a></div>
      <div style="padding:24px 32px;background:#f5f5f5;"><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">
        ${["50ms latency","99.99% uptime","10M+ users"].map(s=>`<div><p style="font-size:24px;font-weight:700;margin:0;">${s.split(" ")[0]}</p><p style="font-size:12px;color:#666;margin:4px 0 0;">${s.split(" ").slice(1).join(" ")}</p></div>`).join("")}
      </div></div>
      <div style="padding:16px 32px;text-align:center;font-size:11px;color:#999;">© 2026 Your Company. All rights reserved.</div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "social-story",
    name: "Social story",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "9/16" },
    description: "Three-screen social media story sequence for Instagram/TikTok.",
    template: HTML_BASE("Story", `<div style="max-width:1200px;margin:0 auto;display:flex;gap:16px;padding:24px;justify-content:center;">
      ${[1,2,3].map(i=>`<div style="width:270px;height:480px;background:var(--surface);border:1px solid var(--hairline);border-radius:24px;padding:24px;display:flex;flex-direction:column;justify-content:space-between;">
        <div><div style="height:3px;background:var(--hairline);border-radius:2px;margin-bottom:16px;"><div style="width:${i*33}%;height:100%;background:var(--accent);border-radius:2px;"></div></div>
        <p style="font-size:11px;color:var(--mute);text-transform:uppercase;letter-spacing:0.1em;">Story ${i}/3</p></div>
        <div><h2 style="font-size:24px;font-weight:700;margin:0 0 8px;">Slide ${i}</h2><p style="font-size:14px;color:var(--mute);">Swipe to see more →</p></div>
      </div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "pricing-table",
    name: "Pricing table",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Standalone pricing comparison table with tiers and feature matrix.",
    template: HTML_BASE("Pricing", `<div style="max-width:960px;margin:0 auto;padding:64px 24px;">
      <div style="text-align:center;margin-bottom:48px;"><h1 style="font-size:36px;font-weight:700;margin:0 0 8px;">Simple pricing</h1><p style="color:var(--mute);">Choose the plan that works for your team.</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${[{n:"Starter",p:"$0",f:["5 projects","1 user","Community support"]},{n:"Pro",p:"$29",f:["Unlimited projects","5 users","Priority support","API access"],h:true},{n:"Enterprise",p:"Custom",f:["Everything in Pro","SSO","Dedicated support","SLA"]}].map(t=>`<div style="padding:32px;background:${t.h?"var(--accent)":"var(--surface)"};border:1px solid ${t.h?"var(--accent)":"var(--hairline)"};border-radius:12px;color:${t.h?"white":"inherit"};">
          <h3 style="font-size:18px;font-weight:600;margin:0 0 8px;">${t.n}</h3>
          <p style="font-size:36px;font-weight:700;margin:0 0 24px;">${t.p}<span style="font-size:14px;font-weight:400;opacity:0.7;">/mo</span></p>
          ${t.f.map(f=>`<p style="font-size:14px;margin:0 0 8px;opacity:0.9;">✓ ${f}</p>`).join("")}
          <button style="width:100%;padding:12px;margin-top:24px;background:${t.h?"white":"var(--accent)"};color:${t.h?"var(--accent)":"white"};border:none;border-radius:8px;font-weight:600;">Get started</button>
        </div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "portfolio",
    name: "Portfolio",
    scenario: "personal",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Creative portfolio with project grid, case studies, and about section.",
    template: HTML_BASE("Portfolio", `<div style="max-width:1100px;margin:0 auto;padding:64px 24px;">
      <header style="margin-bottom:64px;"><h1 style="font-size:48px;font-weight:700;margin:0 0 12px;">Jane Designer</h1><p style="font-size:20px;color:var(--mute);">Product designer building tools for creative teams.</p></header>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:24px;margin-bottom:64px;">
        ${[{t:"Linear",d:"Design system & product design"},{t:"Figma",d:"Plugin ecosystem design"},{t:"Stripe",d:"Dashboard redesign"},{t:"Notion",d:"Mobile app design"}].map(p=>`<div style="aspect-ratio:16/10;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:24px;display:flex;flex-direction:column;justify-content:flex-end;">
          <h3 style="font-size:20px;font-weight:600;margin:0 0 4px;">${p.t}</h3><p style="font-size:14px;color:var(--mute);margin:0;">${p.d}</p>
        </div>`).join("")}
      </div>
      <section style="max-width:600px;"><h2 style="font-size:28px;font-weight:600;margin:0 0 16px;">About</h2><p style="color:var(--mute);line-height:1.7;">10 years of product design. Previously at Stripe, Linear, and Figma. I believe in restraint, clarity, and shipping.</p></section>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "changelog",
    name: "Changelog",
    scenario: "engineering",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Product changelog with versioned entries, tags, and dates.",
    template: HTML_BASE("Changelog", `<div style="max-width:700px;margin:0 auto;padding:64px 24px;">
      <h1 style="font-size:36px;font-weight:700;margin:0 0 8px;">Changelog</h1><p style="color:var(--mute);margin:0 0 48px;">What's new in the product.</p>
      ${[{v:"2.4.0",d:"May 2026",items:["New dashboard design","API v2 endpoints","Dark mode support"]},{v:"2.3.1",d:"April 2026",items:["Bug fixes","Performance improvements"]},{v:"2.3.0",d:"March 2026",items:["Team workspaces","SSO integration","Export to PDF"]}].map(r=>`<div style="margin-bottom:48px;"><div style="display:flex;align-items:baseline;gap:12px;margin-bottom:16px;"><h2 style="font-size:22px;font-weight:600;margin:0;">${r.v}</h2><span style="font-size:13px;color:var(--mute);">${r.d}</span></div>
      <ul style="margin:0;padding-left:20px;">${r.items.map(i=>`<li style="margin-bottom:8px;color:var(--mute);line-height:1.6;">${i}</li>`).join("")}</ul></div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "testimonials",
    name: "Testimonials",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Customer testimonial wall with quotes, photos, and company logos.",
    template: HTML_BASE("Testimonials", `<div style="max-width:960px;margin:0 auto;padding:64px 24px;">
      <div style="text-align:center;margin-bottom:48px;"><h1 style="font-size:36px;font-weight:700;margin:0 0 8px;">Loved by teams</h1><p style="color:var(--mute);">What our customers say.</p></div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${[{q:"Best tool we've used. Period.",n:"Sarah K.",r:"VP Engineering"},{q:"Changed how our team ships product.",n:"Mike T.",r:"CTO"},{q:"Simple, fast, reliable. Exactly what we needed.",n:"Lisa W.",r:"Head of Design"},{q:"The ROI was clear within the first week.",n:"David C.",r:"CEO"},{q:"Our designers and engineers finally speak the same language.",n:"Amy R.",r:"Product Lead"},{q:"Game-changer for our workflow.",n:"Tom H.",r:"Engineering Manager"}].map(t=>`<div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
          <p style="font-size:15px;line-height:1.6;margin:0 0 16px;font-style:italic;">"${t.q}"</p>
          <div style="display:flex;align-items:center;gap:10px;"><div style="width:32px;height:32px;border-radius:50%;background:var(--accent);"></div><div><p style="font-size:13px;font-weight:600;margin:0;">${t.n}</p><p style="font-size:12px;color:var(--mute);margin:0;">${t.r}</p></div></div>
        </div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "feature-comparison",
    name: "Feature comparison",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Product comparison table — us vs competitors.",
    template: HTML_BASE("Compare", `<div style="max-width:800px;margin:0 auto;padding:64px 24px;">
      <div style="text-align:center;margin-bottom:48px;"><h1 style="font-size:36px;font-weight:700;margin:0 0 8px;">How we compare</h1><p style="color:var(--mute);">See why teams choose us.</p></div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead><tr style="border-bottom:2px solid var(--hairline);"><th style="padding:12px;text-align:left;color:var(--mute);font-weight:500;">Feature</th><th style="padding:12px;text-align:center;font-weight:600;color:var(--accent);">Us</th><th style="padding:12px;text-align:center;color:var(--mute);">Competitor A</th><th style="padding:12px;text-align:center;color:var(--mute);">Competitor B</th></tr></thead>
        <tbody>${[["Real-time collaboration","✓","✓","✗"],["API access","✓","Limited","✓"],["SSO","✓","✗","✓"],["Custom integrations","✓","✗","Limited"],["24/7 support","✓","✗","✗"],["Free tier","✓","✓","✗"]].map(r=>`<tr style="border-bottom:1px solid var(--hairline);"><td style="padding:12px;">${r[0]}</td><td style="padding:12px;text-align:center;color:var(--accent);font-weight:600;">${r[1]}</td><td style="padding:12px;text-align:center;color:var(--mute);">${r[2]}</td><td style="padding:12px;text-align:center;color:var(--mute);">${r[3]}</td></tr>`).join("")}</tbody>
      </table>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "status-page",
    name: "Status page",
    scenario: "engineering",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "System status page with uptime indicators, incident history, and metrics.",
    template: HTML_BASE("Status", `<div style="max-width:700px;margin:0 auto;padding:64px 24px;">
      <div style="text-align:center;margin-bottom:48px;"><h1 style="font-size:32px;font-weight:700;margin:0 0 12px;">System Status</h1>
      <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:rgba(34,197,94,0.1);border-radius:100px;"><div style="width:8px;height:8px;border-radius:50%;background:#22c55e;"></div><span style="font-size:14px;font-weight:600;color:#22c55e;">All systems operational</span></div></div>
      <div style="margin-bottom:48px;"><h2 style="font-size:18px;font-weight:600;margin:0 0 16px;">Uptime — 90 days</h2>
      <div style="display:flex;gap:2px;height:32px;">${Array.from({length:90},()=>`<div style="flex:1;background:#22c55e;border-radius:1px;" title="100%"></div>`).join("")}</div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mute);margin-top:4px;"><span>90 days ago</span><span>99.99% uptime</span><span>Today</span></div></div>
      <h2 style="font-size:18px;font-weight:600;margin:0 0 16px;">Components</h2>
      ${["API","Web App","Database","CDN"].map(c=>`<div style="display:flex;justify-content:space-between;padding:12px;border-bottom:1px solid var(--hairline);"><span style="font-size:14px;">${c}</span><span style="font-size:13px;color:#22c55e;">Operational</span></div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "error-page",
    name: "Error page",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Custom 404 / error page with personality.",
    template: HTML_BASE("404", `<div style="max-width:500px;margin:0 auto;padding:64px 24px;text-align:center;min-height:80vh;display:flex;flex-direction:column;justify-content:center;">
      <div style="font-size:96px;font-weight:800;color:var(--accent);margin-bottom:16px;">404</div>
      <h1 style="font-size:24px;font-weight:600;margin:0 0 12px;">Page not found</h1>
      <p style="color:var(--mute);margin:0 0 32px;">The page you're looking for doesn't exist or has been moved.</p>
      <div style="display:flex;justify-content:center;gap:12px;"><a href="#" style="padding:12px 24px;background:var(--accent);color:white;border-radius:8px;text-decoration:none;font-weight:600;">Go home</a><a href="#" style="padding:12px 24px;border:1px solid var(--hairline);border-radius:8px;text-decoration:none;color:var(--fg);">Contact support</a></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "onboarding-screens",
    name: "Onboarding screens",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "9/19.5" },
    description: "3-screen mobile onboarding with swipe dots and primary CTA.",
    template: HTML_BASE("Onboarding", `<div style="max-width:1200px;margin:0 auto;display:flex;gap:24px;padding:24px;">
      ${[{t:"Welcome",d:"Your journey starts here.",i:"👋"},{t:"Discover",d:"Find what matters to you.",i:"🔍"},{t:"Get Started",d:"You're all set!",i:"🚀"}].map((s,i)=>`<div style="flex:1;background:var(--surface);border:1px solid var(--hairline);border-radius:24px;padding:32px;display:flex;flex-direction:column;justify-content:space-between;text-align:center;">
        <div style="font-size:48px;margin-bottom:24px;">${s.i}</div>
        <div><h2 style="font-size:22px;font-weight:700;margin:0 0 8px;">${s.t}</h2><p style="color:var(--mute);font-size:14px;">${s.d}</p></div>
        <div><div style="display:flex;justify-content:center;gap:6px;margin-bottom:16px;">${[0,1,2].map(j=>`<div style="width:8px;height:8px;border-radius:50%;background:${j===i?"var(--accent)":"var(--hairline)"};"></div>`).join("")}</div>
        <button style="width:100%;padding:14px;background:var(--accent);color:white;border:none;border-radius:12px;font-weight:600;">${i===2?"Get Started":"Next"}</button></div>
      </div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "settings-page",
    name: "Settings page",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Account settings with tabs, form controls, and toggle switches.",
    template: HTML_BASE("Settings", `<div style="max-width:800px;margin:0 auto;padding:32px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 24px;">Settings</h1>
      <div style="display:flex;gap:32px;">
        <nav style="width:180px;flex-shrink:0;">${["General","Security","Notifications","Billing","Integrations"].map((t,i)=>`<div style="padding:8px 12px;font-size:14px;border-radius:6px;margin-bottom:4px;${i===0?"background:var(--accent);color:white;font-weight:600;":"color:var(--mute);"}">${t}</div>`).join("")}</nav>
        <div style="flex:1;">
          ${[{l:"Display name",v:"Jane Designer",t:"text"},{l:"Email",v:"jane@example.com",t:"text"},{l:"Dark mode",v:"Enabled",t:"toggle"},{l:"Two-factor auth",v:"Disabled",t:"toggle"}].map(f=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-bottom:1px solid var(--hairline);"><div><p style="font-size:14px;font-weight:500;margin:0;">${f.l}</p><p style="font-size:13px;color:var(--mute);margin:2px 0 0;">${f.v}</p></div>${f.t==="toggle"?`<div style="width:40px;height:22px;border-radius:11px;background:${f.v==="Enabled"?"var(--accent)":"var(--hairline)"};"><div style="width:18px;height:18px;border-radius:50%;background:white;margin:2px ${f.v==="Enabled"?"20px":"2px"};"></div></div>`:""}</div>`).join("")}
          <button style="margin-top:24px;padding:10px 20px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Save changes</button>
        </div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "notification-center",
    name: "Notification center",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Notification inbox with read/unread states, actions, and filters.",
    template: HTML_BASE("Notifications", `<div style="max-width:600px;margin:0 auto;padding:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;"><h1 style="font-size:24px;font-weight:700;margin:0;">Notifications</h1><button style="font-size:13px;color:var(--accent);background:none;border:none;">Mark all read</button></div>
      ${[{t:"New comment on your design",d:"Sarah left a comment on 'Homepage v3'",t2:"2m ago",r:true},{t:"Deployment succeeded",d:"Production deploy completed successfully",t2:"15m ago",r:true},{t:"New team member",d:"Mike T. joined the workspace",t2:"1h ago",r:false},{t:"Billing update",d:"Your invoice for May is ready",t2:"3h ago",r:false},{t:"Feature request upvoted",d:"Dark mode was upvoted 12 times",t2:"Yesterday",r:false}].map(n=>`<div style="display:flex;gap:12px;padding:14px;margin-bottom:8px;background:${n.r?"rgba(245,158,66,0.04)":"var(--surface)"};border:1px solid ${n.r?"rgba(245,158,66,0.2)":"var(--hairline)"};border-radius:8px;">
        <div style="width:8px;height:8px;border-radius:50%;background:${n.r?"var(--accent)":"transparent"};margin-top:6px;flex-shrink:0;"></div>
        <div style="flex:1;"><p style="font-size:14px;font-weight:${n.r?"600":"400"};margin:0;">${n.t}</p><p style="font-size:13px;color:var(--mute);margin:2px 0 0;">${n.d}</p></div>
        <span style="font-size:12px;color:var(--mute);white-space:nowrap;">${n.t2}</span>
      </div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "search-results",
    name: "Search results",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Search results page with filters, facets, and result cards.",
    template: HTML_BASE("Search", `<div style="max-width:900px;margin:0 auto;padding:32px;">
      <div style="margin-bottom:24px;padding:14px 16px;background:var(--surface);border:1px solid var(--hairline);border-radius:10px;display:flex;align-items:center;gap:10px;"><span style="color:var(--mute);font-size:14px;">🔍</span><span style="font-size:14px;color:var(--mute);">Search for anything...</span></div>
      <p style="font-size:13px;color:var(--mute);margin:0 0 16px;">Showing 24 results for "design system"</p>
      <div style="display:flex;gap:8px;margin-bottom:24px;">${["All","Pages","Components","Docs","Blog"].map((f,i)=>`<button style="padding:6px 14px;font-size:13px;border:1px solid ${i===0?"var(--accent)":"var(--hairline)"};background:${i===0?"var(--accent)":"transparent"};color:${i===0?"white":"var(--mute)"};border-radius:100px;">${f}</button>`).join("")}</div>
      ${[{t:"Design System Documentation",u:"docs.example.com/design-system",d:"Complete guide to building and maintaining design systems at scale."},{t:"Component Library",u:"example.com/components",d:"Production-ready React components with TypeScript support."},{t:"Design Tokens",u:"docs.example.com/tokens",d:"How to use design tokens for consistent styling across platforms."},{t:"Brand Guidelines",u:"example.com/brand",d:"Official brand guidelines for logos, colors, and typography."},{t:"Design System Blog",u:"blog.example.com/design",d:"Articles about design systems, component architecture, and more."}].map(r=>`<div style="padding:16px;margin-bottom:12px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;"><p style="font-size:16px;font-weight:600;margin:0 0 4px;color:var(--accent);">${r.t}</p><p style="font-size:12px;color:var(--mute);margin:0 0 6px;">${r.u}</p><p style="font-size:14px;color:var(--mute);margin:0;">${r.d}</p></div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "timeline",
    name: "Timeline",
    scenario: "product",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Product roadmap timeline with milestones and progress.",
    template: HTML_BASE("Timeline", `<div style="max-width:700px;margin:0 auto;padding:64px 24px;">
      <h1 style="font-size:36px;font-weight:700;margin:0 0 8px;">Roadmap</h1><p style="color:var(--mute);margin:0 0 48px;">What we're building and when.</p>
      ${[{q:"Q1 2026",items:[{t:"Design system v2",s:"done"},{t:"API v3",s:"done"},{t:"Mobile app",s:"done"}]},{q:"Q2 2026",items:[{t:"Team workspaces",s:"in_progress"},{t:"AI features",s:"in_progress"},{t:"Plugin ecosystem",s:"planned"}]},{q:"Q3 2026",items:[{t:"Enterprise SSO",s:"planned"},{t:"Marketplace",s:"planned"},{t:"Global CDN",s:"planned"}]}].map(q=>`<div style="margin-bottom:40px;"><h2 style="font-size:18px;font-weight:600;margin:0 0 16px;">${q.q}</h2>
      ${q.items.map(i=>`<div style="display:flex;align-items:center;gap:12px;padding:10px 0;"><div style="width:10px;height:10px;border-radius:50%;border:2px solid ${i.s==="done"?"#22c55e":i.s==="in_progress"?"var(--accent)":"var(--hairline)"};background:${i.s==="done"?"#22c55e":"transparent"};"></div><span style="font-size:14px;">${i.t}</span><span style="font-size:12px;color:var(--mute);margin-left:auto;">${i.s==="done"?"✓ Shipped":i.s==="in_progress"?"In progress":"Planned"}</span></div>`).join("")}</div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "empty-state",
    name: "Empty state",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Empty state illustration with CTA for first-time users.",
    template: HTML_BASE("Empty State", `<div style="max-width:400px;margin:0 auto;padding:64px 24px;text-align:center;min-height:60vh;display:flex;flex-direction:column;justify-content:center;">
      <div style="width:80px;height:80px;margin:0 auto 24px;background:var(--surface);border:1px solid var(--hairline);border-radius:20px;display:flex;align-items:center;justify-content:center;font-size:36px;">📂</div>
      <h2 style="font-size:20px;font-weight:600;margin:0 0 8px;">No projects yet</h2>
      <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">Create your first project to get started. It only takes a minute.</p>
      <button style="padding:12px 24px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;display:inline-block;">Create project</button>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "landing-minimal",
    name: "Minimal landing",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Ultra-minimal landing page — hero, one line, CTA.",
    template: HTML_BASE("Minimal", `<div style="max-width:600px;margin:0 auto;padding:120px 24px;text-align:center;">
      <h1 style="font-size:clamp(32px,6vw,56px);font-weight:700;line-height:1.1;margin:0 0 16px;">Ship faster.</h1>
      <p style="font-size:18px;color:var(--mute);margin:0 0 32px;">The platform for teams that move fast and build things.</p>
      <div style="display:flex;justify-content:center;gap:12px;"><button style="padding:14px 28px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Get started</button><button style="padding:14px 28px;background:transparent;border:1px solid var(--hairline);border-radius:8px;font-weight:500;">Learn more</button></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "docs-3col",
    name: "Documentation (3-column)",
    scenario: "engineering",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Three-column documentation layout with sidebar nav, content, and TOC.",
    template: HTML_BASE("Docs", `<div style="display:flex;min-height:100vh;">
      <nav style="width:220px;padding:24px;border-right:1px solid var(--hairline);flex-shrink:0;">
        <p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent);margin:0 0 12px;">Getting Started</p>
        ${["Introduction","Installation","Quick Start","Configuration"].map(t=>`<a href="#" style="display:block;padding:4px 0;font-size:14px;color:${t==="Introduction"?"var(--fg)":"var(--mute)"};text-decoration:none;">${t}</a>`).join("")}
        <p style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent);margin:16px 0 12px;">API Reference</p>
        ${["Authentication","Endpoints","Rate Limits","Webhooks"].map(t=>`<a href="#" style="display:block;padding:4px 0;font-size:14px;color:var(--mute);text-decoration:none;">${t}</a>`).join("")}
      </nav>
      <main style="flex:1;padding:32px 48px;max-width:700px;">
        <h1 style="font-size:32px;font-weight:700;margin:0 0 12px;">Introduction</h1>
        <p style="color:var(--mute);line-height:1.7;margin:0 0 24px;">Welcome to the documentation. This guide will help you get started with our platform in minutes.</p>
        <div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;font-family:monospace;font-size:13px;">npm install @example/sdk</div>
      </main>
      <aside style="width:180px;padding:24px;border-left:1px solid var(--hairline);flex-shrink:0;">
        <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--mute);margin:0 0 8px;">On this page</p>
        ${["Overview","Installation","Next steps"].map(t=>`<a href="#" style="display:block;padding:3px 0;font-size:13px;color:var(--mute);text-decoration:none;">${t}</a>`).join("")}
      </aside>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "data-table",
    name: "Data table",
    scenario: "product",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Full-featured data table with sorting, filtering, pagination, and row actions.",
    template: HTML_BASE("Table", `<div style="max-width:1000px;margin:0 auto;padding:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;"><h1 style="font-size:24px;font-weight:700;margin:0;">Users</h1><button style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;font-weight:600;font-size:13px;">+ Add user</button></div>
      <div style="display:flex;gap:8px;margin-bottom:16px;"><div style="padding:8px 12px;background:var(--surface);border:1px solid var(--hairline);border-radius:6px;font-size:13px;color:var(--mute);flex:1;">Search users...</div>
      ${["Role","Status","Team"].map(f=>`<div style="padding:8px 12px;background:var(--surface);border:1px solid var(--hairline);border-radius:6px;font-size:13px;color:var(--mute);">${f} ▾</div>`).join("")}</div>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead><tr style="border-bottom:2px solid var(--hairline);">${["Name","Email","Role","Status",""].map(h=>`<th style="padding:10px 12px;text-align:left;font-weight:500;color:var(--mute);">${h}</th>`).join("")}</tr></thead>
        <tbody>${[{n:"Jane Smith",e:"jane@example.com",r:"Admin",s:"Active"},{n:"Mike Chen",e:"mike@example.com",r:"Editor",s:"Active"},{n:"Lisa Wang",e:"lisa@example.com",r:"Viewer",s:"Invited"},{n:"Tom Brown",e:"tom@example.com",r:"Editor",s:"Active"},{n:"Amy Davis",e:"amy@example.com",r:"Admin",s:"Inactive"}].map(u=>`<tr style="border-bottom:1px solid var(--hairline);"><td style="padding:10px 12px;">${u.n}</td><td style="padding:10px 12px;color:var(--mute);">${u.e}</td><td style="padding:10px 12px;">${u.r}</td><td style="padding:10px 12px;"><span style="padding:2px 8px;border-radius:100px;font-size:11px;background:${u.s==="Active"?"rgba(34,197,94,0.1)":u.s==="Invited"?"rgba(245,158,66,0.1)":"rgba(239,68,68,0.1)"};color:${u.s==="Active"?"#22c55e":u.s==="Invited"?"var(--accent)":"#ef4444"};">${u.s}</span></td><td style="padding:10px 12px;text-align:right;"><span style="color:var(--mute);cursor:pointer;">•••</span></td></tr>`).join("")}</tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:16px;font-size:13px;color:var(--mute);"><span>Showing 1-5 of 24</span><div style="display:flex;gap:4px;">${["←","1","2","3","4","5","→"].map(p=>`<button style="width:28px;height:28px;border:1px solid var(--hairline);border-radius:4px;background:${p==="1"?"var(--accent)":"transparent"};color:${p==="1"?"white":"var(--mute)"};font-size:12px;">${p}</button>`).join("")}</div></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "chat-interface",
    name: "Chat interface",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Messaging interface with conversation list, message bubbles, and input area.",
    template: HTML_BASE("Chat", `<div style="display:flex;height:80vh;border:1px solid var(--hairline);border-radius:12px;overflow:hidden;">
      <div style="width:280px;border-right:1px solid var(--hairline);background:var(--surface);">
        <div style="padding:16px;border-bottom:1px solid var(--hairline);"><input style="width:100%;padding:8px 12px;background:var(--bg);border:1px solid var(--hairline);border-radius:6px;font-size:13px;" placeholder="Search..." /></div>
        ${[{n:"Sarah K.",m:"Sounds great! Let's do it.",t:"2m"},{n:"Team Chat",m:"Mike: I pushed the fix",t:"15m"},{n:"Support Bot",m:"How can I help?",t:"1h"}].map((c,i)=>`<div style="padding:12px 16px;border-bottom:1px solid var(--hairline);${i===0?"background:var(--bg);":""}"><div style="display:flex;justify-content:space-between;"><span style="font-size:14px;font-weight:${i===0?"600":"400"};">${c.n}</span><span style="font-size:11px;color:var(--mute);">${c.t}</span></div><p style="font-size:13px;color:var(--mute);margin:4px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${c.m}</p></div>`).join("")}
      </div>
      <div style="flex:1;display:flex;flex-direction:column;">
        <div style="padding:12px 16px;border-bottom:1px solid var(--hairline);font-weight:600;">Sarah K.</div>
        <div style="flex:1;padding:16px;display:flex;flex-direction:column;gap:12px;">
          <div style="align-self:flex-start;max-width:70%;padding:10px 14px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;font-size:14px;">Hey! How's the project going?</div>
          <div style="align-self:flex-end;max-width:70%;padding:10px 14px;background:var(--accent);color:white;border-radius:12px;font-size:14px;">Going well! Just finished the design system.</div>
          <div style="align-self:flex-start;max-width:70%;padding:10px 14px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;font-size:14px;">Sounds great! Let's do it.</div>
        </div>
        <div style="padding:12px 16px;border-top:1px solid var(--hairline);display:flex;gap:8px;"><input style="flex:1;padding:10px 14px;background:var(--bg);border:1px solid var(--hairline);border-radius:8px;font-size:14px;" placeholder="Type a message..." /><button style="padding:10px 16px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Send</button></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "calendar-view",
    name: "Calendar view",
    scenario: "product",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Monthly calendar view with events, drag-drop, and day detail.",
    template: HTML_BASE("Calendar", `<div style="max-width:900px;margin:0 auto;padding:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;"><h1 style="font-size:24px;font-weight:700;margin:0;">May 2026</h1><div style="display:flex;gap:8px;"><button style="padding:6px 12px;border:1px solid var(--hairline);border-radius:6px;font-size:13px;">←</button><button style="padding:6px 12px;border:1px solid var(--hairline);border-radius:6px;font-size:13px;">→</button><button style="padding:6px 12px;background:var(--accent);color:white;border:none;border-radius:6px;font-size:13px;">Today</button></div></div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--hairline);border:1px solid var(--hairline);border-radius:8px;overflow:hidden;">
        ${["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=>`<div style="padding:8px;text-align:center;font-size:12px;font-weight:600;color:var(--mute);background:var(--surface);">${d}</div>`).join("")}
        ${Array.from({length:35},(_,i)=>{const day=i-2;const inMonth=day>=1&&day<=31;const events=day===5?[{t:"Team sync",c:"var(--accent)"}]:day===12?[{t:"Design review",c:"#22c55e"}]:day===19?[{t:"Sprint planning",c:"var(--accent)"}]:day===26?[{t:"Demo day",c:"#f59e42"}]:[];return`<div style="min-height:80px;padding:6px;background:${inMonth?"var(--surface)":"var(--bg)"};"><span style="font-size:12px;color:${inMonth?"var(--fg)":"var(--mute)"};">${inMonth?day:""}</span>${events.map(e=>`<div style="margin-top:4px;padding:2px 6px;background:${e.c};color:white;border-radius:3px;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${e.t}</div>`).join("")}</div>`}).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "activity-feed",
    name: "Activity feed",
    scenario: "product",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Activity / audit log with timestamps, user avatars, and action types.",
    template: HTML_BASE("Activity", `<div style="max-width:600px;margin:0 auto;padding:32px;">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 24px;">Activity</h1>
      ${[{u:"Jane",a:"created project",t:"Homepage v3",time:"2 min ago"},{u:"Mike",a:"deployed",t:"v2.4.0 to production",time:"15 min ago"},{u:"Lisa",a:"commented on",t:"Design review #12",time:"1 hour ago"},{u:"Tom",a:"merged PR",t:"Fix auth bug",time:"2 hours ago"},{u:"Amy",a:"invited",t:"sarah@example.com",time:"Yesterday"},{u:"System",a:"backup completed",t:"All data safe",time:"Yesterday"}].map(a=>`<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid var(--hairline);">
        <div style="width:32px;height:32px;border-radius:50%;background:${a.u==="System"?"var(--surface)":"var(--accent)"};flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:12px;color:white;">${a.u[0]}</div>
        <div style="flex:1;"><p style="font-size:14px;margin:0;"><strong>${a.u}</strong> ${a.a} <span style="color:var(--accent);">${a.t}</span></p><p style="font-size:12px;color:var(--mute);margin:2px 0 0;">${a.time}</p></div>
      </div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "checkout-flow",
    name: "Checkout flow",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "multi-frame", aspect: "16/10" },
    description: "Three-step checkout: cart summary, payment, confirmation.",
    template: HTML_BASE("Checkout", `<div style="max-width:1000px;margin:0 auto;padding:32px;">
      <div style="display:flex;justify-content:center;gap:32px;margin-bottom:48px;">${["Cart","Payment","Confirmation"].map((s,i)=>`<div style="display:flex;align-items:center;gap:8px;"><div style="width:28px;height:28px;border-radius:50%;background:${i<=1?"var(--accent)":"var(--hairline)"};color:${i<=1?"white":"var(--mute)"};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;">${i+1}</div><span style="font-size:14px;color:${i<=1?"var(--fg)":"var(--mute)"};">${s}</span>${i<2?'<div style="width:40px;height:1px;background:var(--hairline);"></div>':""}</div>`).join("")}</div>
      <div style="display:grid;grid-template-columns:1fr 340px;gap:32px;">
        <div>
          <h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Payment details</h2>
          ${["Card number","Expiry","CVC","Name on card"].map(l=>`<div style="margin-bottom:12px;"><label style="display:block;font-size:12px;color:var(--mute);margin-bottom:4px;">${l}</label><div style="padding:10px 12px;background:var(--surface);border:1px solid var(--hairline);border-radius:6px;font-size:14px;color:var(--mute);">${l==="Card number"?"4242 4242 4242 4242":"—"}</div></div>`).join("")}
        </div>
        <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;height:fit-content;">
          <h3 style="font-size:16px;font-weight:600;margin:0 0 16px;">Order summary</h3>
          ${[{n:"Pro plan",p:"$29/mo"},{n:"Extra seats (×2)",p:"$10/mo"}].map(i=>`<div style="display:flex;justify-content:space-between;padding:8px 0;font-size:14px;"><span>${i.n}</span><span>${i.p}</span></div>`).join("")}
          <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid var(--hairline);margin-top:8px;font-weight:600;"><span>Total</span><span>$39/mo</span></div>
          <button style="width:100%;padding:12px;margin-top:16px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Pay now</button>
        </div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Additional deck skills ──────────────────────────────────────────
  {
    id: "product-pitch",
    name: "Product pitch deck",
    scenario: "product",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Investor pitch deck with problem, solution, market, traction, team.",
    template: HTML_BASE("Pitch", `<div style="display:flex;height:100vh;">
      ${[{t:"Problem",d:"Teams waste 40% of their time on manual workflows."},{t:"Solution",d:"An AI-powered platform that automates repetitive tasks."},{t:"Market",d:"$50B TAM in enterprise automation."},{t:"Traction",d:"10K users, $2M ARR, 30% MoM growth."},{t:"Team",d:"Ex-Stripe, ex-Linear, ex-Google engineers."},{t:"Ask",d:"Raising $10M Series A to scale globally."}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">0${i+1}</p>
        <h1 style="font-size:48px;font-weight:700;margin:0 0 24px;">${s.t}</h1>
        <p style="font-size:20px;color:var(--mute);max-width:600px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  {
    id: "case-study-deck",
    name: "Case study deck",
    scenario: "marketing",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Client case study with challenge, approach, results, testimonial.",
    template: HTML_BASE("Case Study", `<div style="display:flex;height:100vh;">
      ${[{t:"Challenge",d:"Legacy systems slowing down product delivery by 3x."},{t:"Approach",d:"Modernized stack with incremental migration over 6 months."},{t:"Results",d:"3x faster deployments, 90% fewer incidents, $500K saved."},{t:"Testimonial",d:"'This transformed how our team ships product.' — CTO"}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:42px;font-weight:700;margin:0 0 24px;">${s.t}</h1>
        <p style="font-size:20px;color:var(--mute);max-width:600px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  {
    id: "team-retro",
    name: "Team retrospective",
    scenario: "operation",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Sprint retrospective with wins, blockers, and action items.",
    template: HTML_BASE("Retro", `<div style="display:flex;height:100vh;">
      ${[{t:"What went well",items:["Shipped 3 features ahead of schedule","Zero incidents this sprint","Great cross-team collaboration"]},{t:"What could improve",items:["Too many meetings","Unclear requirements on feature X","Slow code review turnaround"]},{t:"Action items",items:["Block focus time on calendars","Require spec docs before sprint start","Set 24h review SLA"]}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">Sprint 24 · ${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:36px;font-weight:700;margin:0 0 32px;">${s.t}</h1>
        <ul style="font-size:20px;color:var(--mute);line-height:2;list-style:none;padding:0;">${s.items.map(it=>`<li>• ${it}</li>`).join("")}</ul>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  // ── Template skills ─────────────────────────────────────────────────
  {
    id: "magazine-template",
    name: "Magazine template",
    scenario: "marketing",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Magazine-style editorial template with columns, pull quotes, and images.",
    template: HTML_BASE("Magazine", `<div style="max-width:800px;margin:0 auto;padding:64px 24px;">
      <header style="margin-bottom:48px;text-align:center;"><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:var(--accent);margin:0 0 16px;">Issue 47 · Spring 2026</p><h1 style="font-size:56px;font-weight:700;line-height:1.1;margin:0 0 16px;">The Future of Design</h1><p style="font-size:18px;color:var(--mute);max-width:500px;margin:0 auto;">How AI is reshaping the creative landscape.</p></header>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;font-size:17px;line-height:1.8;">
        <div><p style="margin:0 0 24px;">The design world is at an inflection point. Tools that once required years of training are now accessible to anyone with an idea and a prompt.</p><blockquote style="margin:32px 0;padding:24px 0;border-top:1px solid var(--hairline);border-bottom:1px solid var(--hairline);font-size:24px;font-style:italic;line-height:1.4;text-align:center;">"Design is not what it looks like. Design is how it works."</blockquote><p style="margin:0;">But this democratization raises fundamental questions about craft, authorship, and what it means to be a designer in 2026.</p></div>
        <div><div style="aspect-ratio:3/4;background:var(--surface);border:1px solid var(--hairline);border-radius:4px;margin-bottom:24px;"></div><p style="color:var(--mute);font-size:13px;">Illustration by Studio Default</p></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "resume-template",
    name: "Resume template",
    scenario: "personal",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Professional resume / CV template with clean typography.",
    template: HTML_BASE("Resume", `<div style="max-width:700px;margin:0 auto;padding:48px 24px;">
      <header style="margin-bottom:32px;border-bottom:2px solid var(--fg);padding-bottom:24px;"><h1 style="font-size:36px;font-weight:700;margin:0;">Jane Designer</h1><p style="font-size:16px;color:var(--accent);margin:4px 0 0;">Senior Product Designer</p><p style="font-size:14px;color:var(--mute);margin:8px 0 0;">jane@example.com · San Francisco, CA · Portfolio: jane.design</p></header>
      <div style="display:grid;grid-template-columns:1fr 200px;gap:32px;">
        <div>
          <h2 style="font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin:0 0 12px;">Experience</h2>
          ${[{r:"Senior Product Designer",c:"Linear",d:"2023 – Present",b:["Led design system rebuild, improving consistency by 40%","Shipped 12 major features across web and mobile"]},{r:"Product Designer",c:"Stripe",d:"2020 – 2023",b:["Redesigned dashboard, increasing engagement by 25%","Built component library used by 8 product teams"]}].map(j=>`<div style="margin-bottom:20px;"><div style="display:flex;justify-content:space-between;"><strong style="font-size:14px;">${j.r}</strong><span style="font-size:13px;color:var(--mute);">${j.d}</span></div><p style="font-size:14px;color:var(--accent);margin:2px 0 8px;">${j.c}</p><ul style="margin:0;padding-left:16px;font-size:13px;color:var(--mute);line-height:1.7;">${j.b.map(b=>`<li>${b}</li>`).join("")}</ul></div>`).join("")}
        </div>
        <div>
          <h2 style="font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin:0 0 12px;">Skills</h2>
          ${["Figma","React","TypeScript","Design Systems","User Research","Prototyping"].map(s=>`<p style="font-size:13px;margin:0 0 6px;">${s}</p>`).join("")}
          <h2 style="font-size:16px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin:20px 0 12px;">Education</h2>
          <p style="font-size:13px;margin:0;">BFA Design<br/>RISD, 2020</p>
        </div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "newsletter-template",
    name: "Newsletter template",
    scenario: "marketing",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Weekly newsletter with header, featured article, link list, and footer.",
    template: HTML_BASE("Newsletter", `<div style="max-width:600px;margin:0 auto;background:white;color:#1a1a1a;padding:32px;">
      <div style="text-align:center;margin-bottom:32px;padding-bottom:24px;border-bottom:1px solid #e5e5e5;"><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin:0 0 8px;">Weekly Digest · Issue 47</p><h1 style="font-size:28px;font-weight:700;margin:0;">The Design Brief</h1></div>
      <div style="margin-bottom:32px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 8px;">Featured: The Death of Flat Design</h2><p style="color:#666;line-height:1.6;margin:0 0 12px;">After a decade of minimalism, designers are rediscovering texture, depth, and personality in their interfaces.</p><a href="#" style="color:var(--accent);font-size:14px;">Read more →</a></div>
      <div style="margin-bottom:32px;"><h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">This week's links</h3>
      ${["Why your design system needs a content strategy","The state of CSS in 2026","10 tools every designer should know"].map(l=>`<a href="#" style="display:block;padding:8px 0;border-bottom:1px solid #f0f0f0;color:#1a1a1a;text-decoration:none;font-size:14px;">${l} →</a>`).join("")}</div>
      <div style="text-align:center;padding-top:24px;border-top:1px solid #e5e5e5;font-size:12px;color:#999;">You received this because you subscribed to The Design Brief.<br/><a href="#" style="color:#999;">Unsubscribe</a></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "invoice-template",
    name: "Invoice template",
    scenario: "finance",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Professional invoice with line items, totals, and payment details.",
    template: HTML_BASE("Invoice", `<div style="max-width:700px;margin:0 auto;padding:48px 24px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:48px;"><div><h1 style="font-size:32px;font-weight:700;margin:0;">Invoice</h1><p style="color:var(--mute);margin:4px 0 0;">#INV-2026-047</p></div><div style="text-align:right;"><p style="font-size:14px;margin:0;">Your Company</p><p style="font-size:13px;color:var(--mute);margin:2px 0 0;">123 Main St, San Francisco</p></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-bottom:32px;font-size:14px;"><div><p style="font-weight:600;margin:0 0 4px;">Bill To</p><p style="color:var(--mute);margin:0;">Client Corp<br/>456 Market St<br/>New York, NY</p></div><div><p style="font-weight:600;margin:0 0 4px;">Details</p><p style="color:var(--mute);margin:0;">Date: May 27, 2026<br/>Due: June 27, 2026</p></div></div>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;"><thead><tr style="border-bottom:2px solid var(--fg);"><th style="padding:8px 0;text-align:left;">Description</th><th style="padding:8px 0;text-align:right;">Qty</th><th style="padding:8px 0;text-align:right;">Rate</th><th style="padding:8px 0;text-align:right;">Amount</th></tr></thead>
      <tbody>${[{d:"Design system consultation",q:8,r:200},{d:"Component library build",q:16,r:200},{d:"Design review sessions",q:4,r:150}].map(l=>`<tr style="border-bottom:1px solid var(--hairline);"><td style="padding:10px 0;">${l.d}</td><td style="padding:10px 0;text-align:right;">${l.q}h</td><td style="padding:10px 0;text-align:right;">$${l.r}</td><td style="padding:10px 0;text-align:right;">$${l.q*l.r}</td></tr>`).join("")}</tbody></table>
      <div style="text-align:right;"><p style="font-size:14px;margin:0 0 4px;">Subtotal: $5,800</p><p style="font-size:14px;margin:0 0 4px;">Tax (0%): $0</p><p style="font-size:20px;font-weight:700;margin:8px 0 0;">Total: $5,800</p></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "design-spec",
    name: "Design specification",
    scenario: "product",
    mode: "template",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Design specification document with component specs, tokens, and guidelines.",
    template: HTML_BASE("Spec", `<div style="max-width:900px;margin:0 auto;padding:48px 24px;">
      <header style="margin-bottom:48px;"><p style="font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.12em;margin:0;">Design Spec v2.4</p><h1 style="font-size:32px;font-weight:700;margin:8px 0 0;">Button Component</h1><p style="color:var(--mute);margin:8px 0 0;">Last updated May 27, 2026</p></header>
      <section style="margin-bottom:48px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Variants</h2>
      <div style="display:flex;gap:16px;flex-wrap:wrap;padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;">
        ${["Primary","Secondary","Ghost","Danger"].map(v=>`<div style="text-align:center;"><button style="padding:10px 20px;background:${v==="Primary"?"var(--accent)":v==="Danger"?"#ef4444":"transparent"};color:${v==="Primary"||v==="Danger"?"white":"var(--fg)"};border:1px solid ${v==="Secondary"?"var(--hairline)":"transparent"};border-radius:6px;font-size:14px;font-weight:500;">${v}</button><p style="font-size:11px;color:var(--mute);margin:6px 0 0;">${v.toLowerCase()}</p></div>`).join("")}
      </div></section>
      <section style="margin-bottom:48px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Sizes</h2>
      <div style="display:flex;gap:16px;align-items:end;padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;">
        ${[{s:"Small",h:32},{s:"Medium",h:40},{s:"Large",h:48}].map(v=>`<div style="text-align:center;"><button style="height:${v.h}px;padding:0 16px;background:var(--accent);color:white;border:none;border-radius:6px;font-size:13px;">${v.s}</button><p style="font-size:11px;color:var(--mute);margin:6px 0 0;">${v.h}px</p></div>`).join("")}
      </div></section>
      <section><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Tokens</h2>
      <table style="width:100%;border-collapse:collapse;font-size:13px;"><thead><tr style="border-bottom:1px solid var(--hairline);"><th style="padding:8px;text-align:left;">Token</th><th style="padding:8px;text-align:left;">Value</th><th style="padding:8px;text-align:left;">Usage</th></tr></thead>
      <tbody>${[["--btn-bg","var(--accent)","Background color"],["--btn-fg","white","Text color"],["--btn-radius","6px","Border radius"],["--btn-font","14px / 500","Typography"],["--btn-padding","10px 20px","Horizontal padding"]].map(r=>`<tr style="border-bottom:1px solid var(--hairline);"><td style="padding:8px;font-family:monospace;">${r[0]}</td><td style="padding:8px;">${r[1]}</td><td style="padding:8px;color:var(--mute);">${r[2]}</td></tr>`).join("")}</tbody></table></section>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Image generation skills ─────────────────────────────────────────
  {
    id: "poster-image",
    name: "Poster image",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "2/3" },
    description: "Generate a poster or flyer via image generation.",
    template: HTML_BASE("Poster", `<div style="max-width:600px;margin:0 auto;padding:48px 24px;text-align:center;">
      <h1 style="font-size:48px;font-weight:800;margin:0 0 12px;">POSTER</h1>
      <p style="font-size:18px;color:var(--mute);margin:0 0 32px;">Event / Product / Campaign</p>
      <div style="width:100%;aspect-ratio:2/3;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Image generation area</p></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "infographic",
    name: "Infographic",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "9/16" },
    description: "Generate an infographic with data visualization via image generation.",
    template: HTML_BASE("Infographic", `<div style="max-width:500px;margin:0 auto;padding:32px;">
      <h1 style="font-size:32px;font-weight:700;text-align:center;margin:0 0 24px;">Infographic Title</h1>
      <div style="width:100%;aspect-ratio:9/16;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Infographic generation area</p></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "social-card",
    name: "Social media card",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Generate a social media card (Twitter, LinkedIn, etc.) via image generation.",
    template: HTML_BASE("Social Card", `<div style="max-width:500px;margin:0 auto;padding:32px;text-align:center;">
      <h2 style="font-size:24px;font-weight:600;margin:0 0 16px;">Social Card</h2>
      <div style="width:100%;aspect-ratio:1/1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Social card generation area</p></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "avatar-generator",
    name: "Avatar generator",
    scenario: "personal",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Generate profile avatars or character portraits via image generation.",
    template: HTML_BASE("Avatar", `<div style="max-width:400px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:200px;height:200px;border-radius:50%;background:var(--surface);border:2px solid var(--hairline);margin:0 auto 24px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);font-size:13px;">Avatar area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:0 0 8px;">Avatar Generator</h2>
      <p style="color:var(--mute);font-size:14px;">Generate custom avatars and portraits.</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "product-shot",
    name: "Product shot",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Generate product photography or mockups via image generation.",
    template: HTML_BASE("Product", `<div style="max-width:600px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;aspect-ratio:1/1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Product shot generation area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:16px 0 0;">Product Photography</h2>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "logo-concept",
    name: "Logo concept",
    scenario: "design",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Generate logo concepts and brand marks via image generation.",
    template: HTML_BASE("Logo", `<div style="max-width:500px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:200px;height:200px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;margin:0 auto 24px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);font-size:13px;">Logo area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:0 0 8px;">Logo Concept</h2>
      <p style="color:var(--mute);font-size:14px;">Brand mark and logo exploration.</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Video generation skills ─────────────────────────────────────────
  {
    id: "motion-graphic",
    name: "Motion graphic",
    scenario: "marketing",
    mode: "video",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate a motion graphic or animated explainer via video generation.",
    template: HTML_BASE("Motion", `<div style="max-width:800px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;aspect-ratio:16/9;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Motion graphic generation area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:16px 0 0;">Motion Graphic</h2>
      <p style="color:var(--mute);font-size:14px;">30-second animated explainer.</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "product-demo-video",
    name: "Product demo video",
    scenario: "marketing",
    mode: "video",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate a product demo video via video generation.",
    template: HTML_BASE("Demo", `<div style="max-width:800px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;aspect-ratio:16/9;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Product demo generation area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:16px 0 0;">Product Demo</h2>
      <p style="color:var(--mute);font-size:14px;">60-second product walkthrough.</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Audio generation skills ─────────────────────────────────────────
  {
    id: "voiceover",
    name: "Voiceover",
    scenario: "marketing",
    mode: "audio",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate voiceover narration for videos, presentations, or podcasts.",
    template: HTML_BASE("Voiceover", `<div style="max-width:600px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;padding:48px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
        <h2 style="font-size:24px;font-weight:600;margin:0 0 8px;">Voiceover Script</h2>
        <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">Professional narration for your content.</p>
        <div style="height:4px;background:var(--hairline);border-radius:2px;overflow:hidden;max-width:300px;margin:0 auto;"><div style="height:100%;width:0%;background:var(--accent);border-radius:2px;"></div></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "podcast-intro",
    name: "Podcast intro",
    scenario: "marketing",
    mode: "audio",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate a podcast intro/outro with music and voice.",
    template: HTML_BASE("Podcast", `<div style="max-width:600px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;padding:48px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
        <h2 style="font-size:24px;font-weight:600;margin:0 0 8px;">Podcast Intro</h2>
        <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">15-second intro with music bed and voice.</p>
        <div style="display:flex;justify-content:center;gap:8px;">${[1,2,3,4,5,6,7,8].map((_i,idx)=>`<div style="width:4px;height:${12+idx*4}px;background:var(--accent);border-radius:2px;"></div>`).join("")}</div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "sound-effect",
    name: "Sound effect",
    scenario: "product",
    mode: "audio",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate UI sound effects — clicks, notifications, transitions.",
    template: HTML_BASE("Sound", `<div style="max-width:600px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;padding:48px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
        <h2 style="font-size:24px;font-weight:600;margin:0 0 8px;">UI Sound Effect</h2>
        <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">Click, notification, or transition sound.</p>
        <div style="display:flex;justify-content:center;gap:16px;">
          ${["Click","Notify","Whoosh"].map(s=>`<button style="padding:8px 16px;background:var(--bg);border:1px solid var(--hairline);border-radius:8px;font-size:13px;">🔊 ${s}</button>`).join("")}
        </div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Design system skills ────────────────────────────────────────────
  {
    id: "design-md",
    name: "DESIGN.md generator",
    scenario: "design",
    mode: "design-system",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Generate a 9-section DESIGN.md from brand brief, screenshot, or URL.",
    template: HTML_BASE("Design System", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">DESIGN.md Generator</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Input a brand brief, URL, or screenshot to generate a complete design system document.</p>
      <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;margin-bottom:24px;">
        <h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">Input</h3>
        <div style="padding:12px;background:var(--bg);border:1px solid var(--hairline);border-radius:8px;color:var(--mute);font-size:14px;">Paste brand brief, URL, or describe the brand...</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">${["Voice","Palette","Typography","Spacing","Components","Motion","Brand","Anti-patterns","Responsive"].map(s=>`<div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;text-align:center;font-size:13px;font-weight:500;">${s}</div>`).join("")}</div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "color-palette-generator",
    name: "Color palette generator",
    scenario: "design",
    mode: "design-system",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Generate harmonious color palettes from a base color or brand.",
    template: HTML_BASE("Palette", `<div style="max-width:700px;margin:0 auto;padding:48px;text-align:center;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">Color Palette</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Generate harmonious palettes from a base color.</p>
      <div style="display:flex;gap:4px;height:80px;border-radius:12px;overflow:hidden;margin-bottom:24px;">${["#1a1a2e","#16213e","#0f3460","#e94560","#533483"].map(c=>`<div style="flex:1;background:${c};"></div>`).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;">${["Primary","Secondary","Accent","Muted","Background"].map((l,i)=>`<div style="text-align:center;"><div style="height:48px;border-radius:8px;background:${["#e94560","#533483","#0f3460","#16213e","#1a1a2e"][i]};margin-bottom:6px;"></div><p style="font-size:12px;color:var(--mute);margin:0;">${l}</p></div>`).join("")}</div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Utility skills ──────────────────────────────────────────────────
  {
    id: "copywriting",
    name: "Copywriting",
    scenario: "marketing",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Generate marketing copy — headlines, taglines, product descriptions.",
    template: HTML_BASE("Copy", `<div style="max-width:700px;margin:0 auto;padding:48px;">
      <h1 style="font-size:32px;font-weight:700;margin:0 0 8px;">Copywriting</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Generate headlines, taglines, and product descriptions.</p>
      <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;margin-bottom:24px;">
        <h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">Headlines</h3>
        ${["Ship faster. Build better.","The platform for teams that move.","Design. Build. Ship. Repeat."].map(h=>`<p style="font-size:20px;margin:0 0 12px;padding:12px;background:var(--bg);border:1px solid var(--hairline);border-radius:6px;">${h}</p>`).join("")}
      </div>
      <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
        <h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">Taglines</h3>
        ${["Where ideas become products.","Design without limits.","From concept to launch in hours."].map(t=>`<p style="font-size:16px;color:var(--mute);margin:0 0 8px;padding:8px 12px;background:var(--bg);border:1px solid var(--hairline);border-radius:6px;">${t}</p>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "brainstorming",
    name: "Brainstorming",
    scenario: "product",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Structured brainstorming with idea clusters, voting, and next steps.",
    template: HTML_BASE("Brainstorm", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:32px;font-weight:700;margin:0 0 8px;">Brainstorm: New Feature Ideas</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Generated ideas organized by theme. Vote on favorites.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${[{theme:"AI Features",ideas:["Smart search","Auto-tagging","Predictive analytics"]},{theme:"Collaboration",ideas:["Real-time cursors","Comment threads","Shared workspaces"]},{theme:"Mobile",ideas:["Offline mode","Push notifications","Widget support"]}].map(c=>`<div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:16px;font-weight:600;margin:0 0 12px;color:var(--accent);">${c.theme}</h3>${c.ideas.map(i=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--hairline);"><span style="font-size:14px;">${i}</span><span style="font-size:12px;color:var(--mute);">⚑ Vote</span></div>`).join("")}</div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "user-persona",
    name: "User persona",
    scenario: "product",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "User persona document with demographics, goals, pain points, and behaviors.",
    template: HTML_BASE("Persona", `<div style="max-width:700px;margin:0 auto;padding:48px;">
      <div style="display:flex;gap:24px;align-items:start;margin-bottom:32px;"><div style="width:80px;height:80px;border-radius:50%;background:var(--surface);border:1px solid var(--hairline);flex-shrink:0;"></div><div><h1 style="font-size:28px;font-weight:700;margin:0;">Sarah Kim</h1><p style="color:var(--accent);margin:4px 0 0;">Product Manager, Age 32</p><p style="color:var(--mute);font-size:14px;margin:4px 0 0;">San Francisco · SaaS startup · 50 employees</p></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin:0 0 12px;">Goals</h3>${["Ship features faster","Reduce meeting time","Improve team alignment"].map(g=>`<p style="font-size:14px;margin:0 0 8px;">• ${g}</p>`).join("")}</div>
        <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:14px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent);margin:0 0 12px;">Pain Points</h3>${["Too many tools","Context switching","Unclear priorities"].map(p=>`<p style="font-size:14px;margin:0 0 8px;">• ${p}</p>`).join("")}</div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "competitive-analysis",
    name: "Competitive analysis",
    scenario: "product",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Competitive landscape analysis with feature matrix and positioning.",
    template: HTML_BASE("Competitors", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:32px;font-weight:700;margin:0 0 8px;">Competitive Analysis</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Landscape overview and feature comparison.</p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px;">
        ${[{n:"Us",s:"Leader",d:"Full-featured platform"},{n:"Comp A",s:"Challenger",d:"Good UX, limited features"},{n:"Comp B",s:"Niche",d:"Enterprise-only"},{n:"Comp C",s:"Emerging",d:"New entrant, growing fast"}].map(c=>`<div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;text-align:center;"><h3 style="font-size:18px;font-weight:600;margin:0 0 4px;">${c.n}</h3><span style="font-size:12px;padding:2px 8px;background:var(--accent);color:white;border-radius:100px;">${c.s}</span><p style="font-size:13px;color:var(--mute);margin:8px 0 0;">${c.d}</p></div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "swot-analysis",
    name: "SWOT analysis",
    scenario: "product",
    mode: "document",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "SWOT matrix with strengths, weaknesses, opportunities, threats.",
    template: HTML_BASE("SWOT", `<div style="max-width:700px;margin:0 auto;padding:48px;">
      <h1 style="font-size:32px;font-weight:700;text-align:center;margin:0 0 32px;">SWOT Analysis</h1>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${[{q:"Strengths",items:["Strong brand recognition","Growing user base","Technical expertise"],c:"#22c55e"},{q:"Weaknesses",items:["Limited marketing budget","Small team","No mobile app"],c:"#ef4444"},{q:"Opportunities",items:["AI integration","Enterprise market","International expansion"],c:"var(--accent)"},{q:"Threats",items:["New competitors","Market saturation","Economic downturn"],c:"#f59e42"}].map(s=>`<div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;border-top:3px solid ${s.c};"><h3 style="font-size:16px;font-weight:600;margin:0 0 12px;">${s.q}</h3>${s.items.map(i=>`<p style="font-size:14px;margin:0 0 8px;">• ${i}</p>`).join("")}</div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "user-research",
    name: "User research report",
    scenario: "product",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "User research findings with insights, quotes, and recommendations.",
    template: HTML_BASE("Research", `<div style="max-width:700px;margin:0 auto;padding:48px;">
      <header style="margin-bottom:32px;"><p style="font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.12em;margin:0;">User Research Report</p><h1 style="font-size:28px;font-weight:700;margin:8px 0 0;">Onboarding Flow Study</h1><p style="color:var(--mute);margin:8px 0 0;">12 participants · May 2026</p></header>
      <section style="margin-bottom:32px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 12px;">Key Findings</h2>
      ${[{f:"Users struggle with step 3 of onboarding",e:"8/12 participants abandoned the flow at the pricing selection step."},{f:"Mobile experience needs improvement",e:"Touch targets are too small on the confirmation button."},{f:"Users want more personalization",e:"7/12 asked for customizable dashboard layouts."}].map(f=>`<div style="padding:16px;margin-bottom:12px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;"><p style="font-size:15px;font-weight:600;margin:0 0 8px;">${f.f}</p><p style="font-size:14px;color:var(--mute);margin:0;">${f.e}</p></div>`).join("")}</section>
      <section><h2 style="font-size:20px;font-weight:600;margin:0 0 12px;">Recommendations</h2><ul style="margin:0;padding-left:20px;">${["Simplify pricing selection to 2 options","Increase button size to 48px minimum","Add dashboard customization wizard"].map(r=>`<li style="font-size:14px;margin-bottom:8px;color:var(--mute);">${r}</li>`).join("")}</ul></section>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "meeting-agenda",
    name: "Meeting agenda",
    scenario: "operation",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Structured meeting agenda with topics, owners, and time allocation.",
    template: HTML_BASE("Agenda", `<div style="max-width:600px;margin:0 auto;padding:48px;">
      <header style="margin-bottom:32px;"><h1 style="font-size:28px;font-weight:700;margin:0;">Team Standup</h1><p style="color:var(--mute);margin:8px 0 0;">May 27, 2026 · 10:00 AM · 30 min</p></header>
      ${[{t:"Updates from last week",o:"Jane",time:"10 min"},{t:"Blockers and dependencies",o:"Mike",time:"5 min"},{t:"Sprint priorities",o:"Lisa",time:"10 min"},{t:"Action items recap",o:"Tom",time:"5 min"}].map(a=>`<div style="display:flex;gap:16px;padding:16px 0;border-bottom:1px solid var(--hairline);"><div style="width:60px;flex-shrink:0;"><span style="font-size:14px;font-weight:600;color:var(--accent);">${a.time}</span></div><div style="flex:1;"><p style="font-size:15px;font-weight:500;margin:0;">${a.t}</p><p style="font-size:13px;color:var(--mute);margin:2px 0 0;">Owner: ${a.o}</p></div></div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "press-release",
    name: "Press release",
    scenario: "marketing",
    mode: "document",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Product launch press release with headline, boilerplate, and contact.",
    template: HTML_BASE("Press", `<div style="max-width:600px;margin:0 auto;padding:48px;">
      <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">For Immediate Release</p>
      <h1 style="font-size:28px;font-weight:700;line-height:1.2;margin:0 0 16px;">Company Launches Revolutionary Design Platform</h1>
      <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">San Francisco, CA — May 27, 2026</p>
      <div style="font-size:16px;line-height:1.7;">
        <p style="margin:0 0 16px;">Company today announced the launch of its AI-powered design platform, enabling teams to ship production-quality designs in minutes instead of days.</p>
        <p style="margin:0 0 16px;">"We're democratizing design," said CEO Jane Smith. "Every team deserves access to great design tools."</p>
        <p style="margin:0 0 16px;">The platform is available today at example.com with a free tier for individuals and teams.</p>
      </div>
      <div style="margin-top:32px;padding-top:24px;border-top:1px solid var(--hairline);"><p style="font-size:14px;font-weight:600;margin:0;">Media Contact</p><p style="font-size:14px;color:var(--mute);margin:4px 0 0;">pr@example.com</p></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "style-guide",
    name: "Style guide",
    scenario: "design",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Visual style guide with typography, colors, spacing, and component rules.",
    template: HTML_BASE("Style Guide", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:32px;font-weight:700;margin:0 0 32px;">Style Guide</h1>
      <section style="margin-bottom:48px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Typography</h2>
      <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;">
        <p style="font-size:48px;font-weight:700;margin:0 0 8px;">Display heading</p>
        <p style="font-size:24px;font-weight:600;margin:0 0 8px;">Section heading</p>
        <p style="font-size:16px;margin:0 0 8px;">Body text — the quick brown fox jumps over the lazy dog.</p>
        <p style="font-size:13px;color:var(--mute);margin:0;">Caption text for metadata and labels.</p>
      </div></section>
      <section style="margin-bottom:48px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Colors</h2>
      <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;">${[{n:"Background",v:"var(--bg)"},{n:"Surface",v:"var(--surface)"},{n:"Accent",v:"var(--accent)"},{n:"Muted",v:"var(--mute)"},{n:"Foreground",v:"var(--fg)"}].map(c=>`<div style="text-align:center;"><div style="height:48px;border-radius:8px;background:${c.v};border:1px solid var(--hairline);margin-bottom:6px;"></div><p style="font-size:12px;color:var(--mute);margin:0;">${c.n}</p></div>`).join("")}</div></section>
      <section><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Spacing</h2>
      <div style="display:flex;gap:8px;align-items:end;">${[4,8,12,16,24,32,48].map(s=>`<div style="text-align:center;"><div style="width:${s}px;height:${s}px;background:var(--accent);border-radius:2px;margin:0 auto 4px;"></div><p style="font-size:11px;color:var(--mute);margin:0;">${s}</p></div>`).join("")}</div></section>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "api-docs",
    name: "API documentation",
    scenario: "engineering",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "API endpoint documentation with method, path, params, and response.",
    template: HTML_BASE("API", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:32px;font-weight:700;margin:0 0 8px;">API Reference</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Complete API documentation with examples.</p>
      ${[{m:"GET",p:"/api/users",d:"List all users",params:[{n:"page",t:"integer",d:"Page number (default: 1)"},{n:"limit",t:"integer",d:"Items per page (default: 20)"}]},{m:"POST",p:"/api/users",d:"Create a new user",params:[{n:"name",t:"string",d:"User's full name (required)"},{n:"email",t:"string",d:"User's email (required)"}]},{m:"DELETE",p:"/api/users/:id",d:"Delete a user",params:[]}].map(e=>`<div style="margin-bottom:24px;padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;"><span style="padding:4px 10px;background:${e.m==="GET"?"#22c55e":e.m==="POST"?"var(--accent)":"#ef4444"};color:white;border-radius:4px;font-size:12px;font-weight:600;">${e.m}</span><code style="font-size:14px;">${e.p}</code></div>
        <p style="font-size:14px;color:var(--mute);margin:0 0 12px;">${e.d}</p>
        ${e.params.length>0?`<table style="width:100%;font-size:13px;border-collapse:collapse;"><thead><tr style="border-bottom:1px solid var(--hairline);"><th style="padding:6px;text-align:left;">Param</th><th style="padding:6px;text-align:left;">Type</th><th style="padding:6px;text-align:left;">Description</th></tr></thead><tbody>${e.params.map(p=>`<tr><td style="padding:6px;font-family:monospace;">${p.n}</td><td style="padding:6px;color:var(--mute);">${p.t}</td><td style="padding:6px;color:var(--mute);">${p.d}</td></tr>`).join("")}</tbody></table>`:"<p style='font-size:13px;color:var(--mute);'>No parameters.</p>"}
      </div>`).join("")}
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── Figma integration skills ────────────────────────────────────────
  {
    id: "figma-component",
    name: "Figma component",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Generate Figma-ready component specs with variants and auto-layout rules.",
    template: HTML_BASE("Figma Component", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">Component Spec</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Button component — ready for Figma implementation.</p>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:32px;">
        ${[{v:"Primary",bg:"var(--accent)",fg:"white"},{v:"Secondary",bg:"transparent",fg:"var(--fg)"},{v:"Ghost",bg:"transparent",fg:"var(--accent)"},{v:"Danger",bg:"#ef4444",fg:"white"}].map(b=>`<div style="text-align:center;padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;"><button style="padding:10px 20px;background:${b.bg};color:${b.fg};border:1px solid ${b.bg==="transparent"?"var(--hairline)":"transparent"};border-radius:6px;font-size:13px;font-weight:500;">${b.v}</button><p style="font-size:11px;color:var(--mute);margin:8px 0 0;">${b.v.toLowerCase()}</p></div>`).join("")}
      </div>
      <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;font-size:13px;">
        <p style="font-weight:600;margin:0 0 8px;">Auto-layout rules</p>
        <p style="color:var(--mute);margin:0;">Padding: 10px 20px · Gap: 8px · Border-radius: 6px · Min-width: 80px</p>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "figma-page-layout",
    name: "Figma page layout",
    scenario: "design",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Generate a Figma page layout with frame structure, spacing annotations, and responsive breakpoints.",
    template: HTML_BASE("Figma Layout", `<div style="max-width:900px;margin:0 auto;padding:48px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">Page Layout Spec</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Frame structure and responsive breakpoints for Figma.</p>
      <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;margin-bottom:24px;">
        <div style="display:flex;justify-content:space-between;margin-bottom:16px;">${["Mobile\n375px","Tablet\n768px","Desktop\n1280px","Wide\n1440px"].map(b=>`<div style="text-align:center;padding:12px 16px;border:1px dashed var(--hairline);border-radius:6px;font-size:12px;white-space:pre-line;color:var(--mute);">${b}</div>`).join("")}</div>
        <div style="height:200px;border:2px dashed var(--accent);border-radius:8px;display:flex;align-items:center;justify-content:center;"><span style="font-size:14px;color:var(--accent);">Frame: 1280 × 800</span></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "figma-design-tokens",
    name: "Figma design tokens",
    scenario: "design",
    mode: "design-system",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Generate design tokens in Figma-compatible format — colors, typography, spacing, effects.",
    template: HTML_BASE("Tokens", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">Design Tokens</h1>
      <p style="color:var(--mute);margin:0 0 32px;">Figma-compatible token export.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${[{cat:"Colors",tokens:["primary/500: #6366f1","neutral/900: #1a1a2e","success/500: #22c55e"]},{cat:"Typography",tokens:["heading/xl: 48px/700","body/base: 16px/400","caption/sm: 12px/500"]},{cat:"Spacing",tokens:["space/1: 4px","space/2: 8px","space/4: 16px","space/8: 32px"]}].map(g=>`<div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;"><h3 style="font-size:14px;font-weight:600;margin:0 0 12px;color:var(--accent);">${g.cat}</h3>${g.tokens.map(t=>`<p style="font-size:12px;font-family:monospace;margin:0 0 6px;color:var(--mute);">${t}</p>`).join("")}</div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── FAL media generation skills ─────────────────────────────────────
  {
    id: "fal-image-generate",
    name: "FAL image generate",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Generate images via FAL AI — posters, illustrations, product shots, concept art.",
    template: HTML_BASE("FAL Image", `<div style="max-width:600px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;aspect-ratio:1/1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">FAL image generation area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:16px 0 0;">AI Image Generation</h2>
      <p style="color:var(--mute);font-size:14px;">Powered by FAL AI · Multiple models available</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "fal-image-edit",
    name: "FAL image edit",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Edit existing images via FAL AI — inpainting, outpainting, style transfer, upscaling.",
    template: HTML_BASE("FAL Edit", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">Image Editor</h1>
      <p style="color:var(--mute);margin:0 0 24px;">Edit images with AI — inpaint, outpaint, upscale, style transfer.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="aspect-ratio:1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Original</p></div>
        <div style="aspect-ratio:1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">Edited</p></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "fal-video-generate",
    name: "FAL video generate",
    scenario: "marketing",
    mode: "video",
    preview: { kind: "single-page", aspect: "16/9" },
    description: "Generate videos via FAL AI — text-to-video, image-to-video, motion graphics.",
    template: HTML_BASE("FAL Video", `<div style="max-width:800px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;aspect-ratio:16/9;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><p style="color:var(--mute);">FAL video generation area</p></div>
      <h2 style="font-size:20px;font-weight:600;margin:16px 0 0;">AI Video Generation</h2>
      <p style="color:var(--mute);font-size:14px;">Text-to-video · Image-to-video · 15s max</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "fal-upscale",
    name: "FAL upscale",
    scenario: "design",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Upscale images via FAL AI — 2x, 4x resolution enhancement with detail preservation.",
    template: HTML_BASE("FAL Upscale", `<div style="max-width:700px;margin:0 auto;padding:48px;text-align:center;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 8px;">Image Upscaler</h1>
      <p style="color:var(--mute);margin:0 0 24px;">Enhance resolution with AI — 2x or 4x upscaling.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        <div style="aspect-ratio:1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><div><p style="color:var(--mute);font-size:13px;">Original</p><p style="font-size:11px;color:var(--mute);">512 × 512</p></div></div>
        <div style="aspect-ratio:1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;align-items:center;justify-content:center;"><div><p style="color:var(--accent);font-size:13px;">Upscaled</p><p style="font-size:11px;color:var(--mute);">2048 × 2048</p></div></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── More deck variants ──────────────────────────────────────────────
  {
    id: "deck-swiss",
    name: "Swiss deck",
    scenario: "design",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Swiss International Style deck — strict grid, Helvetica, red/black/white.",
    template: HTML_BASE("Swiss Deck", `<div style="display:flex;height:100vh;">
      ${[{t:"Title",d:"Swiss International Style"},{t:"Grid",d:"12-column modular grid. Every element aligns."},{t:"Typography",d:"Helvetica. One weight. One size per hierarchy level."},{t:"Color",d:"Red #e30613. Black #000000. White #ffffff. Nothing else."},{t:"Content",d:"The grid is the design. Content fills the grid."},{t:"End",d:"Less is more."}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.2em;color:#e30613;margin:0 0 16px;">${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:clamp(32px,6vw,64px);font-weight:700;margin:0 0 16px;">${s.t}</h1>
        <p style="font-size:20px;color:#666;max-width:500px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  {
    id: "deck-minimal",
    name: "Minimal deck",
    scenario: "design",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Ultra-minimal horizontal deck — one idea per slide, maximum whitespace.",
    template: HTML_BASE("Minimal Deck", `<div style="display:flex;height:100vh;">
      ${[{t:"Idea one",d:"The simplest version of the message."},{t:"Idea two",d:"Supporting evidence, visualized."},{t:"Idea three",d:"The call to action."}].map((s)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;align-items:center;padding:80px;text-align:center;">
        <h1 style="font-size:clamp(36px,8vw,72px);font-weight:700;margin:0 0 24px;">${s.t}</h1>
        <p style="font-size:20px;color:var(--mute);max-width:500px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  {
    id: "deck-editorial",
    name: "Editorial deck",
    scenario: "marketing",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Magazine-style editorial deck with serif typography and image-heavy slides.",
    template: HTML_BASE("Editorial Deck", `<div style="display:flex;height:100vh;">
      ${[{t:"The Story",d:"Every great presentation tells a story.",img:true},{t:"Chapter One",d:"The problem is clearer than the solution."},{t:"Chapter Two",d:"Data tells us what intuition misses."},{t:"The Ending",d:"What happens next is up to us."}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;${s.img?"background:var(--surface);":""}">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:clamp(32px,6vw,56px);font-weight:400;font-style:italic;margin:0 0 24px;">${s.t}</h1>
        <p style="font-size:20px;color:var(--mute);max-width:500px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  // ── More template variants ──────────────────────────────────────────
  {
    id: "digital-eguide",
    name: "Digital e-guide",
    scenario: "marketing",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Two-spread digital e-guide — cover + lesson spread with pull-quote and step list.",
    template: HTML_BASE("E-Guide", `<div style="max-width:700px;margin:0 auto;padding:48px;">
      <div style="text-align:center;padding:64px 32px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;margin-bottom:32px;">
        <p style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:var(--accent);margin:0 0 16px;">Free Guide</p>
        <h1 style="font-size:36px;font-weight:700;margin:0 0 12px;">The Complete Guide to<br/>Design Systems</h1>
        <p style="color:var(--mute);margin:0;">By Jane Designer · 2026</p>
      </div>
      <div style="margin-bottom:32px;"><h2 style="font-size:24px;font-weight:600;margin:0 0 16px;">Chapter 1: Foundations</h2>
      <p style="font-size:16px;line-height:1.7;color:var(--mute);margin:0 0 16px;">A design system is more than a component library. It's a shared language between design and engineering.</p>
      <blockquote style="margin:24px 0;padding:20px 24px;border-left:3px solid var(--accent);font-size:18px;font-style:italic;">"The best design systems are invisible — they get out of the way."</blockquote>
      <h3 style="font-size:18px;font-weight:600;margin:24px 0 12px;">Steps to build your system</h3>
      ${["Audit existing UI patterns","Define design tokens","Build core components","Document usage guidelines","Establish governance"].map((s,i)=>`<div style="display:flex;gap:12px;align-items:start;margin-bottom:12px;"><div style="width:24px;height:24px;border-radius:50%;background:var(--accent);color:white;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;flex-shrink:0;">${i+1}</div><p style="font-size:15px;margin:0;">${s}</p></div>`).join("")}</div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "after-hours-editorial",
    name: "After-hours editorial",
    scenario: "marketing",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Dark, moody editorial template — evening/midnight aesthetic for creative content.",
    template: HTML_BASE("After Hours", `<div style="max-width:700px;margin:0 auto;padding:64px 24px;">
      <header style="margin-bottom:48px;"><p style="font-size:11px;text-transform:uppercase;letter-spacing:0.2em;color:var(--accent);margin:0 0 16px;">After Hours · Issue 12</p>
      <h1 style="font-size:48px;font-weight:700;line-height:1.1;margin:0 0 16px;">Midnight<br/>Manifesto</h1>
      <p style="font-size:18px;color:var(--mute);max-width:500px;">When the office empties, the real work begins.</p></header>
      <div style="font-size:18px;line-height:1.8;"><p style="margin:0 0 24px;">There's a particular quality to work done after midnight. The world goes quiet, and in that silence, ideas sharpen into clarity.</p>
      <blockquote style="margin:32px 0;padding:24px 0;border-top:1px solid var(--hairline);font-size:24px;font-style:italic;line-height:1.4;">"The night is the time when the mind wanders furthest."</blockquote>
      <p style="margin:0;">This is not about hustle culture. This is about the creative space that opens when the day's obligations fall away.</p></div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "field-notes",
    name: "Field notes",
    scenario: "personal",
    mode: "template",
    preview: { kind: "single-page", aspect: "8/11" },
    description: "Pocket field-notes template — compact, grid-lined, utilitarian.",
    template: HTML_BASE("Field Notes", `<div style="max-width:500px;margin:0 auto;padding:32px;background:var(--bg);">
      <div style="padding:24px;background:var(--surface);border:1px solid var(--hairline);border-radius:4px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;padding-bottom:12px;border-bottom:2px solid var(--fg);"><span style="font-size:14px;font-weight:700;">FIELD NOTES</span><span style="font-size:12px;color:var(--mute);">No. 47</span></div>
        <div style="margin-bottom:16px;"><p style="font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px;">Observation</p><div style="height:1px;background:var(--hairline);margin-bottom:8px;"></div><div style="height:1px;background:var(--hairline);margin-bottom:8px;"></div><div style="height:1px;background:var(--hairline);margin-bottom:8px;"></div><div style="height:1px;background:var(--hairline);"></div></div>
        <div style="margin-bottom:16px;"><p style="font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px;">Action Items</p>${["Item 1","Item 2","Item 3"].map(()=>`<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;"><div style="width:12px;height:12px;border:1px solid var(--fg);border-radius:2px;"></div><div style="flex:1;height:1px;background:var(--hairline);"></div></div>`).join("")}</div>
        <div><p style="font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.1em;margin:0 0 8px;">Notes</p><div style="height:1px;background:var(--hairline);margin-bottom:8px;"></div><div style="height:1px;background:var(--hairline);margin-bottom:8px;"></div><div style="height:1px;background:var(--hairline);"></div></div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "fintech-dashboard",
    name: "Fintech dashboard",
    scenario: "finance",
    mode: "template",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Financial dashboard template with balance, transactions, charts, and accounts.",
    template: HTML_BASE("Fintech", `<div style="max-width:1000px;margin:0 auto;padding:32px;">
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px;">
        ${[{l:"Total Balance",v:"$48,293.50",c:"var(--accent)"},{l:"Monthly Income",v:"$12,400.00",c:"#22c55e"},{l:"Monthly Spend",v:"$8,120.30",c:"#ef4444"},{l:"Investments",v:"$124,800",c:"var(--accent)"}].map(m=>`<div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><p style="font-size:12px;color:var(--mute);margin:0 0 8px;">${m.l}</p><p style="font-size:24px;font-weight:700;margin:0;color:${m.c};">${m.v}</p></div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;">
        <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:16px;font-weight:600;margin:0 0 16px;">Spending Trend</h3><div style="height:160px;display:flex;align-items:end;gap:4px;">${[40,55,35,60,45,70,50,65,55,80,60,75].map(h=>`<div style="flex:1;background:var(--accent);border-radius:2px 2px 0 0;height:${h}%;opacity:0.7;"></div>`).join("")}</div></div>
        <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:16px;font-weight:600;margin:0 0 16px;">Recent</h3>${[{a:"-$42.50",d:"Coffee shop"},{a:"-$120.00",d:"Groceries"},{a:"+$12,400",d:"Salary"},{a:"-$89.00",d:"Subscription"}].map(t=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--hairline);font-size:13px;"><span style="color:var(--mute);">${t.d}</span><span style="font-weight:600;color:${t.a.startsWith("+")?"#22c55e":"var(--fg)"};">${t.a}</span></div>`).join("")}</div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "saas-dashboard",
    name: "SaaS dashboard",
    scenario: "product",
    mode: "template",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "SaaS metrics dashboard with MRR, churn, users, and growth charts.",
    template: HTML_BASE("SaaS", `<div style="max-width:1000px;margin:0 auto;padding:32px;">
      <h1 style="font-size:24px;font-weight:700;margin:0 0 24px;">Dashboard</h1>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px;">
        ${[{l:"MRR",v:"$124,500",delta:"+12%"},{l:"Active Users",v:"8,420",delta:"+8%"},{l:"Churn Rate",v:"2.1%",delta:"-0.3%"},{l:"NPS",v:"72",delta:"+5"}].map(m=>`<div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><p style="font-size:12px;color:var(--mute);margin:0 0 8px;">${m.l}</p><div style="display:flex;align-items:baseline;gap:8px;"><span style="font-size:24px;font-weight:700;">${m.v}</span><span style="font-size:12px;color:#22c55e;">${m.delta}</span></div></div>`).join("")}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;">
        <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:16px;font-weight:600;margin:0 0 16px;">Revenue Growth</h3><div style="height:160px;display:flex;align-items:end;gap:6px;">${[30,35,40,38,45,50,55,60,58,65,70,80].map(h=>`<div style="flex:1;background:var(--accent);border-radius:2px 2px 0 0;height:${h}%;"></div>`).join("")}</div></div>
        <div style="padding:20px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;"><h3 style="font-size:16px;font-weight:600;margin:0 0 16px;">Top Features</h3>${["Dashboard","API","Integrations","Reports","Collaboration"].map((f,i)=>`<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;"><span style="color:var(--mute);">${f}</span><span>${90-i*8}%</span></div>`).join("")}</div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  // ── More utility / marketing skills ─────────────────────────────────
  {
    id: "ad-creative",
    name: "Ad creative",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "single-page", aspect: "1/1" },
    description: "Generate ad creatives — social ads, display ads, banner ads.",
    template: HTML_BASE("Ad Creative", `<div style="max-width:500px;margin:0 auto;padding:48px;text-align:center;">
      <div style="width:100%;aspect-ratio:1/1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px;">
        <h2 style="font-size:28px;font-weight:700;margin:0 0 8px;">Headline Here</h2>
        <p style="color:var(--mute);font-size:14px;margin:0 0 24px;">Compelling subtext that drives clicks.</p>
        <button style="padding:12px 24px;background:var(--accent);color:white;border:none;border-radius:8px;font-weight:600;">Shop Now</button>
      </div>
      <p style="color:var(--mute);font-size:13px;margin:12px 0 0;">Ad creative generation area</p>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "creative-director",
    name: "Creative director",
    scenario: "marketing",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Creative brief / direction document with mood board, references, and guidelines.",
    template: HTML_BASE("Creative Direction", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <header style="margin-bottom:32px;"><p style="font-size:12px;color:var(--accent);text-transform:uppercase;letter-spacing:0.12em;margin:0;">Creative Brief</p><h1 style="font-size:28px;font-weight:700;margin:8px 0 0;">Brand Campaign Q2 2026</h1></header>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:32px;">${["Modern","Bold","Playful"].map(m=>`<div style="aspect-ratio:1;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;">${m}</div>`).join("")}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        ${[{t:"Tone",d:"Confident, modern, approachable. Never corporate."},{t:"Audience",d:"Design-forward tech teams, 25-40."},{t:"Key Message",d:"Ship faster without sacrificing craft."},{t:"Deliverables",d:"Landing page, social ads, email, deck."}].map(s=>`<div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;"><h3 style="font-size:14px;font-weight:600;margin:0 0 8px;color:var(--accent);">${s.t}</h3><p style="font-size:14px;color:var(--mute);margin:0;">${s.d}</p></div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "landing-page-builder",
    name: "Landing page builder",
    scenario: "marketing",
    mode: "prototype",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Interactive landing page builder with drag-drop sections and real-time preview.",
    template: HTML_BASE("Builder", `<div style="max-width:1100px;margin:0 auto;padding:32px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;"><h1 style="font-size:24px;font-weight:700;margin:0;">Landing Builder</h1><div style="display:flex;gap:8px;"><button style="padding:8px 16px;border:1px solid var(--hairline);border-radius:6px;font-size:13px;">Preview</button><button style="padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;font-size:13px;">Publish</button></div></div>
      <div style="display:flex;gap:16px;">
        <div style="width:200px;flex-shrink:0;">
          <p style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:var(--mute);margin:0 0 12px;">Sections</p>
          ${["Hero","Features","Pricing","Testimonials","CTA","Footer"].map(s=>`<div style="padding:8px 12px;margin-bottom:6px;background:var(--surface);border:1px solid var(--hairline);border-radius:6px;font-size:13px;cursor:grab;">${s}</div>`).join("")}
        </div>
        <div style="flex:1;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:32px;min-height:500px;">
          <div style="text-align:center;padding:48px;border:2px dashed var(--hairline);border-radius:8px;margin-bottom:16px;"><p style="font-size:24px;font-weight:700;margin:0 0 8px;">Hero Section</p><p style="color:var(--mute);">Your headline goes here</p></div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">${["Feature 1","Feature 2","Feature 3"].map(f=>`<div style="padding:24px;border:1px dashed var(--hairline);border-radius:8px;text-align:center;font-size:14px;color:var(--mute);">${f}</div>`).join("")}</div>
        </div>
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "social-media-kit",
    name: "Social media kit",
    scenario: "marketing",
    mode: "image",
    preview: { kind: "multi-frame", aspect: "1/1" },
    description: "Generate a set of social media assets — profile, cover, post, story templates.",
    template: HTML_BASE("Social Kit", `<div style="max-width:1000px;margin:0 auto;padding:32px;">
      <h1 style="font-size:28px;font-weight:700;margin:0 0 24px;">Social Media Kit</h1>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;">
        ${[{t:"Profile",s:"1:1",w:"400px"},{t:"Cover",s:"3:1",w:"1200px"},{t:"Post",s:"1:1",w:"1080px"},{t:"Story",s:"9:16",w:"1080px"}].map(a=>`<div style="text-align:center;"><div style="aspect-ratio:${a.s==="3:1"?"3/1":a.s==="9:16"?"9/16":"1/1"};background:var(--surface);border:1px solid var(--hairline);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:8px;"><span style="font-size:12px;color:var(--mute);">${a.s}</span></div><p style="font-size:13px;font-weight:500;margin:0;">${a.t}</p><p style="font-size:11px;color:var(--mute);margin:2px 0 0;">${a.w}</p></div>`).join("")}
      </div>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "brand-identity",
    name: "Brand identity",
    scenario: "design",
    mode: "document",
    preview: { kind: "single-page", aspect: "16/10" },
    description: "Brand identity document — logo usage, colors, typography, voice, and guidelines.",
    template: HTML_BASE("Brand Identity", `<div style="max-width:800px;margin:0 auto;padding:48px;">
      <header style="margin-bottom:48px;text-align:center;"><h1 style="font-size:42px;font-weight:700;margin:0;">Brand Name</h1><p style="font-size:18px;color:var(--mute);margin:8px 0 0;">Brand identity guidelines · 2026</p></header>
      <section style="margin-bottom:48px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Logo</h2>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">${["Primary","Icon","Wordmark"].map(v=>`<div style="padding:32px;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;text-align:center;"><div style="width:64px;height:64px;background:var(--accent);border-radius:12px;margin:0 auto 12px;"></div><p style="font-size:13px;color:var(--mute);">${v}</p></div>`).join("")}</div></section>
      <section style="margin-bottom:48px;"><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Colors</h2>
      <div style="display:flex;gap:4px;height:60px;border-radius:8px;overflow:hidden;">${["var(--accent)","#1a1a2e","#f5f5f5","#22c55e","#ef4444"].map(c=>`<div style="flex:1;background:${c};"></div>`).join("")}</div></section>
      <section><h2 style="font-size:20px;font-weight:600;margin:0 0 16px;">Voice</h2>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">${[{t:"Do",items:["Use active voice","Be specific","Write like you speak"]},{t:"Don't",items:["Use jargon","Be vague","Write like a corporation"]}].map(g=>`<div style="padding:16px;background:var(--surface);border:1px solid var(--hairline);border-radius:8px;"><h3 style="font-size:14px;font-weight:600;margin:0 0 12px;">${g.t}</h3>${g.items.map(i=>`<p style="font-size:14px;margin:0 0 6px;">• ${i}</p>`).join("")}</div>`).join("")}</div></section>
    </div>`),
    references: PROTOTYPE_REFS,
  },
  {
    id: "pitch-deck-investor",
    name: "Investor pitch deck",
    scenario: "product",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Investor pitch deck — problem, solution, market, traction, team, ask.",
    template: HTML_BASE("Investor Deck", `<div style="display:flex;height:100vh;">
      ${[{t:"Problem",d:"$50B wasted annually on manual design workflows."},{t:"Solution",d:"AI-powered design platform that ships production artifacts in minutes."},{t:"Market",d:"TAM: $50B · SAM: $12B · SOM: $2B"},{t:"Traction",d:"10K users · $2M ARR · 30% MoM · 95% retention"},{t:"Product",d:"Live demo — from brief to deployed page in 60 seconds."},{t:"Team",d:"Ex-Stripe, ex-Linear, ex-Google. 15 engineers."},{t:"Ask",d:"Raising $10M Series A to scale globally."}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:clamp(32px,6vw,56px);font-weight:700;margin:0 0 24px;">${s.t}</h1>
        <p style="font-size:20px;color:var(--mute);max-width:600px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  {
    id: "product-roadmap-deck",
    name: "Product roadmap deck",
    scenario: "product",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Product roadmap presentation — vision, quarters, milestones, metrics.",
    template: HTML_BASE("Roadmap Deck", `<div style="display:flex;height:100vh;">
      ${[{t:"Vision",d:"The platform every team uses to ship design."},{t:"Q1 2026",d:"Design system v2 · API v3 · Mobile app"},{t:"Q2 2026",d:"Team workspaces · AI features · Plugin ecosystem"},{t:"Q3 2026",d:"Enterprise SSO · Marketplace · Global CDN"},{t:"Metrics",d:"Users: 10K → 100K · ARR: $2M → $20M · NPS: 72 → 80"}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:clamp(28px,5vw,48px);font-weight:700;margin:0 0 24px;">${s.t}</h1>
        <p style="font-size:20px;color:var(--mute);max-width:600px;">${s.d}</p>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
  },
  {
    id: "team-update-deck",
    name: "Team update deck",
    scenario: "operation",
    mode: "deck",
    preview: { kind: "deck" },
    description: "Weekly/bi-weekly team update — wins, blockers, metrics, next week.",
    template: HTML_BASE("Team Update", `<div style="display:flex;height:100vh;">
      ${[{t:"Wins",items:["Shipped v2.4 on time","Closed 3 enterprise deals","Hired 2 engineers"]},{t:"Blockers",items:["CI pipeline slow","Design review backlog","API rate limits"]},{t:"Metrics",items:["MRR: $124K (+12%)","Users: 8.4K (+8%)","Churn: 2.1% (-0.3%)"]},{t:"Next Week",items:["Launch team workspaces","Start enterprise SSO","Design system audit"]}].map((s,i)=>`<section style="min-width:100vw;height:100vh;display:flex;flex-direction:column;justify-content:center;padding:80px;">
        <p style="font-size:12px;text-transform:uppercase;letter-spacing:0.15em;color:var(--accent);margin:0 0 16px;">Week 21 · ${String(i+1).padStart(2,"0")}</p>
        <h1 style="font-size:36px;font-weight:700;margin:0 0 32px;">${s.t}</h1>
        <ul style="font-size:20px;color:var(--mute);line-height:2;list-style:none;padding:0;">${s.items.map(it=>`<li>• ${it}</li>`).join("")}</ul>
      </section>`).join("")}
    </div>`),
    references: DECK_REFS,
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
