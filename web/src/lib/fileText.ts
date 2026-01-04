let mammothPromise: Promise<typeof import("mammoth")> | null = null;
let pdfjsPromise:
  | Promise<{ getDocument: typeof import("pdfjs-dist/legacy/build/pdf").getDocument }>
  | null = null;

async function loadMammoth() {
  if (!mammothPromise) {
    mammothPromise = import("mammoth");
  }
  const module = await mammothPromise;
  return module.default ?? module;
}

async function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf");
      const worker = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url");
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return { getDocument: pdfjs.getDocument };
    })();
  }
  return pdfjsPromise;
}

export type ExtractTextResult = {
  text: string;
  meta: {
    type: "text" | "docx" | "pdf" | "unknown";
    extractedChars: number;
    pageCount?: number;
    emptyPages?: number;
    workerFallback?: boolean;
    errors?: string[];
  };
};

export async function extractTextFromFile(file: File): Promise<ExtractTextResult> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (file.type === "text/plain" || extension === "txt" || extension === "md") {
    const text = await file.text();
    return { text, meta: { type: "text", extractedChars: text.length } };
  }

  if (extension === "docx") {
    const buffer = await file.arrayBuffer();
    const mammoth = await loadMammoth();
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    const text = result.value ?? "";
    return { text, meta: { type: "docx", extractedChars: text.length } };
  }

  if (extension === "pdf") {
    const buffer = await file.arrayBuffer();
    const data = new Uint8Array(buffer);
    const errors: string[] = [];
    const extractFromPdf = async (disableWorker: boolean) => {
      const { getDocument } = await loadPdfjs();
      const pdf = await getDocument({ data, disableWorker }).promise;
      let text = "";
      let emptyPages = 0;
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
        if (!pageText.trim()) {
          emptyPages += 1;
        }
        text += `${pageText}\n`;
      }
      return { text: text.trim(), pageCount: pdf.numPages, emptyPages };
    };
    try {
      const first = await extractFromPdf(false);
      if (first.text) {
        return {
          text: first.text,
          meta: {
            type: "pdf",
            extractedChars: first.text.length,
            pageCount: first.pageCount,
            emptyPages: first.emptyPages,
            workerFallback: false
          }
        };
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "PDF 提取失败");
    }
    try {
      const second = await extractFromPdf(true);
      return {
        text: second.text,
        meta: {
          type: "pdf",
          extractedChars: second.text.length,
          pageCount: second.pageCount,
          emptyPages: second.emptyPages,
          workerFallback: true,
          errors: errors.length > 0 ? errors : undefined
        }
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "PDF 提取失败");
      return {
        text: "",
        meta: {
          type: "pdf",
          extractedChars: 0,
          workerFallback: true,
          errors: errors.length > 0 ? errors : undefined
        }
      };
    }
  }

  return { text: "", meta: { type: "unknown", extractedChars: 0 } };
}
