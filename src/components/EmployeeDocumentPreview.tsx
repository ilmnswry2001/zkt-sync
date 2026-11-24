import { direction, ui } from "@/lib/ui-language";
import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatErrorMessage } from "@/lib/error-message";

const PdfPreview = lazy(() => import("@/components/EmployeeDocumentPdf"));

type Attachment = { url: string; mimeType: string | null };

export function EmployeeDocumentPreview({
  documentId,
  userId,
  title,
  fileName,
  loadAttachment,
  onClose,
  onRestoreFocus,
}: {
  documentId: string;
  userId: string;
  title: string;
  fileName: string;
  loadAttachment: (signal: AbortSignal) => Promise<Attachment>;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const attachment = useQuery({
    queryKey: ["employee-document-preview", userId, documentId],
    queryFn: ({ signal }) => loadAttachment(signal),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const loading = (
    <p role="status" className="p-4 text-sm">{ui("جارٍ تحميل المعاينة…")}</p>
  );
  const file = attachment.data;
  const isPdf =
    file?.mimeType === "application/pdf" || (!file?.mimeType && /\.pdf$/i.test(fileName));

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        dir={direction()}
        className="w-[calc(100%-1.5rem)] max-w-4xl rounded-lg p-4 sm:p-6"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader className="pr-8 text-right sm:text-right">
          <DialogTitle className="break-words">{title}</DialogTitle>
          <DialogDescription className="break-words">{fileName}</DialogDescription>
        </DialogHeader>
        {attachment.isPending && loading}
        {attachment.isError && (
          <div className="grid justify-items-start gap-3">
            <p role="alert" className="text-sm text-destructive">
              {ui(formatErrorMessage(attachment.error, "تعذر فتح المرفق"))}
            </p>
            <Button type="button" variant="outline" onClick={() => void attachment.refetch()}>{ui("إعادة المحاولة")}</Button>
          </div>
        )}
        {file &&
          (isPdf ? (
            <Suspense fallback={loading}>
              <PdfPreview key={file.url} url={file.url} />
            </Suspense>
          ) : (
            <ImagePreview key={file.url} url={file.url} fileName={fileName} />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function ImagePreview({ url, fileName }: { url: string; fileName: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <p role="alert" className="text-sm text-destructive">{ui("تعذر عرض الصورة. أغلق المعاينة وافتحها مجدداً، أو نزّل المرفق.")}</p>
  ) : (
    <img
      src={url}
      alt={fileName}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="mx-auto max-h-[70dvh] max-w-full rounded-md object-contain"
    />
  );
}
