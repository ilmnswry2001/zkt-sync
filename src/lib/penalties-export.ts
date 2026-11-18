type PenaltyExportRow = {
  employee: string;
  type: string;
  date: string;
  amount: number;
  status: string;
  notes: string | null;
};

export async function downloadPenaltiesExcel(
  rows: PenaltyExportRow[],
  filters: { month: string; type: string; search: string },
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("العقوبات", {
    views: [{ state: "frozen", ySplit: 5, rightToLeft: true, showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "5:5",
    },
  });

  sheet.columns = [32, 16, 16, 22, 22, 48].map((width) => ({ width }));
  sheet.mergeCells("A1:F1");
  sheet.mergeCells("A2:F2");
  sheet.getCell("A1").value = "تقرير العقوبات والتغييب";
  sheet.getCell("A2").value =
    `الشهر: ${filters.month}   |   التصنيف: ${filters.type}   |   البحث: ${filters.search || "الكل"}`;
  sheet.getCell("A1").font = { name: "Arial", size: 18, bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF15304B" } };
  sheet.getCell("A1").alignment = { horizontal: "right", vertical: "middle", indent: 1 };
  sheet.getRow(1).height = 36;
  sheet.getCell("A2").alignment = { horizontal: "right", vertical: "middle", wrapText: true };
  sheet.getRow(2).height = 30;
  sheet.getRow(3).values = [
    "عدد السجلات",
    rows.length,
    "إجمالي الاستقطاعات",
    rows.reduce((sum, row) => sum + row.amount, 0),
  ];
  sheet.getRow(3).font = { name: "Arial", bold: true, color: { argb: "FF15304B" } };
  sheet.getRow(3).height = 22;

  const currencyFormat = '#,##0.## "د.ع"';
  sheet.getCell("D3").numFmt = currencyFormat;
  const header = sheet.getRow(5);
  header.values = ["الموظف", "نوع العقوبة", "التاريخ", "الاستقطاع", "حالة التنفيذ", "الملاحظات"];
  header.height = 26;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF116B70" } };
    cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { horizontal: "right", vertical: "middle" };
  });

  rows.forEach((record, index) => {
    const row = sheet.addRow([
      record.employee,
      record.type,
      new Date(`${record.date}T00:00:00Z`),
      record.amount,
      record.status,
      record.notes ?? "",
    ]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: "Arial", color: { argb: "FF183049" } };
      cell.alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      if (index % 2 === 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFF5F8" } };
      }
    });
    row.getCell(3).numFmt = "yyyy-mm-dd";
    row.getCell(4).numFmt = currencyFormat;
  });
  sheet.autoFilter = `A5:F${sheet.rowCount}`;

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `العقوبات-${filters.month}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
