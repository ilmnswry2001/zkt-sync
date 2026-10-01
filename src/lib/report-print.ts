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
    *{box-sizing:border-box}body{font-family:Arial,"Tahoma",sans-serif;color:#17202a;padding:28px;line-height:1.5;background:#fff}h1{font-size:24px;margin:0 0 6px;color:#0f766e}h2{font-size:21px;margin:0 0 4px;color:#064e3b}p{margin:4px 0;color:#475569}.meta{display:flex;gap:32px;margin:14px 0 20px;padding:12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px}.meta b{color:#0f766e}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:13px}th{background:#0f766e;color:white;font-weight:700}th,td{border:1px solid #cbd5e1;padding:8px;text-align:right;vertical-align:top}tr:nth-child(even){background:#f8fafc}.total{font-weight:700;background:#ccfbf1!important}.note{border-right:4px solid #0f766e;background:#f8fafc;padding:10px;margin-top:14px}.plan-sheet{break-inside:avoid;page-break-inside:avoid;margin-bottom:26px;border:1px solid #cbd5e1;border-radius:12px;overflow:hidden}.plan-sheet:not(:first-child){page-break-before:always}.plan-header{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;padding:18px 20px;background:linear-gradient(135deg,#ecfdf5,#f0fdfa);border-bottom:1px solid #99f6e4}.plan-header h2{margin-top:4px}.plan-header p{font-size:13px}.eyebrow{font-size:11px;font-weight:700;color:#0f766e;letter-spacing:.04em}.status{white-space:nowrap;background:#047857;color:white;border-radius:999px;padding:5px 10px;font-size:11px}.meta-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:14px 20px;background:#f8fafc}.meta-grid div{border:1px solid #e2e8f0;border-radius:8px;padding:8px}.meta-grid span{display:block;color:#64748b;font-size:10px}.meta-grid strong{display:block;margin-top:2px;font-size:13px}.plan-table{margin:0;border:0}.plan-table th,.plan-table td{padding:10px 12px}.name-chip{display:inline-block;border:1px solid;border-radius:999px;padding:3px 8px;margin:2px;font-size:11px;background:#fff}.plan-sheet>.note{margin:14px 20px 20px}@media print{body{padding:0}@page{size:A4 portrait;margin:12mm}.no-print{display:none}.plan-sheet{box-shadow:none}.plan-header{print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-grid,.plan-table th,.name-chip{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 250);
  return true;
}

export { escapeHtml };
