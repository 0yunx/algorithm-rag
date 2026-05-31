'use client';

import ReactMarkdown from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import { cn } from '@/lib/utils';

type MarkdownViewProps = {
  content: string;
  className?: string;
  inline?: boolean;
  variant?: 'default' | 'document';
};

export function MarkdownView({ content, className, inline = false, variant = 'default' }: MarkdownViewProps) {
  return (
    <div className={cn('markdown-body text-sm leading-6', inline && 'markdown-body-compact', variant === 'document' && 'markdown-body-document', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeSanitize, rehypeKatex]}
        components={{
          a: ({ className: anchorClassName, ...props }) => (
            <a className={cn('text-sky-700 underline underline-offset-2 dark:text-sky-200', anchorClassName)} target="_blank" rel="noreferrer" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
