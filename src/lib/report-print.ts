function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ??
      character,
  );
}

export function printReport(title: string, body: string) {
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1100,height=800");
  if (!printWindow) return false;
  printWindow.document
    .write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,"Tahoma",sans-serif;color:#17202a;padding:28px;line-height:1.5}h1{font-size:24px;margin:0 0 6px;color:#0f766e}h2{font-size:17px;margin:22px 0 8px;border-bottom:2px solid #0f766e;padding-bottom:6px}p{margin:4px 0;color:#475569}.meta{display:flex;gap:32px;margin:14px 0 20px;padding:12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px}.meta b{color:#0f766e}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:13px}th{background:#0f766e;color:white;font-weight:700}th,td{border:1px solid #cbd5e1;padding:8px;text-align:right}tr:nth-child(even){background:#f8fafc}.total{font-weight:700;background:#ccfbf1!important}.note{border-right:4px solid #0f766e;background:#f8fafc;padding:10px;margin-top:14px}@media print{body{padding:0}@page{size:A4;margin:14mm}.no-print{display:none}}
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
  return true;
}

export { escapeHtml };
