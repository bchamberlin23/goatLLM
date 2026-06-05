import { useState, useEffect, useCallback, useRef, memo, useMemo, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { Components } from "react-markdown";
import type { HighlighterCore } from "shiki/core";
import type { LanguageRegistration, ThemeRegistration } from "shiki/types";

type LanguageModule = { default: LanguageRegistration[] };
type ThemeModule = { default: ThemeRegistration };

const LANGUAGE_LOADERS: Array<() => Promise<LanguageModule>> = [
  () => import("shiki/dist/langs/javascript.mjs"),
  () => import("shiki/dist/langs/typescript.mjs"),
  () => import("shiki/dist/langs/tsx.mjs"),
  () => import("shiki/dist/langs/jsx.mjs"),
  () => import("shiki/dist/langs/python.mjs"),
  () => import("shiki/dist/langs/rust.mjs"),
  () => import("shiki/dist/langs/go.mjs"),
  () => import("shiki/dist/langs/bash.mjs"),
  () => import("shiki/dist/langs/sh.mjs"),
  () => import("shiki/dist/langs/json.mjs"),
  () => import("shiki/dist/langs/yaml.mjs"),
  () => import("shiki/dist/langs/toml.mjs"),
  () => import("shiki/dist/langs/css.mjs"),
  () => import("shiki/dist/langs/html.mjs"),
  () => import("shiki/dist/langs/markdown.mjs"),
  () => import("shiki/dist/langs/sql.mjs"),
  () => import("shiki/dist/langs/dockerfile.mjs"),
  () => import("shiki/dist/langs/c.mjs"),
  () => import("shiki/dist/langs/cpp.mjs"),
  () => import("shiki/dist/langs/java.mjs"),
  () => import("shiki/dist/langs/swift.mjs"),
  () => import("shiki/dist/langs/kotlin.mjs"),
];

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = Promise.all([
      import("shiki/core"),
      import("shiki/engine/javascript"),
      Promise.all(LANGUAGE_LOADERS.map((load) => load())),
      import("shiki/dist/themes/github-dark-dimmed.mjs") as Promise<ThemeModule>,
    ]).then(([{ createHighlighterCore }, { createJavaScriptRegexEngine }, languageModules, theme]) =>
      createHighlighterCore({
        themes: [theme.default],
        langs: languageModules.flatMap((module) => module.default),
        engine: createJavaScriptRegexEngine(),
      }),
    );
  }
  return highlighterPromise;
}

interface CodeBlockProps {
  language: string;
  code: string;
  deferHighlight?: boolean;
}

const CodeBlock = memo(function CodeBlock({ language, code, deferHighlight = false }: CodeBlockProps) {
  const [html, setHtml] = useState<string>("");
  const [highlightState, setHighlightState] = useState<"loading" | "ready" | "failed" | "deferred">(
    deferHighlight ? "deferred" : "loading",
  );
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (deferHighlight) {
      setHtml("");
      setHighlightState("deferred");
      return;
    }

    let cancelled = false;
    setHtml("");
    setHighlightState("loading");
    const timer = window.setTimeout(() => {
      getHighlighter()
        .then((highlighter) => {
          if (cancelled) return;
          const langs = highlighter.getLoadedLanguages() as string[];
          const lang = langs.includes(language) ? language : "text";
          const highlighted = highlighter.codeToHtml(code, {
            lang,
            theme: "github-dark-dimmed",
          });
          if (!cancelled) {
            setHtml(highlighted);
            setHighlightState("ready");
          }
        })
        .catch(() => {
          if (!cancelled) {
            setHtml("");
            setHighlightState("failed");
          }
        });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [code, language, deferHighlight]);

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
      {html && highlightState === "ready" ? (
        <div className="code-block__content" dangerouslySetInnerHTML={{ __html: html }} />
      ) : highlightState === "failed" ? (
        <pre className="code-block__content code-block__content--plain"><code>{code}</code></pre>
      ) : (
        <div className="code-block__content code-block__placeholder" aria-live="polite">
          <span>{highlightState === "deferred" ? "Writing code..." : "Rendering code..."}</span>
          <span className="code-block__placeholder-line" aria-hidden="true" />
          <span className="code-block__placeholder-line code-block__placeholder-line--short" aria-hidden="true" />
        </div>
      )}
    </div>
  );
});

type MarkdownCodeProps = React.ComponentPropsWithoutRef<"code"> & {
  node?: unknown;
  inline?: boolean;
  children?: ReactNode;
};

const createComponents = (deferHighlight: boolean): Components => ({
  code(props) {
    const { inline, className, children, ...codeProps } = props as MarkdownCodeProps;
    const match = /language-(\w+)/.exec(className || "");
    const language = match ? match[1] : "";
    const code = String(children).replace(/\n$/, "");
    if (!inline && (match || code.includes("\n"))) {
      return <CodeBlock language={language} code={code} deferHighlight={deferHighlight} />;
    }
    return <code className="inline-code" {...codeProps}>{children}</code>;
  },

  pre({ children }: { children?: ReactNode }) {
    return <>{children}</>;
  },

  a({ href, children, ...props }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="md-link" {...props}>
        {children}
      </a>
    );
  },

  table({ children, ...props }) {
    return (
      <div className="md-table-wrapper">
        <table className="md-table" {...props}>{children}</table>
      </div>
    );
  },

  blockquote({ children, ...props }) {
    return <blockquote className="md-blockquote" {...props}>{children}</blockquote>;
  },
});

interface MarkdownRendererProps {
  content: string;
  isStreaming?: boolean;
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

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  isStreaming = false,
}: MarkdownRendererProps) {
  const normalized = useMemo(() => normalizeMath(content), [content]);
  const markdownComponents = useMemo(
    () => createComponents(isStreaming),
    [isStreaming],
  );

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
        {normalized}
      </ReactMarkdown>
    </div>
  );
});
