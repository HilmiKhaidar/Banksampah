import { unzipSync, strFromU8 } from "fflate";

export type StudentImportRow = {
  name: string;
  identifier: string;
  className: string | null;
};

const spreadsheetNamespace =
  "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const relationshipNamespace =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

function parseCsv(text: string) {
  const rows: string[][] = [];
  const headerLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = headerLine.split(";").length > headerLine.split(",").length ? ";" : ",";
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === delimiter) {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("File CSV memiliki tanda kutip yang tidak berpasangan.");
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function parseXml(text: string, label: string) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) {
    throw new Error(`Struktur ${label} tidak valid.`);
  }
  return document;
}

function normalizeArchivePath(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function parseXlsx(bytes: Uint8Array) {
  let archive: Record<string, Uint8Array>;
  let totalExpandedBytes = 0;
  let archiveFileCount = 0;
  let archiveTooLarge = false;
  try {
    archive = unzipSync(bytes, {
      filter: (file) => {
        archiveFileCount += 1;
        totalExpandedBytes += file.originalSize;
        if (file.originalSize > 8 * 1024 * 1024 || totalExpandedBytes > 15 * 1024 * 1024 || archiveFileCount > 2000) {
          archiveTooLarge = true;
          return false;
        }
        return /^xl\/(?:workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(file.name);
      },
    });
  } catch {
    throw new Error("File Excel tidak dapat dibaca. Pastikan formatnya .xlsx yang valid.");
  }
  if (archiveTooLarge) throw new Error("Isi file Excel terlalu besar atau terlalu kompleks.");
  const getText = (path: string) => {
    const file = archive[path];
    if (!file) throw new Error(`File Excel tidak lengkap (${path}).`);
    return strFromU8(file);
  };

  const workbook = parseXml(getText("xl/workbook.xml"), "workbook");
  const firstSheet = workbook.getElementsByTagNameNS(spreadsheetNamespace, "sheet")[0];
  const relationshipId = firstSheet?.getAttributeNS(relationshipNamespace, "id");
  if (!relationshipId) throw new Error("Workbook Excel tidak memiliki lembar kerja.");

  const relationships = parseXml(getText("xl/_rels/workbook.xml.rels"), "relasi workbook");
  const sheetRelationship = [...relationships.getElementsByTagName("*")]
    .filter((relationship) => relationship.localName === "Relationship")
    .find((relationship) => relationship.getAttribute("Id") === relationshipId);
  const target = sheetRelationship?.getAttribute("Target");
  if (!target) throw new Error("Lembar pertama workbook tidak ditemukan.");
  const sheetPath = normalizeArchivePath(
    target.startsWith("/") ? target : `xl/${target}`,
  );
  const sheet = parseXml(getText(sheetPath), "lembar kerja");

  const sharedStringsPath = "xl/sharedStrings.xml";
  const sharedStrings = archive[sharedStringsPath]
    ? [...parseXml(getText(sharedStringsPath), "shared strings")
      .getElementsByTagNameNS(spreadsheetNamespace, "si")]
      .map((item) =>
        [...item.getElementsByTagNameNS(spreadsheetNamespace, "t")]
          .map((part) => part.textContent ?? "")
          .join(""),
      )
    : [];

  return [...sheet.getElementsByTagNameNS(spreadsheetNamespace, "row")].map((sheetRow) => {
    const cells: string[] = [];
    for (const cell of [...sheetRow.getElementsByTagNameNS(spreadsheetNamespace, "c")]) {
      const reference = cell.getAttribute("r") ?? "";
      const columnLabel = reference.match(/^[A-Z]+/)?.[0];
      if (!columnLabel) continue;
      let columnIndex = 0;
      for (const letter of columnLabel) {
        columnIndex = columnIndex * 26 + letter.charCodeAt(0) - 64;
      }
      const cellType = cell.getAttribute("t");
      const valueNode = cell.getElementsByTagNameNS(spreadsheetNamespace, "v")[0];
      const value = cellType === "inlineStr"
        ? [...cell.getElementsByTagNameNS(spreadsheetNamespace, "t")]
          .map((part) => part.textContent ?? "")
          .join("")
        : valueNode?.textContent ?? "";
      cells[columnIndex - 1] = cellType === "s"
        ? sharedStrings[Number(value)] ?? ""
        : value;
    }
    return cells;
  }).filter((row) => row.some((value) => value?.trim()));
}

function mapStudentRows(rows: string[][]): StudentImportRow[] {
  const headers = rows[0]?.map((header) =>
    header.replace(/^\uFEFF/, "").trim().toLocaleLowerCase("id-ID"),
  ) ?? [];
  const identifierIndex = headers.findIndex((header) =>
    ["nisn", "nis", "nomor induk siswa nasional"].includes(header),
  );
  const nameIndex = headers.findIndex((header) => ["nama", "nama siswa", "nama lengkap"].includes(header));
  const classIndex = headers.findIndex((header) => ["kelas", "rombel"].includes(header));

  if (identifierIndex < 0 || nameIndex < 0) {
    throw new Error("Kolom wajib tidak ditemukan. Gunakan judul kolom NISN dan Nama; Kelas bersifat opsional.");
  }

  const students = rows.slice(1).map((row, index) => {
    const identifier = String(row[identifierIndex] ?? "").trim();
    const name = String(row[nameIndex] ?? "").trim();
    const className = classIndex < 0 ? "" : String(row[classIndex] ?? "").trim();
    if (!identifier || !name) {
      throw new Error(`NISN dan nama wajib diisi pada baris ${index + 2}.`);
    }
    return { identifier, name, className: className || null };
  });
  if (students.length === 0) throw new Error("File tidak berisi data siswa.");
  if (students.length > 500) throw new Error("Maksimal 500 siswa untuk satu kali impor.");
  const identifiers = new Set<string>();
  for (const student of students) {
    const key = student.identifier.toLocaleLowerCase("id-ID");
    if (identifiers.has(key)) throw new Error(`NISN ${student.identifier} tercantum lebih dari sekali.`);
    identifiers.add(key);
  }
  return students;
}

export async function parseStudentImportFile(file: File): Promise<StudentImportRow[]> {
  if (file.size > 5 * 1024 * 1024) throw new Error("Ukuran file maksimal 5 MB.");
  const extension = file.name.split(".").pop()?.toLocaleLowerCase("en-US");
  const rows = extension === "csv"
    ? parseCsv(await file.text())
    : extension === "xlsx"
      ? parseXlsx(new Uint8Array(await file.arrayBuffer()))
      : null;
  if (!rows) throw new Error("Gunakan file CSV atau Excel .xlsx.");
  return mapStudentRows(rows);
}
