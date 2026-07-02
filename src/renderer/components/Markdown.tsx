import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`prose-sm ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold text-gray-100 mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold text-gray-100 mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-gray-200 mt-3 mb-1">{children}</h3>,
          p: ({ children }) => <p className="text-sm text-gray-300 leading-relaxed mb-2">{children}</p>,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-violet-400 hover:text-violet-300 underline">{children}</a>,
          ul: ({ children }) => <ul className="list-disc pl-5 text-sm text-gray-300 mb-2 space-y-1">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 text-sm text-gray-300 mb-2 space-y-1">{children}</ol>,
          li: ({ children }) => <li className="text-gray-300">{children}</li>,
          code: ({ children, className }) => {
            const isInline = !className
            if (isInline) return <code className="font-mono text-xs bg-gray-900 text-violet-300 px-1 py-0.5 rounded">{children}</code>
            return <code className={className}>{children}</code>
          },
          pre: ({ children }) => <pre className="bg-gray-950 border border-gray-800 rounded-lg p-3 overflow-x-auto text-xs my-2">{children}</pre>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-violet-500 pl-3 text-gray-400 italic my-2">{children}</blockquote>,
          table: ({ children }) => <table className="border-collapse text-xs my-2">{children}</table>,
          th: ({ children }) => <th className="border border-gray-700 px-2 py-1 bg-gray-800 text-gray-200">{children}</th>,
          td: ({ children }) => <td className="border border-gray-700 px-2 py-1 text-gray-300">{children}</td>,
          hr: () => <hr className="border-gray-800 my-3" />,
          strong: ({ children }) => <strong className="font-semibold text-gray-100">{children}</strong>,
          em: ({ children }) => <em className="italic text-gray-300">{children}</em>,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}
