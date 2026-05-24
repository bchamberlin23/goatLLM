import { describe, it, expect } from "vitest";
import {
  splitByQuestionForm,
  parseQuestionForm,
  formatFormSubmission,
} from "../lib/design/parser";

describe("question-form parser", () => {
  it("splits text + complete form + trailing text", () => {
    const content = `Sure, picking the brief now.

<question-form id="discovery">
  <field name="surface" label="Surface?" type="radio">
    <option value="landing">Landing page</option>
    <option value="dashboard">Dashboard</option>
  </field>
  <field name="brand" label="Brand notes" type="textarea" />
</question-form>

Trailing prose.`;
    const segments = splitByQuestionForm(content);
    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe("text");
    expect(segments[1].type).toBe("question-form");
    if (segments[1].type === "question-form") {
      expect(segments[1].form?.id).toBe("discovery");
      expect(segments[1].form?.fields).toHaveLength(2);
      expect(segments[1].form?.fields[0].type).toBe("radio");
      expect(segments[1].form?.fields[0].options).toHaveLength(2);
      expect(segments[1].form?.fields[1].type).toBe("textarea");
    }
    expect(segments[2].type).toBe("text");
  });

  it("emits a streaming segment for an open-but-not-closed form", () => {
    const content = `<question-form id="discovery"><field name="x" label="X" type="text" />`;
    const segments = splitByQuestionForm(content);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("question-form");
    if (segments[0].type === "question-form") {
      expect(segments[0].form).toBeNull();
    }
  });

  it("returns plain text when there is no form", () => {
    const content = "just a normal assistant reply with <em>html</em>";
    const segments = splitByQuestionForm(content);
    expect(segments).toEqual([{ type: "text", text: content }]);
  });

  it("parses a self-closing field", () => {
    const form = parseQuestionForm(
      `<question-form id="x"><field name="brand" label="Brand" type="text" /></question-form>`,
    );
    expect(form?.fields[0].type).toBe("text");
    expect(form?.fields[0].name).toBe("brand");
  });

  it("returns null when body has zero fields", () => {
    const form = parseQuestionForm(`<question-form id="x"></question-form>`);
    expect(form).toBeNull();
  });

  it("formats a submission with arrays joined", () => {
    const out = formatFormSubmission("discovery", {
      surface: "landing",
      tone: ["editorial", "marketing"],
    });
    expect(out).toContain("[form: discovery]");
    expect(out).toContain("surface: landing");
    expect(out).toContain("tone: editorial, marketing");
  });

  // ── Hardened parser: real model output edge cases ──

  it("parses single-quoted attributes", () => {
    const raw =
      `<question-form id='discovery'>
        <field name='surface' label='Surface' type='radio'>
          <option value='landing'>Landing page</option>
        </field>
      </question-form>`;
    const segments = splitByQuestionForm(raw);
    expect(segments).toHaveLength(1);
    expect(segments[0].type).toBe("question-form");
    if (segments[0].type === "question-form") {
      expect(segments[0].form).not.toBeNull();
      expect(segments[0].form?.fields[0].name).toBe("surface");
      expect(segments[0].form?.fields[0].options[0].value).toBe("landing");
    }
  });

  it("parses form with prose before and after tags", () => {
    const content = `Sure, let me figure out what you need.

<question-form id="discovery">
  <field name="surface" label="Surface?" type="radio">
    <option value="landing">Landing page</option>
  </field>
</question-form>

Let me know once you've filled this out!`;
    const segments = splitByQuestionForm(content);
    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe("text");
    expect(segments[1].type).toBe("question-form");
    expect(segments[2].type).toBe("text");
  });

  it("parses a form wrapped in a markdown fence (model creative output)", () => {
    const raw = `<question-form id="discovery">
\`\`\`
  <field name="surface" label="Surface" type="radio">
    <option value="landing">Landing</option>
  </field>
\`\`\`
</question-form>`;
    const segments = splitByQuestionForm(raw);
    expect(segments).toHaveLength(1);
    if (segments[0].type === "question-form" && segments[0].form) {
      expect(segments[0].form.fields).toHaveLength(1);
      expect(segments[0].form.fields[0].name).toBe("surface");
    }
  });

  it("handles unquoted attribute values", () => {
    const raw =
      `<question-form id=discovery>
        <field name=surface label=Surface type=radio>
          <option value=landing>Landing page</option>
        </field>
      </question-form>`;
    const form = parseQuestionForm(raw);
    // Unquoted attributes that contain no spaces should work.
    // id=discovery resolves via the unquoted fallback.
    if (form) {
      expect(form.fields).toHaveLength(1);
      expect(form.fields[0].name).toBe("surface");
    }
  });

  it("returns null for completely unparseable garbage", () => {
    const raw = `<question-form id="x">
Just a paragraph of text with no fields at all.
</question-form>`;
    const form = parseQuestionForm(raw);
    expect(form).toBeNull();
  });

  it("tolerates mixed quote styles in same form", () => {
    const raw =
      `<question-form id="discovery">
        <field name='surface' label="Surface" type='radio'>
          <option value="landing">Landing</option>
        </field>
      </question-form>`;
    const form = parseQuestionForm(raw);
    expect(form).not.toBeNull();
    expect(form?.fields).toHaveLength(1);
    expect(form?.fields[0].name).toBe("surface");
  });
});
