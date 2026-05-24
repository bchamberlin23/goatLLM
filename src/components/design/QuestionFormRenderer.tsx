import { useState, useCallback } from "react";
import type { ParsedQuestionForm } from "../../lib/design/parser";
import { formatFormSubmission } from "../../lib/design/parser";
import { useChatStore } from "../../stores/chat";
import { ArrowRight } from "lucide-react";

/**
 * Inline question-form renderer. Reads a parsed `<question-form>` block
 * out of a streaming assistant message and renders native form controls.
 * Submitting dispatches a structured user follow-up so the model can read
 * the answers in the next turn.
 */
export function QuestionFormRenderer({
  form,
  conversationId,
  disabled,
}: {
  form: ParsedQuestionForm;
  conversationId: string;
  disabled?: boolean;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [submitted, setSubmitted] = useState(false);
  const setPendingFormSubmission = useChatStore((s) => s.setPendingFormSubmission);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (submitted || disabled) return;
      const text = formatFormSubmission(form.id, values);
      setSubmitted(true);
      setPendingFormSubmission({ conversationId, text });
    },
    [form.id, values, submitted, disabled, conversationId, setPendingFormSubmission],
  );

  const setRadio = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));
  const toggleCheckbox = (name: string, value: string) =>
    setValues((v) => {
      const cur = Array.isArray(v[name]) ? (v[name] as string[]) : [];
      const next = cur.includes(value)
        ? cur.filter((x) => x !== value)
        : [...cur, value];
      return { ...v, [name]: next };
    });
  const setText = (name: string, value: string) =>
    setValues((v) => ({ ...v, [name]: value }));

  return (
    <form
      onSubmit={handleSubmit}
      className="my-3 rounded-xl border border-white/[0.08] bg-[#2a2a2c] overflow-hidden"
      aria-label="Discovery form"
    >
      <div className="px-4 py-2.5 border-b border-white/[0.06] flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-[#888] font-semibold">
          {form.id === "direction" ? "Pick a direction" : "A few quick questions"}
        </span>
        <span className="text-[10.5px] text-[#666]">
          {form.fields.length} field{form.fields.length === 1 ? "" : "s"}
        </span>
      </div>

      <fieldset
        disabled={disabled || submitted}
        className="p-4 space-y-4 disabled:opacity-60"
      >
        {form.fields.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`qf-${form.id}-${field.name}`}
              className="block text-[12.5px] font-medium text-[#ececec] mb-1.5"
            >
              {field.label}
            </label>

            {field.type === "radio" && field.options.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {field.options.map((opt) => {
                  const active = values[field.name] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setRadio(field.name, opt.value)}
                      className={`text-left px-3 py-2 rounded-lg border text-[12.5px] transition-colors ${
                        active
                          ? "border-[#f59e42]/60 bg-[#f59e42]/[0.08] text-[#ececec]"
                          : "border-white/[0.06] bg-white/[0.02] text-[#d5d5d5] hover:bg-white/[0.05] hover:border-white/[0.12]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {field.type === "checkbox" && field.options.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {field.options.map((opt) => {
                  const cur = Array.isArray(values[field.name])
                    ? (values[field.name] as string[])
                    : [];
                  const active = cur.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => toggleCheckbox(field.name, opt.value)}
                      className={`text-left px-3 py-2 rounded-lg border text-[12.5px] transition-colors ${
                        active
                          ? "border-[#f59e42]/60 bg-[#f59e42]/[0.08] text-[#ececec]"
                          : "border-white/[0.06] bg-white/[0.02] text-[#d5d5d5] hover:bg-white/[0.05] hover:border-white/[0.12]"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {field.type === "text" && (
              <input
                id={`qf-${form.id}-${field.name}`}
                type="text"
                value={(values[field.name] as string) ?? ""}
                onChange={(e) => setText(field.name, e.target.value)}
                className="w-full bg-[#1a1a1c] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-[#ececec] outline-none focus:border-[#f59e42]/50"
              />
            )}

            {field.type === "textarea" && (
              <textarea
                id={`qf-${form.id}-${field.name}`}
                value={(values[field.name] as string) ?? ""}
                onChange={(e) => setText(field.name, e.target.value)}
                rows={3}
                className="w-full bg-[#1a1a1c] border border-white/[0.06] rounded-lg px-3 py-2 text-[13px] text-[#ececec] outline-none focus:border-[#f59e42]/50 resize-none"
              />
            )}
          </div>
        ))}
      </fieldset>

      <div className="px-4 py-3 border-t border-white/[0.06] flex items-center justify-between bg-white/[0.02]">
        <span className="text-[11px] text-[#a0a0a0]">
          {submitted
            ? "Submitted. The model is reading your answers."
            : "Answers post back as a structured message."}
        </span>
        <button
          type="submit"
          disabled={submitted || disabled}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#f59e42] hover:bg-[#f0903a] disabled:bg-[#3a3a3a] disabled:cursor-not-allowed text-[12px] font-medium text-[#1a1a1c] transition-colors"
        >
          {submitted ? "Submitted" : "Submit"}
          <ArrowRight size={12} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </form>
  );
}
