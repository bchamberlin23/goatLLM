import { describe, it, expect } from "vitest";
import {
  hasResolvableReferences,
  getReferenceSummary,
} from "../lib/artifact-resolver";

describe("hasResolvableReferences", () => {
  it("detects CSS link references", () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="styles.css">
        </head>
      </html>
    `;
    expect(hasResolvableReferences(html, "html")).toBe(true);
  });

  it("detects CSS link with rel after href", () => {
    const html = `<link href="main.css" rel="stylesheet">`;
    expect(hasResolvableReferences(html, "html")).toBe(true);
  });

  it("detects script src references", () => {
    const html = `<script src="app.js"></script>`;
    expect(hasResolvableReferences(html, "html")).toBe(true);
  });

  it("detects image src references", () => {
    const html = `<img src="logo.png" alt="Logo">`;
    expect(hasResolvableReferences(html, "html")).toBe(true);
  });

  it("ignores external URLs", () => {
    const html = `
      <link rel="stylesheet" href="https://cdn.example.com/style.css">
      <script src="http://example.com/app.js"></script>
      <img src="https://example.com/image.png">
    `;
    expect(hasResolvableReferences(html, "html")).toBe(false);
  });

  it("ignores data URIs", () => {
    const html = `
      <img src="data:image/png;base64,iVBOR...">
      <link rel="stylesheet" href="data:text/css;base64,...">
    `;
    expect(hasResolvableReferences(html, "html")).toBe(false);
  });

  it("ignores absolute paths", () => {
    const html = `
      <link rel="stylesheet" href="/assets/style.css">
      <script src="/js/app.js"></script>
    `;
    expect(hasResolvableReferences(html, "html")).toBe(false);
  });

  it("ignores inline scripts", () => {
    const html = `<script>console.log('hello');</script>`;
    expect(hasResolvableReferences(html, "html")).toBe(false);
  });

  it("returns false for HTML with no references", () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    expect(hasResolvableReferences(html, "html")).toBe(false);
  });

  it("detects CSS @import references", () => {
    const css = `@import "reset.css";\n@import url("typography.css");`;
    expect(hasResolvableReferences(css, "css")).toBe(true);
  });

  it("detects CSS url() references", () => {
    const css = `.bg { background: url("images/bg.png"); }`;
    expect(hasResolvableReferences(css, "css")).toBe(true);
  });

  it("detects JS import statements", () => {
    const js = `import { foo } from "./utils.js";\nimport bar from '../lib/bar.js';`;
    expect(hasResolvableReferences(js, "js")).toBe(true);
  });

  it("detects JS require statements", () => {
    const js = `const helper = require("./helper.js");`;
    expect(hasResolvableReferences(js, "js")).toBe(true);
  });

  it("detects SVG use href references", () => {
    const svg = `<svg><use href="icons.svg#icon-1"></use></svg>`;
    expect(hasResolvableReferences(svg, "svg")).toBe(true);
  });
});

describe("getReferenceSummary", () => {
  it("extracts all reference types from HTML", () => {
    const html = `
      <html>
        <head>
          <link rel="stylesheet" href="reset.css">
          <link rel="stylesheet" href="main.css">
          <script src="vendor.js"></script>
          <script src="app.js"></script>
        </head>
        <body>
          <img src="logo.png" alt="Logo">
          <img src="hero.jpg" alt="Hero">
        </body>
      </html>
    `;

    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toEqual(["reset.css", "main.css"]);
    expect(summary.scripts).toEqual(["vendor.js", "app.js"]);
    expect(summary.images).toEqual(["logo.png", "hero.jpg"]);
  });

  it("ignores external and absolute paths", () => {
    const html = `
      <link rel="stylesheet" href="local.css">
      <link rel="stylesheet" href="https://cdn.example.com/external.css">
      <link rel="stylesheet" href="/absolute.css">
      <script src="local.js"></script>
      <script src="http://example.com/external.js"></script>
      <img src="local.png">
      <img src="data:image/svg+xml,...">
    `;

    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toEqual(["local.css"]);
    expect(summary.scripts).toEqual(["local.js"]);
    expect(summary.images).toEqual(["local.png"]);
  });

  it("handles nested paths", () => {
    const html = `
      <link rel="stylesheet" href="css/components/button.css">
      <script src="js/utils/helpers.js"></script>
      <img src="assets/images/logo.svg">
    `;

    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toEqual(["css/components/button.css"]);
    expect(summary.scripts).toEqual(["js/utils/helpers.js"]);
    expect(summary.images).toEqual(["assets/images/logo.svg"]);
  });

  it("handles relative paths with ..", () => {
    const html = `
      <link rel="stylesheet" href="../shared/styles.css">
      <script src="../../vendor/lib.js"></script>
    `;

    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toEqual(["../shared/styles.css"]);
    expect(summary.scripts).toEqual(["../../vendor/lib.js"]);
  });

  it("handles different quote styles", () => {
    const html = `
      <link rel='stylesheet' href='single.css'>
      <link rel="stylesheet" href="double.css">
      <script src='single.js'></script>
      <script src="double.js"></script>
    `;

    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toContain("single.css");
    expect(summary.stylesheets).toContain("double.css");
    expect(summary.scripts).toContain("single.js");
    expect(summary.scripts).toContain("double.js");
  });

  it("handles mixed attribute order in link tags", () => {
    const html = `
      <link href="first.css" rel="stylesheet" type="text/css">
      <link rel="stylesheet" href="second.css" media="screen">
      <link media="print" href="third.css" rel="stylesheet">
    `;

    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toContain("first.css");
    expect(summary.stylesheets).toContain("second.css");
    expect(summary.stylesheets).toContain("third.css");
  });

  it("returns empty arrays for HTML with no references", () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    const summary = getReferenceSummary(html, "html");

    expect(summary.stylesheets).toEqual([]);
    expect(summary.scripts).toEqual([]);
    expect(summary.images).toEqual([]);
  });

  it("extracts CSS @import references", () => {
    const css = `
      @import "reset.css";
      @import url("typography.css");
      .bg { background: url("images/bg.png"); }
    `;

    const summary = getReferenceSummary(css, "css");

    expect(summary.imports).toContain("reset.css");
    expect(summary.imports).toContain("typography.css");
    expect(summary.images).toContain("images/bg.png");
  });

  it("extracts JS import statements", () => {
    const js = `
      import { foo } from "./utils.js";
      import bar from '../lib/bar.js';
      const helper = require("./helper.js");
    `;

    const summary = getReferenceSummary(js, "js");

    expect(summary.imports).toContain("./utils.js");
    expect(summary.imports).toContain("../lib/bar.js");
    expect(summary.imports).toContain("./helper.js");
  });
});
