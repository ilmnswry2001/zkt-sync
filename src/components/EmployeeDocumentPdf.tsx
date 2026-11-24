import { ui } from "@/lib/ui-language";
import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { Button } from "@/components/ui/button";

GlobalWorkerOptions.workerSrc = workerUrl;

// Resolve PDF.js resources through Vite so scanned PDFs work with the bundled worker.
const resourceUrls = import.meta.glob<string>(
  [
    "../../node_modules/pdfjs-dist/cmaps/*.bcmap",
    "../../node_modules/pdfjs-dist/standard_fonts/*.{pfb,ttf}",
    "../../node_modules/pdfjs-dist/wasm/{jbig2,openjpeg}.wasm",
  ],
  { eager: true, query: "?url&no-inline", import: "default" },
);

class PdfResources {
  async fetch({ kind, filename }: { kind: string; filename: string }) {
    const directory = { cMapUrl: "cmaps", standardFontDataUrl: "standard_fonts", wasmUrl: "wasm" }[
      kind
    ];
    const url = resourceUrls[`../../node_modules/pdfjs-dist/${directory}/${filename}`];
    if (!url) throw new Error("Unknown PDF resource");
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not load PDF resource");
    return new Uint8Array(await response.arrayBuffer());
  }
}

export default function EmployeeDocumentPdf({ url }: { url: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let task: ReturnType<typeof getDocument> | undefined;

    async function load() {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          credentials: "omit",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) throw new Error("Could not fetch attachment");
        const data = await response.arrayBuffer();
        if (controller.signal.aborted) return;
        task = getDocument({ data, BinaryDataFactory: PdfResources, useWorkerFetch: false });
        const document = await task.promise;
        if (!controller.signal.aborted) setPdf(document);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    }

    void load();
    return () => {
      controller.abort();
      void task?.destroy().catch(() => {});
    };
  }, [url]);

  if (failed) {
    return (
      <p role="alert" className="text-sm text-destructive">{ui("تعذر عرض ملف PDF. أغلق المعاينة وافتحها مجدداً، أو نزّل المرفق.")}</p>
    );
  }
  if (!pdf)
    return (
      <p role="status" className="p-4 text-sm">{ui("جارٍ تحميل ملف PDF…")}</p>
    );

  return (
    <div className="grid min-w-0 gap-3">
      <div className="max-h-[63dvh] overflow-auto rounded-md border bg-muted p-2">
        <PdfPage key={page} pdf={pdf} page={page} />
      </div>
      <div className="flex items-center justify-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >{ui("السابقة")}</Button>
        <span role="status" className="text-sm text-muted-foreground">{ui("صفحة ")}{page}{ui(" من ")}{pdf.numPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={page === pdf.numPages}
          onClick={() => setPage(page + 1)}
        >{ui("التالية")}</Button>
      </div>
    </div>
  );
}

function PdfPage({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let rendering: RenderTask | undefined;

    async function renderPage(canvas: HTMLCanvasElement) {
      try {
        const pdfPage = await pdf.getPage(page);
        if (cancelled) return;
        const size = pdfPage.getViewport({ scale: 1 });
        const scale = Math.min(2, 2000 / Math.max(size.width, size.height));
        const viewport = pdfPage.getViewport({ scale });
        canvas.width = Math.max(1, Math.ceil(viewport.width));
        canvas.height = Math.max(1, Math.ceil(viewport.height));
        rendering = pdfPage.render({ canvas, viewport });
        await rendering.promise;
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void renderPage(canvas);
    return () => {
      cancelled = true;
      rendering?.cancel();
    };
  }, [pdf, page]);

  return (
    <>
      {status === "loading" && (
        <p role="status" className="p-4 text-sm">{ui("جارٍ عرض الصفحة…")}</p>
      )}
      {status === "error" && (
        <p role="alert" className="p-4 text-sm text-destructive">{ui("تعذر عرض هذه الصفحة.")}</p>
      )}
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={(ui("صفحة ") + (page) + ui(" من المستند"))}
        hidden={status !== "ready"}
        className="mx-auto h-auto max-w-full bg-white"
      />
    </>
  );
}
