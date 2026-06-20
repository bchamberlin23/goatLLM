import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAmbientGlowPosition } from "../lib/ambient-glow";

function GlowProbe() {
  const ref = useRef<HTMLDivElement>(null);
  useAmbientGlowPosition(ref);

  return <div ref={ref} data-testid="glow-probe" />;
}

describe("ambient glow pointer tracking", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates glow variables from pointer movement anywhere in the window", () => {
    render(<GlowProbe />);
    const field = screen.getByTestId("glow-probe");
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue({
      left: 200,
      top: 100,
      width: 800,
      height: 600,
    } as DOMRect);

    fireEvent.pointerMove(window, { clientX: 600, clientY: 400 });

    expect(field.style.getPropertyValue("--glow-x")).toBe("50%");
    expect(field.style.getPropertyValue("--glow-y")).toBe("50%");
  });

  it("keeps the glow inside its visual field when the pointer is over the sidebar", () => {
    render(<GlowProbe />);
    const field = screen.getByTestId("glow-probe");
    vi.spyOn(field, "getBoundingClientRect").mockReturnValue({
      left: 244,
      top: 0,
      width: 800,
      height: 600,
    } as DOMRect);

    fireEvent.pointerMove(window, { clientX: 120, clientY: 300 });

    expect(field.style.getPropertyValue("--glow-x")).toBe("0%");
    expect(field.style.getPropertyValue("--glow-y")).toBe("50%");
  });

  it("places the glass sidebar over the same ambient field as the main panel", () => {
    const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    const sidebarRule = css.match(/\.sidebar-surface\s*\{([\s\S]*?)\n\}/)?.[1];

    expect(app).toContain("useAmbientGlowPosition(shellRef, glowBackgroundEnabled);");
    expect(app.indexOf("liquid-glow-field")).toBeLessThan(app.indexOf("<Sidebar"));
    expect(sidebarRule).toContain("background-color: rgba(26, 26, 28, 0.42);");
    expect(sidebarRule).toContain("backdrop-filter: blur(24px) saturate(1.14);");
    expect(sidebarRule).not.toContain("background-image");
  });
});
