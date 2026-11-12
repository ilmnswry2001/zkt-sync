import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

type Bucket = "vehicle-images" | "maintenance-attachments" | "fuel-receipts";

// Existing records store a public URL. Keep the object key stable and sign it at display time.
export function PrivateStorageMedia({
  bucket,
  reference,
  children,
}: {
  bucket: Bucket;
  reference: string;
  children: (url: string) => ReactNode;
}) {
  const { user } = useAuth();
  const prefix = `storage://${bucket}/`;
  const marker = `/storage/v1/object/public/${bucket}/`;
  let path = reference.startsWith(prefix) ? reference.slice(prefix.length) : "";
  if (!path && reference.includes(marker)) {
    try {
      path = decodeURIComponent(new URL(reference).pathname.split(marker)[1] ?? "");
    } catch {
      path = "";
    }
  }
  const signed = useQuery({
    queryKey: ["private-storage-media", user?.id, bucket, path],
    enabled: !!user && !!path,
    staleTime: 4 * 60_000,
    refetchInterval: 4 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  if (!path) {
    if (!/^(https?:\/\/|\/(?!\/))/.test(reference)) return <span>مرجع مرفق غير صالح</span>;
    return <>{children(reference)}</>;
  }
  if (!user || signed.isError)
    return <span className="text-xs text-muted-foreground">تعذر عرض المرفق</span>;
  return signed.data ? (
    <>{children(signed.data)}</>
  ) : (
    <span className="text-xs text-muted-foreground">جارٍ تحميل المرفق…</span>
  );
}
