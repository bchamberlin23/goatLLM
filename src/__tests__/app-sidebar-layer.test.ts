import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("app sidebar layer", () => {
  it("keeps sidebar overlays above the chat pane", () => {
    const app = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");

    expect(app).toContain("relative z-20 h-full overflow-hidden shrink-0");
  });
});
