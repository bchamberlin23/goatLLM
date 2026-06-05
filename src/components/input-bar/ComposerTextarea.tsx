import { useCallback, useRef, useState, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { FileReferencePicker } from "../FileReferencePicker";

interface ComposerTextareaProps {
  value: string;
  isFollowUp: boolean;
  isStreaming: boolean;
  noModelsAvailable: boolean;
  agentMode: boolean;
  designMode: boolean;
  speechListening: boolean;
  fileReferenceWorkspace: string | null;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onHistoryRecall: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
}

export function ComposerTextarea({ value, isFollowUp, isStreaming, noModelsAvailable, agentMode, designMode, speechListening, fileReferenceWorkspace, textareaRef, onChange, onSubmit, onHistoryRecall, onPaste }: ComposerTextareaProps) {
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? fallbackRef;
  const [fileRefQuery, setFileRefQuery] = useState<string | null>(null);
  const [fileRefPosition, setFileRefPosition] = useState<{ top: number; left: number } | null>(null);
  const lastSizedValue = useRef<string | null>(null);

  const resize = useCallback(() => {
    const textarea = ref.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 180) + "px";
  }, [ref]);

  const scheduleResize = useCallback(() => {
    requestAnimationFrame(resize);
  }, [resize]);

  if (lastSizedValue.current !== value) {
    lastSizedValue.current = value;
    scheduleResize();
  }

  const updateFileReferenceState = useCallback((nextValue: string, cursorPos: number) => {
    if (!fileReferenceWorkspace) return;
    const textBeforeCursor = nextValue.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex < 0) {
      setFileRefQuery(null);
      setFileRefPosition(null);
      return;
    }
    const textAfterAt = textBeforeCursor.slice(atIndex + 1);
    if (textAfterAt.includes(" ") || textAfterAt.includes("\n")) {
      setFileRefQuery(null);
      setFileRefPosition(null);
      return;
    }
    const textarea = ref.current;
    if (!textarea) return;
    const rect = textarea.getBoundingClientRect();
    setFileRefQuery(textAfterAt);
    setFileRefPosition({ top: rect.top - 250, left: rect.left + 16 });
  }, [fileReferenceWorkspace, ref]);

  const handleChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    onChange(nextValue);
    scheduleResize();
    updateFileReferenceState(nextValue, event.target.selectionStart);
  }, [onChange, scheduleResize, updateFileReferenceState]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (fileRefQuery !== null && ["Enter", "Tab", "Escape", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    if (event.key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      onHistoryRecall();
      scheduleResize();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
      return;
    }
    if (event.key === "Enter" && event.shiftKey) scheduleResize();
  }, [fileRefQuery, onHistoryRecall, onSubmit, scheduleResize]);

  const handleFileRefSelect = useCallback((selectedPath: string) => {
    const textarea = ref.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf("@");
    if (atIndex >= 0) {
      const before = value.slice(0, atIndex);
      const after = value.slice(cursorPos);
      const nextValue = before + "@" + selectedPath + " " + after;
      onChange(nextValue);
      requestAnimationFrame(() => {
        const newPos = atIndex + selectedPath.length + 2;
        textarea.selectionStart = newPos;
        textarea.selectionEnd = newPos;
        textarea.focus();
        resize();
      });
    }
    setFileRefQuery(null);
    setFileRefPosition(null);
  }, [onChange, ref, resize, value]);

  const handleFileRefClose = useCallback(() => {
    setFileRefQuery(null);
    setFileRefPosition(null);
  }, []);

  const placeholder = speechListening ? "Listening…" : isStreaming ? "Working — type to queue or steer…" : noModelsAvailable ? "Add a provider in Settings to begin" : designMode ? "Design anything" : agentMode ? "Do anything" : "Ask anything";

  return (
    <>
      <textarea
        ref={ref}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        rows={1}
        aria-label="Message input"
        placeholder={placeholder}
        className={["w-full", isFollowUp ? "min-h-[28px]" : "min-h-[40px]", "max-h-[180px] bg-transparent text-[16px] text-[#ececec] placeholder:text-[#b4b4b4] resize-none focus:outline-none leading-relaxed"].join(" ")}
      />
      {fileRefQuery !== null && fileRefPosition && fileReferenceWorkspace && (
        <FileReferencePicker workspace={fileReferenceWorkspace} query={fileRefQuery} onSelect={handleFileRefSelect} onClose={handleFileRefClose} position={fileRefPosition} />
      )}
    </>
  );
}
