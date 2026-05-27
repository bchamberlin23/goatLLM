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
    expect(hasResolvableReferences(html)).toBe(true);
  });

  it("detects CSS link with rel after href", () => {
    const html = `<link href="main.css" rel="stylesheet">`;
    expect(hasResolvableReferences(html)).toBe(true);
  });

  it("detects script src references", () => {
    const html = `<script src="app.js"></script>`;
    expect(hasResolvableReferences(html)).toBe(true);
  });

  it("detects image src references", () => {
    const html = `<img src="logo.png" alt="Logo">`;
    expect(hasResolvableReferences(html)).toBe(true);
  });

  it("ignores external URLs", () => {
    const html = `
      <link rel="stylesheet" href="https://cdn.example.com/style.css">
      <script src="http://example.com/app.js"></script>
      <img src="https://example.com/image.png">
    `;
    expect(hasResolvableReferences(html)).toBe(false);
  });

  it("ignores data URIs", () => {
    const html = `
      <img src="data:image/png;base64,iVBOR...">
      <link rel="stylesheet" href="data:text/css;base64,...">
    `;
    expect(hasResolvableReferences(html)).toBe(false);
  });

  it("ignores absolute paths", () => {
    const html = `
      <link rel="stylesheet" href="/assets/style.css">
      <script src="/js/app.js"></script>
    `;
    expect(hasResolvableReferences(html)).toBe(false);
  });

  it("ignores inline scripts", () => {
    const html = `<script>console.log('hello');</script>`;
    expect(hasResolvableReferences(html)).toBe(false);
  });

  it("returns false for HTML with no references", () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    expect(hasResolvableReferences(html)).toBe(false);
  });
});

describe("getReferenceSummary", () => {
  it("extracts all reference types", () => {
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

    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toEqual(["reset.css", "main.css"]);
    expect(summary.jsFiles).toEqual(["vendor.js", "app.js"]);
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

    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toEqual(["local.css"]);
    expect(summary.jsFiles).toEqual(["local.js"]);
    expect(summary.images).toEqual(["local.png"]);
  });

  it("handles nested paths", () => {
    const html = `
      <link rel="stylesheet" href="css/components/button.css">
      <script src="js/utils/helpers.js"></script>
      <img src="assets/images/logo.svg">
    `;

    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toEqual(["css/components/button.css"]);
    expect(summary.jsFiles).toEqual(["js/utils/helpers.js"]);
    expect(summary.images).toEqual(["assets/images/logo.svg"]);
  });

  it("handles relative paths with ..", () => {
    const html = `
      <link rel="stylesheet" href="../shared/styles.css">
      <script src="../../vendor/lib.js"></script>
    `;

    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toEqual(["../shared/styles.css"]);
    expect(summary.jsFiles).toEqual(["../../vendor/lib.js"]);
  });

  it("handles different quote styles", () => {
    const html = `
      <link rel='stylesheet' href='single.css'>
      <link rel="stylesheet" href="double.css">
      <script src='single.js'></script>
      <script src="double.js"></script>
    `;

    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toContain("single.css");
    expect(summary.cssFiles).toContain("double.css");
    expect(summary.jsFiles).toContain("single.js");
    expect(summary.jsFiles).toContain("double.js");
  });

  it("handles mixed attribute order in link tags", () => {
    const html = `
      <link href="first.css" rel="stylesheet" type="text/css">
      <link rel="stylesheet" href="second.css" media="screen">
      <link media="print" href="third.css" rel="stylesheet">
    `;

    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toContain("first.css");
    expect(summary.cssFiles).toContain("second.css");
    expect(summary.cssFiles).toContain("third.css");
  });

  it("returns empty arrays for HTML with no references", () => {
    const html = `<html><body><h1>Hello</h1></body></html>`;
    const summary = getReferenceSummary(html);

    expect(summary.cssFiles).toEqual([]);
    expect(summary.jsFiles).toEqual([]);
    expect(summary.images).toEqual([]);
  });

  it("ignores fragment identifiers and query strings", () => {
    const html = `
      <img src="image.png?v=123">
      <img src="icon.svg#logo">
    `;

    const summary = getReferenceSummary(html);

    expect(summary.images).toEqual(["image.png?v=123", "icon.svg#logo"]);
  });
});
