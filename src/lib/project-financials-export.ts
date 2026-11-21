import type { calculateProjectFinancials } from "@/lib/project-financials";
import { calculateSiteMaterialCosts, type MaterialIssueRow } from "@/lib/site-material-costs";

export async function downloadProjectFinancials(
  scope: {
    site: string;
    ctr: string;
    start: string | null;
    end: string;
    syncedAt: string;
    unpriced: number;
  },
  financials: ReturnType<typeof calculateProjectFinancials>,
  issues: MaterialIssueRow[],
) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const currency = '#,##0.00 "د.ع"';
  const title = `${scope.ctr} | ${scope.site} | ${scope.start ?? "من بداية الصرف"} إلى ${scope.end}`;

  const addSheet = (name: string, headers: string[], widths: number[]) => {
    const sheet = workbook.addWorksheet(name, {
      views: [{ rightToLeft: true, state: "frozen", ySplit: 3, showGridLines: false }],
      pageSetup: {
        orientation: "landscape",
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "1:3",
      },
    });
    sheet.columns = widths.map((width) => ({
      width,
      style: { alignment: { horizontal: "right", vertical: "middle", wrapText: true } },
    }));
    sheet.mergeCells(1, 1, 1, headers.length);
    sheet.getCell("A1").value = title;
    sheet.getRow(1).height = 30;
    sheet.addRow([]);
    const header = sheet.addRow(headers);
    header.height = 25;
    for (const row of [sheet.getRow(1), header]) {
      row.eachCell((cell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF116B70" } };
        cell.font = { name: "Arial", bold: true, color: { argb: "FFFFFFFF" } };
      });
    }
    return sheet;
  };

  const summary = addSheet("الملخص", ["البند المالي", "القيمة"], [62, 32]);
  const asAmount = (name: string, value: number | null) => {
    summary.addRow([name, value ?? "غير محدد"]).getCell(2).numFmt = currency;
  };
  asAmount("موازنة العقد", financials.budget);
  asAmount("عمالة الفترة المعتمدة", financials.labor);
  asAmount("مواد الفترة المسعّرة", financials.material);
  asAmount("تكلفة الفترة", financials.actual);
  asAmount("التكلفة التراكمية حتى تاريخ النهاية", financials.cumulativeActual);
  asAmount("الفرق عن موازنة العقد", financials.varianceAmount);
  summary
    .addRow([
      "نسبة الانحراف التراكمي",
      financials.variancePercent === null ? "غير محدد" : financials.variancePercent / 100,
    ])
    .getCell(2).numFmt = "0.00%";
  summary.addRow(["حركات المواد غير المسعّرة حتى تاريخ النهاية", scope.unpriced]);
  summary.addRow([
    "وقت مزامنة الملخص بتوقيت بغداد",
    new Intl.DateTimeFormat("ar-IQ", {
      dateStyle: "short",
      timeStyle: "medium",
      timeZone: "Asia/Baghdad",
    }).format(new Date(scope.syncedAt)),
  ]);

  const crew = addSheet(
    "البصمة المعتمدة",
    ["التخصص", "أيام عمل الأفراد", "الأجر اليومي", "الإجمالي"],
    [32, 26, 24, 24],
  );
  for (const item of financials.crew) {
    const row = crew.addRow([item.name, item.count, item.dailyRate, item.cost]);
    row.getCell(3).numFmt = currency;
    row.getCell(4).numFmt = currency;
  }
  const materials = addSheet(
    "صرف المواد",
    [
      "التاريخ",
      "المادة",
      "الكود",
      "الوحدة",
      "الكمية",
      "كلفة الوحدة",
      "الإجمالي",
      "المخزن",
      "الملاحظات",
    ],
    [16, 27, 16, 12, 12, 21, 22, 24, 38],
  );
  for (const item of calculateSiteMaterialCosts(issues).items) {
    const row = materials.addRow([
      item.movement_date,
      item.item_name,
      item.item_code,
      item.unit,
      item.quantity,
      item.unit_cost ?? "غير مسعّر",
      item.cost,
      item.warehouse_name,
      item.notes,
    ]);
    row.getCell(6).numFmt = currency;
    row.getCell(7).numFmt = currency;
  }
  materials.autoFilter = "A3:I" + materials.rowCount;
  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(buffer)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `تكلفة-${scope.ctr.replace(/[^\p{L}\p{N}-]/gu, "-")}-${scope.end}.xlsx`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
