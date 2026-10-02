function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ??
      character,
  );
}

export function printReport(title: string, body: string) {
  const printWindow = window.open("about:blank", "_blank", "width=1100,height=800");
  if (!printWindow) return false;
  printWindow.document
    .write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,"Tahoma",sans-serif;color:#17202a;padding:28px;line-height:1.55;background:#fff}h1{font-size:24px;margin:0 0 6px;color:#0f766e}h2{font-size:21px;margin:0 0 4px;color:#064e3b}p{margin:4px 0;color:#475569}.meta{display:flex;gap:32px;margin:14px 0 20px;padding:12px;background:#f0fdfa;border:1px solid #99f6e4;border-radius:6px}.meta b{color:#0f766e}table{width:100%;border-collapse:collapse;margin:8px 0 18px;font-size:13px}th{background:#0f766e;color:white;font-weight:700}th,td{border:1px solid #cbd5e1;padding:8px;text-align:right;vertical-align:top}tr:nth-child(even){background:#f8fafc}.total{font-weight:700;background:#ccfbf1!important}.note{border-right:4px solid #10b7a0;background:#f1f7fa;padding:12px 14px;margin-top:14px;border-radius:8px}.plan-sheet{break-inside:avoid;page-break-inside:avoid;margin-bottom:26px;border:1px solid #d5e0e6;border-radius:18px;overflow:hidden;box-shadow:0 12px 35px #102c3a12}.plan-sheet:not(:first-child){page-break-before:always}.plan-header{display:flex;justify-content:space-between;gap:18px;align-items:center;padding:25px 28px;background:linear-gradient(120deg,#102b46,#12465a 65%,#067d78);color:#fff;border-bottom:4px solid #39d5bb}.plan-header h2{margin-top:7px;color:#fff;font-size:25px}.plan-header p{font-size:14px;color:#d7e8ed}.eyebrow{font-size:11px;font-weight:700;color:#7ce4d0;letter-spacing:.08em}.status{white-space:nowrap;background:#b7f1e6;color:#0c3d48;border-radius:999px;padding:7px 12px;font-size:11px;font-weight:700}.meta-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:9px;padding:16px 20px;background:#f2f7f8}.meta-grid div{border:1px solid #dbe7e9;border-radius:11px;padding:10px;background:#fff}.meta-grid span{display:block;color:#647b84;font-size:10px}.meta-grid strong{display:block;margin-top:4px;font-size:14px;color:#153b4b}.plan-table{margin:0;border:0}.plan-table th,.plan-table td{padding:11px 12px}.plan-table th{background:#183d53}.name-chip{display:inline-block;border:1px solid;border-radius:999px;padding:4px 9px;margin:2px;font-size:11px;background:#fff}.plan-sheet>.note{margin:14px 20px 20px}.plan-footer{display:flex;justify-content:space-between;border-top:1px solid #dbe7e9;padding:13px 20px;color:#68808a;font-size:10px}@media print{body{padding:0}@page{size:A4 portrait;margin:12mm}.no-print{display:none}.plan-sheet{box-shadow:none}.plan-header{print-color-adjust:exact;-webkit-print-color-adjust:exact}.meta-grid,.plan-table th,.name-chip{print-color-adjust:exact;-webkit-print-color-adjust:exact}}
  </style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`);
  printWindow.document.close();
  printWindow.focus();
  window.setTimeout(() => printWindow.print(), 500);
  return true;
}

export { escapeHtml };
