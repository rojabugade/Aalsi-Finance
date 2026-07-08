const SPREADSHEET_EXT = /\.(csv|xlsx)$/i;
const SPREADSHEET_MIME = new Set([
  "text/csv", "application/csv", "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

/** Decide whether a dropped/picked file goes to the document pipeline or the mapping wizard. */
export function classifyFile(file: File): "doc" | "spreadsheet" {
  if (SPREADSHEET_MIME.has(file.type) || SPREADSHEET_EXT.test(file.name)) return "spreadsheet";
  return "doc";
}
