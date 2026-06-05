import { useState, useCallback } from "react";
import type { ParsedQuestionForm } from "../../lib/design/parser";
import { formatFormSubmission } from "../../lib/design/parser";
import { useChatStore } from "../../stores/chat";
import { ArrowRight } from "lucide-react";

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

  const setRadio = (fieldId: string, value: string) =>
    setValues((v) => ({ ...v, [fieldId]: value }));
  const toggleCheckbox = (fieldId: string, value: string, maxSelections?: number) =>
    setValues((v) => {
      const cur = Array.isArray(v[fieldId]) ? (v[fieldId] as string[]) : [];
      if (cur.includes(value)) {
        return { ...v, [fieldId]: cur.filter((x) => x !== value) };
      }
      if (maxSelections && cur.length >= maxSelections) {
        return { ...v, [fieldId]: [...cur.slice(1), value] };
      }
      return { ...v, [fieldId]: [...cur, value] };
    });
  const setText = (fieldId: string, value: string) =>
    setValues((v) => ({ ...v, [fieldId]: value }));

  const headerText = form.title ?? (form.id === "direction" ? "Pick a direction" : "A few quick questions");

  return (
    <form
      onSubmit={handleSubmit}
      className="soft-card my-3 rounded-xl overflow-hidden"
      aria-label={headerText}
    >
      <div className="px-4 py-2.5 border-b border-hairline flex items-center justify-between">
        <span className="text-[10.5px] uppercase tracking-[0.12em] text-text-4 font-semibold">
          {headerText}
        </span>
        <span className="text-[10.5px] text-text-4">
          {form.fields.length} field{form.fields.length === 1 ? "" : "s"}
        </span>
      </div>

      {form.description && (
        <p className="px-4 pt-3 text-[11.5px] text-text-3 leading-relaxed">
          {form.description}
        </p>
      )}

      <fieldset
        disabled={disabled || submitted}
        className="p-4 space-y-4 disabled:opacity-60"
      >
        {form.fields.map((field) => (
          <div key={field.id}>
            <label
              htmlFor={`qf-${form.id}-${field.id}`}
              className="block text-[12.5px] font-medium text-text-1 mb-1.5"
            >
              {field.label}
              {field.required && <span className="text-accent ml-0.5">*</span>}
            </label>

            {(field.type === "radio" || field.type === "direction-cards") && field.options.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {field.options.map((opt) => {
                  const active = values[field.id] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setRadio(field.id, opt.value)}
                      className={`text-left px-3 py-2 rounded-lg border text-[12.5px] transition-colors ${
                        active
                          ? "border-accent/60 bg-accent/[0.08] text-text-1"
                          : "border-hairline bg-white/[0.02] text-text-2 hover:bg-white/5 hover:border-hairline-strong"
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
                  const cur = Array.isArray(values[field.id])
                    ? (values[field.id] as string[])
                    : [];
                  const active = cur.includes(opt.value);
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      onClick={() => toggleCheckbox(field.id, opt.value, field.maxSelections)}
                      className={`text-left px-3 py-2 rounded-lg border text-[12.5px] transition-colors ${
                        active
                          ? "border-accent/60 bg-accent/[0.08] text-text-1"
                          : "border-hairline bg-white/[0.02] text-text-2 hover:bg-white/5 hover:border-hairline-strong"
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {field.type === "select" && field.options.length > 0 && (
              <select
                id={`qf-${form.id}-${field.id}`}
                value={(values[field.id] as string) ?? ""}
                onChange={(e) => setText(field.id, e.target.value)}
                className="w-full bg-white/5 border border-hairline-strong rounded-lg px-3 py-2 text-[13px] text-text-1 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
              >
                <option value="">Select...</option>
                {field.options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            )}

            {field.type === "text" && (
              <input
                id={`qf-${form.id}-${field.id}`}
                type="text"
                value={(values[field.id] as string) ?? ""}
                onChange={(e) => setText(field.id, e.target.value)}
                placeholder={field.placeholder}
                className="w-full bg-white/5 border border-hairline-strong rounded-lg px-3 py-2 text-[13px] text-text-1 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 placeholder:text-text-4"
              />
            )}

            {field.type === "textarea" && (
              <textarea
                id={`qf-${form.id}-${field.id}`}
                value={(values[field.id] as string) ?? ""}
                onChange={(e) => setText(field.id, e.target.value)}
                placeholder={field.placeholder}
                rows={3}
                className="w-full bg-white/5 border border-hairline-strong rounded-lg px-3 py-2 text-[13px] text-text-1 outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 resize-none placeholder:text-text-4"
              />
            )}
          </div>
        ))}
      </fieldset>

      <div className="px-4 py-3 border-t border-hairline flex items-center justify-between bg-white/[0.02]">
        <span className="text-[11px] text-text-3">
          {submitted
            ? "Submitted. The model is reading your answers."
            : "Answers post back as a structured message."}
        </span>
        <button
          type="submit"
          disabled={submitted || disabled}
          className="primary-action inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-45 disabled:cursor-not-allowed text-[12px] font-medium transition-colors"
        >
          {submitted ? "Submitted" : "Submit"}
          <ArrowRight size={12} strokeWidth={2.5} aria-hidden />
        </button>
      </div>
    </form>
  );
}
