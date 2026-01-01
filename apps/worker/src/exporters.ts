import { MarkdownDocx, Packer } from "markdown-docx";

export type DocxMeta = {
  title?: string;
  creator?: string;
  description?: string;
};

export async function renderDocx(markdown: string, meta?: DocxMeta): Promise<ArrayBuffer> {
  const converter = new MarkdownDocx(markdown);
  const doc = await converter.toDocument({
    title: meta?.title,
    creator: meta?.creator,
    description: meta?.description
  });
  return await Packer.toArrayBuffer(doc);
}
