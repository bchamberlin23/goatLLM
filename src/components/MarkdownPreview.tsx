import { MarkdownRenderer } from "./MarkdownRenderer";

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="flex-1 min-h-0 overflow-auto bg-bg px-6 py-5">
      <div className="mx-auto w-full max-w-[720px] pb-8">
        <MarkdownRenderer content={content} />
      </div>
    </div>
  );
}
