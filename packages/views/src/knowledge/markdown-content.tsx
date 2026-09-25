import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

const components: Components = {
  a: ({ href, children }) =>
    href ? (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
  // Files will resolve protected attachment references; never auto-load arbitrary images.
  img: ({ alt }) => <span>图片：{alt || '未命名图片'}</span>,
};

export default function MarkdownContent({ markdown }: { markdown: string }) {
  return (
    <div className="break-words rounded-lg border p-6 leading-relaxed [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_h1]:text-2xl [&_h2]:text-xl [&_h3]:text-lg [&_li]:ml-6 [&_ol]:list-decimal [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-4 [&_table]:block [&_table]:overflow-x-auto [&_td]:border [&_td]:p-2 [&_th]:border [&_th]:p-2 [&_ul]:list-disc">
      <Markdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={components}
      >
        {markdown}
      </Markdown>
    </div>
  );
}
