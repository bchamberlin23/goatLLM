import React, { Suspense, useEffect, useRef } from "react";
import type { Artifact } from "../../stores/chat";

const MonacoEditor = React.lazy(() => import("@monaco-editor/react"));

interface CodePaneProps {
  artifact: Artifact;
  language: string;
  onCodeChange: (value: string) => void;
}

export function CodeSkeleton() {
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-[#a0a0a0]">
      Loading editor...
    </div>
  );
}

export function CodePane({ artifact, language, onCodeChange }: CodePaneProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
  const editorRef = useRef<any>(null);
  const wasStreamingRef = useRef(false);
  const autoFollowRef = useRef(true);

  useEffect(() => {
    autoFollowRef.current = true;
  }, [artifact.id]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const isNow = artifact.versions?.[
      artifact.activeVersionIndex ?? (artifact.versions?.length ?? 1) - 1
    ]?.streaming;
    if (isNow && autoFollowRef.current) {
      const model = editor.getModel();
      if (model) editor.revealLine(model.getLineCount(), 1);
    }
    if (wasStreamingRef.current && !isNow) autoFollowRef.current = true;
    wasStreamingRef.current = !!isNow;
  }, [artifact.code, artifact.id, artifact.activeVersionIndex, artifact.versions]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sibling-prompt WIP, ownership respected per task spec
  const handleEditorMount = (editor: any) => {
    editorRef.current = editor;
    editor.onDidScrollChange(() => {
      const model = editor.getModel();
      if (!model) return;
      const visibleRanges = editor.getVisibleRanges();
      if (visibleRanges.length === 0) return;
      const lastVisible = visibleRanges[visibleRanges.length - 1];
      autoFollowRef.current = model.getLineCount() - lastVisible.endLineNumber <= 2;
    });
  };

  return (
    <div className="flex-1 min-h-0">
      <Suspense fallback={<CodeSkeleton />}>
        <MonacoEditor
          height="100%"
          defaultLanguage={language}
          language={language}
          value={artifact.code}
          theme="vs-dark"
          onMount={handleEditorMount}
          onChange={(value) => {
            if (value !== undefined) onCodeChange(value);
          }}
          options={{
            fontSize: 13,
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            wordWrap: "on",
            tabSize: 2,
            automaticLayout: true,
            renderLineHighlight: "line",
            lineNumbers: "on",
            smoothScrolling: true,
            cursorSmoothCaretAnimation: "on",
            padding: { top: 12, bottom: 12 },
          }}
        />
      </Suspense>
    </div>
  );
}
