"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Tailwind's reset removes default list/heading styles, so we restore them here
const STYLES = [
  "text-sm leading-relaxed break-words",
  "[&_p]:mb-2 [&_p:last-child]:mb-0",
  "[&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5",
  "[&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5",
  "[&_li]:mb-1",
  "[&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
  "[&_h2]:mb-2 [&_h2]:mt-3 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mb-1 [&_h3]:font-semibold",
  "[&_strong]:font-semibold",
  "[&_code]:rounded [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
  "[&_pre]:mb-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-gray-100 [&_pre]:p-3",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
  "[&_table]:mb-2 [&_table]:border-collapse",
  "[&_th]:border [&_th]:border-gray-300 [&_th]:bg-gray-50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_td]:border [&_td]:border-gray-300 [&_td]:px-2 [&_td]:py-1",
].join(" ");

export default function Markdown({ children }) {
  return (
    <div className={`overflow-x-auto ${STYLES}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline" />
          ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  );
}
