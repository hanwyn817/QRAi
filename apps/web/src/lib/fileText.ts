import mammoth from "mammoth";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf";

GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.js",
  import.meta.url
).toString();

export async function extractTextFromFile(file: File): Promise<string> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type === "text/plain" || extension === "txt" || extension === "md") {
    return await file.text();
  }

  if (extension === "docx") {
    const buffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value ?? "";
  }

  if (extension === "pdf") {
    const buffer = await file.arrayBuffer();
    const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
    let text = "";
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => {
          if ("str" in item) {
            return item.str;
          }
          return "";
        })
        .join(" ");
      text += `${pageText}\n`;
    }
    return text.trim();
  }

  return "";
}
