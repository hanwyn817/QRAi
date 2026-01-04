import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

export function renderMarkdown(content: string): string {
  return md.render(content);
}
