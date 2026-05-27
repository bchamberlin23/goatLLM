import { describe, it, expect } from "vitest";
import {
  splitByQuestionForm,
  parseQuestionForm,
  formatFormSubmission,
} from "../lib/design/parser";

describe("question-form parser", () => {
  it("splits text + complete JSON form + trailing text", () => {
    const content = `Sure, picking the brief now.

<question-form id="discovery" title="Quick brief — 30 seconds">
{
  "description": "I'll lock these in before building.",
  "questions": [
    { "id": "output", "label": "What are we making?", "type": "radio", "required": true,
      "options": ["Slide deck / pitch", "Single web prototype / landing", "Dashboard / tool UI"] },
    { "id": "audience", "label": "Who is this for?", "type": "text",
      "placeholder": "e.g. early-stage investors" },
    { "id": "brand", "label": "Brand context", "type": "radio",
      "options": [
        { "label": "Pick a direction for me", "value": "pick_direction" },
        { "label": "I have a brand spec", "value": "brand_spec" }
      ] }
  ]
}
</question-form>

Trailing prose.`;
    const segments = splitByQuestionForm(content);
    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe("text");
    expect(segments[1].type).toBe("question-form");
    if (segments[1].type === "question-form") {
      expect(segments[1].form?.id).toBe("discovery");
      expect(segments[1].form?.title).toBe("Quick brief — 30 seconds");
      expect(segments[1].form?.description).toBe("I'll lock these in before building.");
      expect(segments[1].form?.fields).toHaveLength(3);
      expect(segments[1].form?.fields[0].type).toBe("radio");
      expect(segments[1].form?.fields[0].options).toHaveLength(3);
      expect(segments[1].form?.fields[0].required).toBe(true);
      expect(segments[1].form?.fields[1].type).toBe("text");
      expect(segments[1].form?.fields[1].placeholder).toBe("e.g. early-stage investors");
      expect(segments[1].form?.fields[2].options[0].value).toBe("pick_direction");
    }
    expect(segments[2].type).toBe("text");
  });

  it("emits a streaming segment for an open-but-not-closed form", () => {
    const content = `<question-form id="discovery">{ "questions": [`;
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

  it("parses checkbox with maxSelections", () => {
    const raw = `<question-form id="discovery">
{
  "questions": [
    { "id": "tone", "label": "Visual tone", "type": "checkbox", "maxSelections": 2,
      "options": ["Editorial / magazine", "Modern minimal", "Tech / utility"] }
  ]
}
</question-form>`;
    const form = parseQuestionForm(raw);
    expect(form?.fields[0].type).toBe("checkbox");
    expect(form?.fields[0].maxSelections).toBe(2);
    expect(form?.fields[0].options).toHaveLength(3);
  });

  it("parses select type", () => {
    const raw = `<question-form id="x">
{
  "questions": [
    { "id": "voice", "label": "Voice", "type": "select",
      "options": ["Formal", "Casual", "Playful"] }
  ]
}
</question-form>`;
    const form = parseQuestionForm(raw);
    expect(form?.fields[0].type).toBe("select");
    expect(form?.fields[0].options).toHaveLength(3);
  });

  it("returns null when body has zero questions", () => {
    const form = parseQuestionForm(`<question-form id="x">{ "questions": [] }</question-form>`);
    expect(form).toBeNull();
  });

  it("returns null for completely unparseable garbage", () => {
    const raw = `<question-form id="x">
Just a paragraph of text with no fields at all.
</question-form>`;
    const form = parseQuestionForm(raw);
    expect(form).toBeNull();
  });

  it("formats a submission with the open-design prefix", () => {
    const out = formatFormSubmission("discovery", {
      output: "Single web prototype / landing",
      tone: ["editorial", "marketing"],
    });
    expect(out).toContain("[form answers — discovery]");
    expect(out).toContain("output: Single web prototype / landing");
    expect(out).toContain("tone: editorial, marketing");
  });

  it("formats blank submission with trust-your-judgment note", () => {
    const out = formatFormSubmission("discovery", {
      output: "",
      audience: "",
    });
    expect(out).toContain("[form answers — discovery]");
    expect(out).toContain("All fields left blank");
  });

  // ── XML fallback (backward compat) ──

  it("falls back to XML field parsing when body is not JSON", () => {
    const raw = `<question-form id="discovery">
  <field name="surface" label="Surface?" type="radio">
    <option value="landing">Landing page</option>
    <option value="dashboard">Dashboard</option>
  </field>
  <field name="brand" label="Brand notes" type="textarea" />
</question-form>`;
    const form = parseQuestionForm(raw);
    expect(form?.fields).toHaveLength(2);
    expect(form?.fields[0].type).toBe("radio");
    expect(form?.fields[0].options).toHaveLength(2);
    expect(form?.fields[0].id).toBe("surface");
    expect(form?.fields[1].type).toBe("textarea");
  });

  it("parses single-quoted attributes in XML fallback", () => {
    const raw =
      `<question-form id='discovery'>
        <field name='surface' label='Surface' type='radio'>
          <option value='landing'>Landing page</option>
        </field>
      </question-form>`;
    const form = parseQuestionForm(raw);
    expect(form?.fields[0].id).toBe("surface");
    expect(form?.fields[0].options[0].value).toBe("landing");
  });

  it("parses form with prose before and after tags", () => {
    const content = `Sure, let me figure out what you need.

<question-form id="discovery">
{
  "questions": [
    { "id": "output", "label": "What?", "type": "text" }
  ]
}
</question-form>

Let me know once you've filled this out!`;
    const segments = splitByQuestionForm(content);
    expect(segments).toHaveLength(3);
    expect(segments[0].type).toBe("text");
    expect(segments[1].type).toBe("question-form");
    expect(segments[2].type).toBe("text");
  });

  it("parses a JSON form wrapped in a markdown fence", () => {
    const raw = `<question-form id="discovery">
\`\`\`
{
  "questions": [
    { "id": "output", "label": "What?", "type": "radio", "options": ["Landing", "Deck"] }
  ]
}
\`\`\`
</question-form>`;
    const segments = splitByQuestionForm(raw);
    expect(segments).toHaveLength(1);
    if (segments[0].type === "question-form" && segments[0].form) {
      expect(segments[0].form.fields).toHaveLength(1);
      expect(segments[0].form.fields[0].id).toBe("output");
    }
  });

  it("handles direction-cards type", () => {
    const raw = `<question-form id="direction">
{
  "questions": [
    { "id": "direction", "label": "Direction", "type": "direction-cards",
      "options": ["editorial-monocle", "modern-minimal"],
      "cards": [{ "id": "editorial-monocle", "label": "Editorial" }] }
  ]
}
</question-form>`;
    const form = parseQuestionForm(raw);
    expect(form?.fields[0].type).toBe("direction-cards");
    expect(form?.fields[0].cards).toHaveLength(1);
  });
});
