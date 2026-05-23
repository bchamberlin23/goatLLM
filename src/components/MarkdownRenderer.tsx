import { useState, useEffect, useCallback, useRef, memo, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { BundledLanguage, HighlighterGeneric } from "shiki";

let highlighterPromise: Promise<HighlighterGeneric<any, any>> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then(
      ({ createHighlighter }) =>
        createHighlighter({
          themes: ["github-dark-dimmed"],
          langs: [
            "javascript", "typescript", "tsx", "jsx", "python", "rust", "go",
            "bash", "sh", "json", "yaml", "toml", "css", "html", "markdown",
            "sql", "dockerfile", "c", "cpp", "java", "swift", "kotlin",
          ],
        })
    );
  }
  return highlighterPromise;
}

getHighlighter().catch(() => {});

interface CodeBlockProps {
  language: string;
  code: string;
}

const CodeBlock = memo(function CodeBlock({ language, code }: CodeBlockProps) {
  const [html, setHtml] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        const langs = highlighter.getLoadedLanguages() as string[];
        const lang = langs.includes(language) ? language : "text";
        const highlighted = highlighter.codeToHtml(code, {
          lang: lang as BundledLanguage,
          theme: "github-dark-dimmed",
        });
        if (!cancelled) setHtml(highlighted);
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => { cancelled = true; };
  }, [code, language]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  return (
    <div className="code-block">
      <div className="code-block__header">
        <span className="code-block__lang">{language || "text"}</span>
        <button
          className={`code-block__copy ${copied ? "code-block__copy--copied" : ""}`}
          onClick={handleCopy}
          aria-label={copied ? "Copied!" : "Copy code"}
        >
          {copied ? (
            <>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="1.5 7 5 10.5 11.5 3" />
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="8" height="8" rx="1.5" />
                <path d="M9 4V2.5A1.5 1.5 0 007.5 1h-5A1.5 1.5 0 001 2.5v5A1.5 1.5 0 002.5 9H4" />
              </svg>
              Copy
            </>
          )}
        </button>
      </div>
      {html ? (
        <div className="code-block__content" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-block__content code-block__content--plain"><code>{code}</code></pre>
      )}
    </div>
  );
});

interface MarkdownComponents {
  [key: string]: (props: any) => ReactNode;
}

const createComponents = (): MarkdownComponents => ({
  code({ node, inline, className, children, ...props }: {
    node?: any; inline?: boolean; className?: string; children?: ReactNode; [key: string]: any;
  }) {
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const code = String(children).replace(/\n$/, "");
    if (!inline && (match || code.includes("\n"))) {
      return <CodeBlock language={language} code={code} />;
    }
    return <code className="inline-code" {...props}>{children}</code>;
  },

  pre({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  },

  a({ href, children, ...props }: { href?: string; children?: ReactNode; [key: string]: any }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="md-link" {...props}>
        {children}
      </a>
    );
  },

  table({ children, ...props }: { children?: ReactNode; [key: string]: any }) {
    return (
      <div className="md-table-wrapper">
        <table className="md-table" {...props}>{children}</table>
      </div>
    );
  },

  blockquote({ children, ...props }: { children?: ReactNode; [key: string]: any }) {
    return <blockquote className="md-blockquote" {...props}>{children}</blockquote>;
  },
});

const markdownComponents = createComponents();

interface MarkdownRendererProps {
  content: string;
}

/**
 * Many LLMs emit ChatGPT-style LaTeX delimiters \( … \) and \[ … \] for math
 * instead of the dollar-sign syntax remark-math expects. Convert them up front
 * so inline math actually renders.
 *
 * We're careful not to touch:
 *   - fenced code blocks ``` … ```
 *   - inline code `…`
 * because those often contain literal backslashes that should stay as-is.
 */
function normalizeMath(input: string): string {
  if (!input) return input;
  // Quick bail-out when there's no math-style escape at all.
  if (!/\\[(\[]/.test(input)) return input;

  // Split on fenced code blocks and inline code so we can skip them.
  const segments = input.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return segments
    .map((seg, i) => {
      // Odd segments are the captured code spans; leave untouched.
      if (i % 2 === 1) return seg;
      let out = seg;
      // Display math:  \[ … \]  ->  $$ … $$  (multiline allowed)
      out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_m, body) => `$$${body}$$`);
      // Inline math:   \( … \)  ->  $ … $   (single line preferred)
      out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_m, body) => `$${body}$`);
      return out;
    })
    .join("");
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const normalized = normalizeMath(content);
  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
});
