'use client';

import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ReactNode } from 'react';

type MarkdownViewProps = {
  content: string;
  className?: string;
  inline?: boolean;
};

/** Normalize language identifiers: map common aliases to Prism token names. */
const normalizeLang = (lang: string): string => {
  const map: Record<string, string> = {
    bash: 'bash',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    js: 'javascript',
    jsx: 'jsx',
    ts: 'typescript',
    tsx: 'tsx',
    py: 'python',
    rb: 'ruby',
    yml: 'yaml',
    md: 'markdown',
    '': 'text',
    code: 'text',
    plaintext: 'text',
    text: 'text',
  };
  const key = lang.toLowerCase();
  return map[key] ?? key;
};

export function MarkdownView({ content, className, inline = false }: MarkdownViewProps) {
  return (
    <div className={cn('markdown-body text-sm leading-6', inline && 'markdown-body-compact', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ className: anchorClassName, ...props }) => (
            <a className={anchorClassName} target="_blank" rel="noreferrer" {...props} />
          ),

          // ---- Block code (fenced / indented) -> Mac-style window ----
          pre: ({ children }) => {
            // react-markdown renders block code as <pre><code className="language-xxx">...</code></pre>
            const codeEl = children as { props?: { className?: string; children?: ReactNode } } | undefined;
            const codeClassName = codeEl?.props?.className || '';
            const match = /language-(\S+)/.exec(codeClassName);
            const rawLang = match ? match[1] : '';
            const lang = normalizeLang(rawLang);
            const codeString = String(codeEl?.props?.children ?? '').replace(/\n$/, '');

            return (
              <div className="mac-code-block">
                <div className="mac-title-bar">
                  <span className="mac-dot mac-dot-red" />
                  <span className="mac-dot mac-dot-yellow" />
                  <span className="mac-dot mac-dot-green" />
                  <span className="mac-title-text">{rawLang || 'code'}</span>
                </div>
                <SyntaxHighlighter
                  style={oneDark}
                  language={lang}
                  PreTag="div"
                  customStyle={{
                    margin: 0,
                    padding: '16px 20px',
                    background: 'transparent',
                    fontSize: '0.85rem',
                    lineHeight: 1.6,
                    overflowX: 'auto',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}
                  codeTagProps={{
                    style: {
                      background: 'transparent',
                      fontFamily:
                        '"SFMono-Regular", "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                    },
                  }}
                >
                  {codeString}
                </SyntaxHighlighter>
              </div>
            );
          },

          // ---- Inline code: plain <code>, styled by globals.css ----
          code: ({ className: codeClassName, children, ...props }) => (
            <code className={codeClassName} {...props}>
              {children}
            </code>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
