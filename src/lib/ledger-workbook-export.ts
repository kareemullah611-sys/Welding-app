import ExcelJS from "exceljs";

export async function buildWorkbookBlob(sheets: Array<{ name: string; rows: unknown[][] }>) {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRows(sheet.rows.map((row) => row.map((value) => value ?? "")));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
