function timestampForFilename(date: Date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function sanitizeFilenamePart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadStixJson(baseName: string, payload: unknown) {
  const safeBase = sanitizeFilenamePart(baseName) || "stix-export";
  const filename = `${safeBase}-${timestampForFilename()}.json`;
  const content = JSON.stringify(payload, null, 2);
  triggerFileDownload(filename, content, "application/json;charset=utf-8");
}

export function downloadStixMarkdown(baseName: string, markdown: string) {
  const safeBase = sanitizeFilenamePart(baseName) || "stix-export";
  const filename = `${safeBase}-${timestampForFilename()}.md`;
  triggerFileDownload(filename, markdown, "text/markdown;charset=utf-8");
}

function toMarkdownCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, "<br/>");
}

export function toMarkdownTable(headers: string[], rows: unknown[][]): string {
  if (!headers.length) return "";
  const headerLine = `| ${headers.map(toMarkdownCell).join(" | ")} |`;
  const separatorLine = `| ${headers.map(() => "---").join(" | ")} |`;
  const rowLines = rows.map((row) => `| ${row.map(toMarkdownCell).join(" | ")} |`);
  return [headerLine, separatorLine, ...rowLines].join("\n");
}
