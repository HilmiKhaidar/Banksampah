import { randomUUID } from "node:crypto";
import { Router } from "express";
import { pool } from "../config/database.js";
import { requireAuth } from "../middleware/require-auth.js";

const router = Router();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireManager(request, response, next) {
  if (request.account.role !== "manager") {
    response.status(403).json({
      error: { code: "FORBIDDEN", message: "Akses ini hanya tersedia untuk pengelola." },
    });
    return;
  }
  next();
}

function requireObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_REQUEST", "Isi request tidak valid.");
  }
}

function readText(value, field, maxLength, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_REQUEST", `${field} wajib berupa teks.`);
  }
  const normalized = value.trim();
  if ((!optional && !normalized) || normalized.length > maxLength) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} tidak valid atau melebihi ${maxLength} karakter.`);
  }
  return normalized;
}

function readImage(value, field = "Foto") {
  if (value === null || value === undefined || value === "") {
    return { url: null, type: null, data: null };
  }
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_IMAGE", `${field} tidak valid.`);
  }
  if (!value.startsWith("data:")) {
    if (value.length > 500) {
      throw new ApiError(400, "INVALID_IMAGE_URL", `${field} berupa URL maksimal 500 karakter.`);
    }
    let parsedUrl;
    try {
      parsedUrl = new URL(value);
    } catch {
      throw new ApiError(400, "INVALID_IMAGE_URL", `${field} harus berupa URL gambar yang valid.`);
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new ApiError(400, "INVALID_IMAGE_URL", `${field} harus menggunakan HTTP atau HTTPS.`);
    }
    return { url: value, type: null, data: null };
  }
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new ApiError(400, "INVALID_IMAGE", `${field} harus berupa gambar JPEG, PNG, atau WebP.`);
  }
  const data = Buffer.from(match[2], "base64");
  if (data.length === 0 || data.length > 450 * 1024 || data.toString("base64") !== match[2]) {
    throw new ApiError(400, "IMAGE_SIZE_INVALID", `${field} maksimal berukuran 450 KB.`);
  }
  return { url: null, type: match[1], data };
}

function readInteger(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} harus berupa bilangan bulat antara ${min} dan ${max}.`);
  }
  return parsed;
}

function readQuantity(value, unit) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    parsed > 100_000
  ) {
    throw new ApiError(400, "INVALID_QUANTITY", `Jumlah ${unit} harus lebih dari 0 dan maksimal 100.000.`);
  }
  if (Math.abs(parsed * 1000 - Math.round(parsed * 1000)) > 0.000001) {
    throw new ApiError(400, "INVALID_QUANTITY_PRECISION", `Jumlah ${unit} maksimal tiga angka desimal.`);
  }
  return parsed;
}

function calculateAmount(quantity, rate) {
  const scaledQuantity = BigInt(Math.round(quantity * 1000));
  const amount = (scaledQuantity * BigInt(rate) + 500n) / 1000n;
  if (amount < 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(amount);
}

function toSafeNumber(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ApiError(422, "VALUE_OUT_OF_RANGE", `${field} melebihi batas angka yang didukung.`);
  }
  return parsed;
}

function mapWasteType(row) {
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    pricePerUnit: row.pricePerUnit === null ? 0 : toSafeNumber(row.pricePerUnit, "Tarif rupiah"),
    icon: row.icon ?? "♻️",
    image: row.imageUrl ?? (row.hasImageBlob ? `/api/business/waste-types/${row.id}/image` : null),
    active: Boolean(row.active) && row.unit !== "buah",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapDeposit(row, lines) {
  return {
    id: row.id,
    studentId: row.studentId,
    status: ({
      menunggu: "pending",
      disetujui: "approved",
      ditolak: "rejected",
      dibatalkan: "cancelled",
    })[row.status],
    note: row.note,
    createdAt: row.createdAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    photos: [],
    lines: lines.map((line) => ({
      wasteTypeId: line.wasteTypeId,
      wasteTypeName: line.wasteTypeName,
      unit: line.unit,
      quantity: line.quantity === null ? null : Number(line.quantity),
      pricePerUnit: line.pricePerUnit === null ? null : toSafeNumber(line.pricePerUnit, "Tarif rupiah"),
      amount: line.amount === null ? null : toSafeNumber(line.amount, "Nominal setoran"),
    })),
  };
}

function mapWithdrawal(row) {
  return {
    id: row.id,
    studentId: row.studentId,
    amount: toSafeNumber(row.amount, "Nominal pencairan"),
    destinationType: row.destinationType === "dompet_digital" ? "ewallet" : "bank",
    institution: row.institution,
    accountName: row.accountName,
    accountNumber: row.accountNumber,
    status: ({
      menunggu: "pending",
      diproses: "processing",
      dibayar: "paid",
      ditolak: "rejected",
      dibatalkan: "cancelled",
    })[row.status],
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedAt: row.reviewedAt,
    reviewedBy: row.reviewedBy,
    paidAt: row.paidAt,
    paidBy: row.paidBy,
  };
}

const wasteSelect = `SELECT
  id,
  nama AS name,
  satuan AS unit,
  harga_per_satuan_arsip AS pricePerUnit,
  ikon AS icon,
  url_gambar AS imageUrl,
  tipe_gambar AS imageType,
  (data_gambar IS NOT NULL) AS hasImageBlob,
  aktif AS active,
  dibuat_pada AS createdAt,
  diperbarui_pada AS updatedAt
FROM jenis_sampah`;

const depositSelect = `SELECT
  id,
  peserta_id AS studentId,
  status,
  catatan AS note,
  ditinjau_oleh AS reviewedBy,
  ditinjau_pada AS reviewedAt,
  dibuat_pada AS createdAt
FROM pengajuan_setoran`;

const withdrawalSelect = `SELECT
  id,
  peserta_id AS studentId,
  nominal AS amount,
  jenis_tujuan AS destinationType,
  lembaga AS institution,
  nama_pemilik_rekening AS accountName,
  nomor_rekening AS accountNumber,
  status,
  catatan AS note,
  ditinjau_oleh AS reviewedBy,
  ditinjau_pada AS reviewedAt,
  dibayar_oleh AS paidBy,
  dibayar_pada AS paidAt,
  dibuat_pada AS createdAt,
  diperbarui_pada AS updatedAt
FROM arsip_pengajuan_pencairan`;

async function loadDeposits(connection, account) {
  const manager = account.role === "manager";
  const [rows] = manager
    ? await connection.query(`${depositSelect} ORDER BY dibuat_pada DESC, id`)
    : await connection.execute(`${depositSelect} WHERE peserta_id = ? ORDER BY dibuat_pada DESC, id`, [account.id]);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const placeholders = ids.map(() => "?").join(", ");
  const [lineRows] = await connection.execute(
    `SELECT
      rincian_setoran.setoran_id AS depositId,
      rincian_setoran.jenis_sampah_id AS wasteTypeId,
      rincian_setoran.nama_jenis_sampah AS wasteTypeName,
      rincian_setoran.satuan AS unit,
      NULLIF(rincian_setoran.jumlah, 0) AS quantity,
      rincian_setoran.harga_per_satuan_arsip AS pricePerUnit,
      rincian_setoran.nominal_arsip AS amount
    FROM rincian_setoran
    WHERE rincian_setoran.setoran_id IN (${placeholders})
    ORDER BY rincian_setoran.id`,
    ids,
  );
  const [photoRows] = await connection.execute(
    `SELECT setoran_id AS depositId, COUNT(*) AS photoCount
     FROM foto_setoran WHERE setoran_id IN (${placeholders})
     GROUP BY setoran_id`,
    ids,
  );
  const photoCounts = new Map(photoRows.map((row) => [row.depositId, Number(row.photoCount)]));
  const linesByDeposit = new Map();
  for (const line of lineRows) {
    if (!linesByDeposit.has(line.depositId)) linesByDeposit.set(line.depositId, []);
    linesByDeposit.get(line.depositId).push(line);
  }
  return rows.map((row) => ({
    ...mapDeposit(row, linesByDeposit.get(row.id) ?? []),
    photoCount: photoCounts.get(row.id) ?? 0,
  }));
}

async function loadWalletEntries(connection, account) {
  const manager = account.role === "manager";
  const [rows] = manager
    ? await connection.query(
      `SELECT id, peserta_id AS studentId, jenis AS kind, nominal AS amount,
        keterangan AS description, referensi AS reference, setoran_id AS depositId,
        dibuat_pada AS createdAt, dibuat_oleh AS createdBy
       FROM arsip_transaksi_saldo ORDER BY dibuat_pada DESC, id`,
    )
    : await connection.execute(
      `SELECT id, peserta_id AS studentId, jenis AS kind, nominal AS amount,
        keterangan AS description, referensi AS reference, setoran_id AS depositId,
        dibuat_pada AS createdAt, dibuat_oleh AS createdBy
       FROM arsip_transaksi_saldo WHERE peserta_id = ? ORDER BY dibuat_pada DESC, id`,
      [account.id],
    );
  return rows.map((row) => ({
    ...row,
    kind: ({
      setoran: "deposit",
      penyesuaian: "adjustment",
      pencairan: "withdrawal",
      penukaran: "adjustment",
    })[row.kind],
    amount: toSafeNumber(row.amount, "Nominal saldo"),
  }));
}

async function loadWithdrawals(connection, account) {
  const [rows] = account.role === "manager"
    ? await connection.query(`${withdrawalSelect} ORDER BY dibuat_pada DESC, id`)
    : await connection.execute(
      `${withdrawalSelect} WHERE peserta_id = ? ORDER BY dibuat_pada DESC, id`,
      [account.id],
    );
  return rows.map(mapWithdrawal);
}

async function loadPreferences(connection, account) {
  const [rows] = await connection.execute(
    `SELECT
      akun.notifikasi_dalam_aplikasi AS inAppNotifications,
      (SELECT pengelola.whatsapp FROM akun AS pengelola
       WHERE pengelola.peran = 'pengelola' AND pengelola.aktif = TRUE
       ORDER BY pengelola.dibuat_pada, pengelola.id LIMIT 1) AS managerWhatsapp
     FROM akun
     WHERE akun.id = ?`,
    [account.id],
  );
  if (rows.length === 0) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Akun tidak ditemukan.");
  return {
    inAppNotifications: Boolean(rows[0].inAppNotifications),
    managerWhatsapp: rows[0].managerWhatsapp ?? "",
  };
}

async function loadBusinessData(connection, account) {
  const preferences = await loadPreferences(connection, account);
  const [wasteRows] = await connection.query(`${wasteSelect} ORDER BY nama, id`);
  return {
    wasteTypes: wasteRows.map(mapWasteType),
    deposits: await loadDeposits(connection, account),
    walletEntries: await loadWalletEntries(connection, account),
    withdrawalRequests: await loadWithdrawals(connection, account),
    notifications: preferences.inAppNotifications ? await loadNotifications(connection, account) : [],
    preferences,
  };
}

async function loadNotifications(connection, account) {
  const [rows] = await connection.execute(
    `SELECT id, penerima_id AS recipientId, judul AS title, pesan AS message,
      jenis AS kind, id_terkait AS relatedId, dibaca_pada AS readAt, dibuat_pada AS createdAt
     FROM notifikasi
     WHERE penerima_id = ? AND jenis IN ('setoran', 'saldo', 'sistem')
     ORDER BY dibuat_pada DESC, id LIMIT 100`,
    [account.id],
  );
  return rows.map((row) => ({
    ...row,
    kind: ({ setoran: "deposit", saldo: "wallet", sistem: "system" })[row.kind],
  }));
}

router.use(requireAuth);

router.get("/data", async (request, response, next) => {
  try {
    const connection = await pool.getConnection();
    try {
      response.json(await loadBusinessData(connection, request.account));
    } finally {
      connection.release();
    }
  } catch (error) {
    next(error);
  }
});

router.get("/deposits/:depositId/photos", async (request, response, next) => {
  try {
    const [deposits] = request.account.role === "manager"
      ? await pool.execute("SELECT id FROM pengajuan_setoran WHERE id = ?", [request.params.depositId])
      : await pool.execute(
        "SELECT id FROM pengajuan_setoran WHERE id = ? AND peserta_id = ?",
        [request.params.depositId, request.account.id],
      );
    if (deposits.length === 0) {
      throw new ApiError(404, "DEPOSIT_NOT_FOUND", "Pengajuan setoran tidak ditemukan.");
    }
    const [rows] = await pool.execute(
      `SELECT url_gambar AS imageUrl, tipe_konten AS contentType, data_gambar AS imageData
       FROM foto_setoran WHERE setoran_id = ? ORDER BY id`,
      [request.params.depositId],
    );
    response.json({
      photos: rows.map((row) =>
        row.imageData
          ? `data:${row.contentType};base64,${Buffer.from(row.imageData).toString("base64")}`
          : row.imageUrl,
      ).filter(Boolean),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/waste-types/:id/image", async (request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT tipe_gambar AS contentType, data_gambar AS imageData
       FROM jenis_sampah WHERE id = ?`,
      [request.params.id],
    );
    if (!rows[0]?.imageData) {
      throw new ApiError(404, "WASTE_IMAGE_NOT_FOUND", "Foto jenis sampah tidak ditemukan.");
    }
    response
      .set("Content-Type", rows[0].contentType)
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(rows[0].imageData);
  } catch (error) {
    next(error);
  }
});

router.post("/waste-types", requireManager, async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const name = readText(request.body.name, "Nama jenis sampah", 80);
    const unit = request.body.unit;
    if (!["kg", "liter"].includes(unit)) {
      throw new ApiError(400, "INVALID_UNIT", "Pilih satuan kg atau liter.");
    }
    const pricePerUnit = readInteger(request.body.pricePerUnit, "Tarif rupiah", { min: 1 });
    const icon = readText(request.body.icon ?? "♻️", "Ikon", 24);
    const image = readImage(request.body.image, "Gambar jenis sampah");
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO jenis_sampah
        (id, nama, satuan, harga_per_satuan_arsip, ikon, url_gambar, tipe_gambar, data_gambar, dibuat_oleh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, unit, pricePerUnit, icon, image.url, image.type, image.data, request.account.id],
    );
    const [rows] = await pool.execute(`${wasteSelect} WHERE id = ?`, [id]);
    response.status(201).json({ wasteType: mapWasteType(rows[0]) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      next(new ApiError(409, "WASTE_TYPE_EXISTS", "Jenis sampah dengan nama yang sama sudah ada."));
      return;
    }
    next(error);
  }
});

router.patch("/waste-types/:id", requireManager, async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const name = readText(request.body.name, "Nama jenis sampah", 80);
    const unit = request.body.unit;
    if (!["kg", "liter"].includes(unit)) {
      throw new ApiError(400, "INVALID_UNIT", "Pilih satuan kg atau liter.");
    }
    const pricePerUnit = readInteger(request.body.pricePerUnit, "Tarif rupiah", { min: 1 });
    const icon = readText(request.body.icon ?? "♻️", "Ikon", 24);
    const image = readImage(request.body.image, "Gambar jenis sampah");
    if (typeof request.body.active !== "boolean") {
      throw new ApiError(400, "INVALID_ACTIVE", "Status jenis sampah tidak valid.");
    }
    await pool.execute(
      `UPDATE jenis_sampah
       SET nama = ?, satuan = ?, harga_per_satuan_arsip = ?, ikon = ?, url_gambar = ?,
         tipe_gambar = ?, data_gambar = ?, aktif = ?
       WHERE id = ?`,
      [name, unit, pricePerUnit, icon, image.url, image.type, image.data, request.body.active, request.params.id],
    );
    const [rows] = await pool.execute(`${wasteSelect} WHERE id = ?`, [request.params.id]);
    if (rows.length === 0) {
      throw new ApiError(404, "WASTE_TYPE_NOT_FOUND", "Jenis sampah tidak ditemukan.");
    }
    response.json({ wasteType: mapWasteType(rows[0]) });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      next(new ApiError(409, "WASTE_TYPE_EXISTS", "Jenis sampah dengan nama yang sama sudah ada."));
      return;
    }
    next(error);
  }
});

router.post("/deposits", async (request, response, next) => {
  let connection;
  try {
    requireObjectBody(request.body);
    if (!Array.isArray(request.body.wasteTypeIds) || request.body.wasteTypeIds.length > 20) {
      throw new ApiError(400, "INVALID_WASTE_TYPES", "Pilih maksimal 20 jenis sampah.");
    }
    const otherWasteDescription = request.body.wasteTypeIds.length === 0
      ? readText(request.body.otherWasteDescription, "Deskripsi jenis sampah", 120)
      : "";
    if (request.body.wasteTypeIds.length > 0 && request.body.otherWasteDescription !== undefined) {
      throw new ApiError(400, "INVALID_WASTE_TYPES", "Deskripsi jenis lain hanya boleh diisi jika tidak memilih jenis katalog.");
    }
    const inputPhotos = request.body.photos ?? [];
    if (!Array.isArray(inputPhotos) || inputPhotos.length > 5) {
      throw new ApiError(400, "INVALID_PHOTOS", "Maksimal 5 foto dapat disertakan.");
    }
    let totalPhotoBytes = 0;
    const photos = inputPhotos.map((photo, index) => {
      requireObjectBody(photo);
      const image = readImage(photo.dataUrl, `Foto ${index + 1}`);
      if (!image.data) {
        throw new ApiError(400, "INVALID_PHOTO_DATA", `Foto ${index + 1} harus diunggah sebagai gambar.`);
      }
      totalPhotoBytes += image.data.length;
      if (totalPhotoBytes > 1_250_000) {
        throw new ApiError(400, "TOTAL_PHOTO_SIZE_EXCEEDED", "Total ukuran foto maksimal 1,25 MB.");
      }
      const originalName = readText(photo.name, `Nama foto ${index + 1}`, 255);
      const fileName = originalName.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255);
      return { ...image, fileName: fileName || `foto-${index + 1}.jpg` };
    });
    const wasteTypeIds = [...new Set(request.body.wasteTypeIds)];
    if (wasteTypeIds.some((id) => typeof id !== "string" || id.length > 36)) {
      throw new ApiError(400, "INVALID_WASTE_TYPES", "Daftar jenis sampah tidak valid.");
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [types] = wasteTypeIds.length > 0
      ? await connection.execute(
        `SELECT id, nama, satuan FROM jenis_sampah
         WHERE id IN (${wasteTypeIds.map(() => "?").join(", ")}) AND aktif = TRUE FOR SHARE`,
        wasteTypeIds,
      )
      : [[]];
    if (types.length !== wasteTypeIds.length) {
      throw new ApiError(409, "WASTE_TYPE_UNAVAILABLE", "Ada jenis sampah yang sudah tidak tersedia.");
    }
    const depositId = randomUUID();
    await connection.execute(
      "INSERT INTO pengajuan_setoran (id, peserta_id) VALUES (?, ?)",
      [depositId, request.account.id],
    );
    for (const type of types) {
      await connection.execute(
        `INSERT INTO rincian_setoran
          (setoran_id, jenis_sampah_id, nama_jenis_sampah, satuan, jumlah)
         VALUES (?, ?, ?, ?, 0)`,
        [depositId, type.id, type.nama, type.satuan],
      );
    }
    if (otherWasteDescription) {
      await connection.execute(
        `INSERT INTO rincian_setoran
          (setoran_id, jenis_sampah_id, nama_jenis_sampah, satuan, jumlah)
         VALUES (?, NULL, ?, 'kg', 0)`,
        [depositId, otherWasteDescription],
      );
    }
    for (const photo of photos) {
      await connection.execute(
        `INSERT INTO foto_setoran
          (setoran_id, nama_berkas, tipe_konten, data_gambar)
         VALUES (?, ?, ?, ?)`,
        [depositId, photo.fileName, photo.type, photo.data],
      );
    }
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       SELECT UUID(), id, 'Pengajuan setoran baru', ?, 'setoran', ?
       FROM akun WHERE peran = 'pengelola' AND aktif = TRUE`,
      [`${request.account.name} mengajukan setoran baru.`, depositId],
    );
    await connection.commit();
    const [rows] = await pool.execute(`${depositSelect} WHERE id = ?`, [depositId]);
    const [lineRows] = await pool.execute(
      `SELECT jenis_sampah_id AS wasteTypeId, nama_jenis_sampah AS wasteTypeName,
        satuan AS unit, NULLIF(jumlah, 0) AS quantity,
        harga_per_satuan_arsip AS pricePerUnit, nominal_arsip AS amount
       FROM rincian_setoran WHERE setoran_id = ? ORDER BY id`,
      [depositId],
    );
    response.status(201).json({ deposit: mapDeposit(rows[0], lineRows) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post("/deposits/direct", requireManager, async (request, response, next) => {
  let connection;
  try {
    requireObjectBody(request.body);
    const studentId = readText(request.body.studentId, "ID siswa", 36);
    const wasteTypeId = readText(request.body.wasteTypeId, "Jenis sampah", 36);
    const quantity = readQuantity(request.body.quantity, "kg");
    const note = readText(request.body.note ?? "", "Catatan", 500, { optional: true });
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [students] = await connection.execute(
      "SELECT id FROM akun WHERE id = ? AND peran = 'peserta' AND aktif = TRUE FOR SHARE",
      [studentId],
    );
    if (students.length === 0) {
      throw new ApiError(404, "STUDENT_NOT_FOUND", "Siswa aktif tidak ditemukan.");
    }
    const [types] = await connection.execute(
      `SELECT id, nama AS wasteName, satuan AS unit, harga_per_satuan_arsip AS pricePerUnit
       FROM jenis_sampah WHERE id = ? AND aktif = TRUE FOR SHARE`,
      [wasteTypeId],
    );
    const type = types[0];
    if (!type || type.unit !== "kg") {
      throw new ApiError(409, "WASTE_TYPE_UNAVAILABLE", "Jenis sampah aktif dengan satuan kg tidak ditemukan.");
    }
    const rate = toSafeNumber(type.pricePerUnit, "Tarif rupiah");
    if (rate <= 0) throw new ApiError(409, "PRICE_UNSET", "Tarif rupiah jenis sampah belum diatur.");
    const amount = calculateAmount(quantity, rate);
    if (amount === null || amount < 1) {
      throw new ApiError(400, "AMOUNT_TOO_LOW", "Nominal setoran harus minimal Rp1.");
    }
    const depositId = randomUUID();
    await connection.execute(
      `INSERT INTO pengajuan_setoran
        (id, peserta_id, status, catatan, ditinjau_oleh, ditinjau_pada)
       VALUES (?, ?, 'disetujui', ?, ?, CURRENT_TIMESTAMP(3))`,
      [depositId, studentId, note, request.account.id],
    );
    await connection.execute(
      `INSERT INTO rincian_setoran
        (setoran_id, jenis_sampah_id, nama_jenis_sampah, satuan, jumlah, harga_per_satuan_arsip, nominal_arsip)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [depositId, type.id, type.wasteName, type.unit, quantity, rate, amount],
    );
    await connection.execute(
      `INSERT INTO arsip_transaksi_saldo
        (id, peserta_id, jenis, nominal, keterangan, setoran_id, dibuat_oleh)
       VALUES (?, ?, 'setoran', ?, ?, ?, ?)`,
      [randomUUID(), studentId, amount, `Setoran dicatat pengelola${note ? ` — ${note}` : ""}`, depositId, request.account.id],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       VALUES (?, ?, 'Setoran berhasil dicatat', ?, 'saldo', ?)`,
      [randomUUID(), studentId, `Setoran ${quantity} kg ${type.wasteName} menambah saldo ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount)}.`, depositId],
    );
    await connection.commit();
    response.status(201).json({ depositId, amount });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post("/deposits/:id/cancel", async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      `UPDATE pengajuan_setoran
       SET status = 'dibatalkan'
       WHERE id = ? AND peserta_id = ? AND status = 'menunggu'`,
      [request.params.id, request.account.id],
    );
    if (result.affectedRows === 0) {
      throw new ApiError(409, "DEPOSIT_NOT_CANCELLABLE", "Setoran tidak ditemukan atau sudah diproses.");
    }
    response.json({ message: "Pengajuan setoran dibatalkan." });
  } catch (error) {
    next(error);
  }
});

router.post("/deposits/:id/review", requireManager, async (request, response, next) => {
  let connection;
  try {
    requireObjectBody(request.body);
    const decision = request.body.decision;
    const note = readText(request.body.note ?? "", "Catatan", 500, { optional: true });
    if (decision !== "approve" && decision !== "reject") {
      throw new ApiError(400, "INVALID_DECISION", "Keputusan harus approve atau reject.");
    }
    if (decision === "reject" && !note) {
      throw new ApiError(400, "REJECTION_NOTE_REQUIRED", "Alasan penolakan wajib diisi.");
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [deposits] = await connection.execute(
      `SELECT id, peserta_id AS studentId, status FROM pengajuan_setoran
       WHERE id = ? FOR UPDATE`,
      [request.params.id],
    );
    const deposit = deposits[0];
    if (!deposit || deposit.status !== "menunggu") {
      throw new ApiError(409, "DEPOSIT_ALREADY_REVIEWED", "Pengajuan tidak ditemukan atau sudah diproses.");
    }
    if (decision === "reject") {
      await connection.execute(
        `UPDATE pengajuan_setoran
         SET status = 'ditolak', catatan = ?, ditinjau_oleh = ?, ditinjau_pada = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [note, request.account.id, deposit.id],
      );
      await connection.execute(
        `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
         VALUES (?, ?, 'Setoran ditolak', ?, 'setoran', ?)`,
        [randomUUID(), deposit.studentId, `Pengajuan setoran ditolak: ${note}`, deposit.id],
      );
    } else {
      if (!Array.isArray(request.body.lines) || request.body.lines.length < 1 || request.body.lines.length > 20) {
        throw new ApiError(400, "INVALID_DEPOSIT_LINES", "Rincian setoran tidak valid.");
      }
      const [lines] = await connection.execute(
        `SELECT rincian_setoran.id, rincian_setoran.jenis_sampah_id AS wasteTypeId,
          jenis_sampah.nama AS wasteName, jenis_sampah.satuan AS unit,
          jenis_sampah.harga_per_satuan_arsip AS pricePerUnit
         FROM rincian_setoran
         LEFT JOIN jenis_sampah ON jenis_sampah.id = rincian_setoran.jenis_sampah_id
         WHERE rincian_setoran.setoran_id = ?
         ORDER BY rincian_setoran.id FOR UPDATE`,
        [deposit.id],
      );
      if (lines.length !== request.body.lines.length) {
        throw new ApiError(409, "DEPOSIT_LINES_CHANGED", "Rincian setoran sudah berubah. Muat ulang lalu coba lagi.");
      }
      let totalAmount = 0;
      const reviewedLines = [];
      for (let index = 0; index < lines.length; index += 1) {
        const savedLine = lines[index];
        const inputLine = request.body.lines[index];
        if (!inputLine || typeof inputLine.wasteTypeId !== "string" ||
            (savedLine.wasteTypeId && inputLine.wasteTypeId !== savedLine.wasteTypeId)) {
          throw new ApiError(400, "INVALID_DEPOSIT_LINE", "Jenis sampah pada rincian tidak sesuai.");
        }
        let wasteTypeId = savedLine.wasteTypeId;
        let wasteName = savedLine.wasteName;
        let unit = savedLine.unit;
        let pricePerUnit = savedLine.pricePerUnit;
        if (!wasteTypeId) {
          const [mappedTypes] = await connection.execute(
            `SELECT id, nama AS wasteName, satuan AS unit,
              harga_per_satuan_arsip AS pricePerUnit
             FROM jenis_sampah
             WHERE id = ? AND aktif = TRUE FOR SHARE`,
            [inputLine.wasteTypeId],
          );
          if (mappedTypes.length === 0) {
            throw new ApiError(409, "WASTE_TYPE_UNAVAILABLE", "Pilih jenis sampah aktif untuk memetakan pengajuan.");
          }
          ({ id: wasteTypeId, wasteName, unit, pricePerUnit } = mappedTypes[0]);
        }
        const quantity = readQuantity(inputLine.quantity, unit);
        const rate = pricePerUnit === null
          ? 0
          : toSafeNumber(pricePerUnit, "Tarif rupiah");
        if (rate <= 0) {
          throw new ApiError(409, "PRICE_UNSET", `Tarif rupiah untuk ${wasteName} belum diatur.`);
        }
        const amount = calculateAmount(quantity, rate);
        if (amount === null) {
          throw new ApiError(400, "AMOUNT_OUT_OF_RANGE", `Nominal setoran ${wasteName} melebihi batas.`);
        }
        totalAmount += amount;
        if (!Number.isSafeInteger(totalAmount)) {
          throw new ApiError(400, "AMOUNT_OUT_OF_RANGE", "Total nominal setoran melebihi batas.");
        }
        reviewedLines.push({ id: savedLine.id, wasteTypeId, wasteName, unit, rate, quantity, amount });
      }
      for (const line of reviewedLines) {
        await connection.execute(
          `UPDATE rincian_setoran
           SET jenis_sampah_id = ?, nama_jenis_sampah = ?, satuan = ?,
             jumlah = ?, harga_per_satuan_arsip = ?, nominal_arsip = ?
           WHERE id = ?`,
          [line.wasteTypeId, line.wasteName, line.unit, line.quantity, line.rate, line.amount, line.id],
        );
      }
      await connection.execute(
        `UPDATE pengajuan_setoran
         SET status = 'disetujui', catatan = ?, ditinjau_oleh = ?, ditinjau_pada = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [note, request.account.id, deposit.id],
      );
      if (totalAmount < 1) {
        throw new ApiError(400, "AMOUNT_TOO_LOW", "Total nominal setoran harus minimal Rp1.");
      }
      await connection.execute(
        `INSERT INTO arsip_transaksi_saldo
          (id, peserta_id, jenis, nominal, keterangan, setoran_id, dibuat_oleh)
         VALUES (?, ?, 'setoran', ?, ?, ?, ?)`,
        [randomUUID(), deposit.studentId, totalAmount, `Setoran disetujui${note ? ` — ${note}` : ""}`, deposit.id, request.account.id],
      );
      await connection.execute(
        `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
         VALUES (?, ?, 'Saldo bertambah', ?, 'saldo', ?)`,
        [randomUUID(), deposit.studentId, `Setoran disetujui dan menambah saldo ${new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(totalAmount)}.`, deposit.id],
      );
    }
    await connection.commit();
    response.json({ message: decision === "approve" ? "Setoran disetujui." : "Setoran ditolak." });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch("/notifications/read-all", async (request, response, next) => {
  try {
    await pool.execute(
      "UPDATE notifikasi SET dibaca_pada = CURRENT_TIMESTAMP(3) WHERE penerima_id = ? AND dibaca_pada IS NULL",
      [request.account.id],
    );
    response.json({ message: "Notifikasi ditandai sudah dibaca." });
  } catch (error) {
    next(error);
  }
});

router.patch("/preferences", async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    if (typeof request.body.inAppNotifications !== "boolean") {
      throw new ApiError(400, "INVALID_PREFERENCES", "Preferensi notifikasi tidak valid.");
    }
    await pool.execute(
      "UPDATE akun SET notifikasi_dalam_aplikasi = ? WHERE id = ?",
      [request.body.inAppNotifications, request.account.id],
    );
    response.json({
      preferences: {
        inAppNotifications: request.body.inAppNotifications,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/notifications/:id/read", async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      `UPDATE notifikasi SET dibaca_pada = CURRENT_TIMESTAMP(3)
       WHERE id = ? AND penerima_id = ? AND dibaca_pada IS NULL`,
      [request.params.id, request.account.id],
    );
    if (result.affectedRows === 0) {
      const [rows] = await pool.execute(
        "SELECT id FROM notifikasi WHERE id = ? AND penerima_id = ?",
        [request.params.id, request.account.id],
      );
      if (rows.length === 0) throw new ApiError(404, "NOTIFICATION_NOT_FOUND", "Notifikasi tidak ditemukan.");
    }
    response.json({ message: "Notifikasi ditandai sudah dibaca." });
  } catch (error) {
    next(error);
  }
});

function readWithdrawalBody(body) {
  requireObjectBody(body);
  const amount = readInteger(body.amount, "Nominal pencairan", { min: 1 });
  const destinationType = body.destinationType;
  if (destinationType !== "bank" && destinationType !== "ewallet") {
    throw new ApiError(400, "INVALID_DESTINATION", "Pilih rekening bank atau e-wallet.");
  }
  const institution = readText(body.institution, "Nama bank atau e-wallet", 60);
  const accountName = readText(body.accountName, "Nama pemilik rekening", 100);
  const accountNumber = readText(body.accountNumber, "Nomor rekening", 24);
  if (!/^[0-9]{6,24}$/.test(accountNumber)) {
    throw new ApiError(400, "INVALID_ACCOUNT_NUMBER", "Nomor rekening harus terdiri dari 6 sampai 24 angka.");
  }
  return {
    amount,
    destinationType: destinationType === "bank" ? "bank" : "dompet_digital",
    institution,
    accountName,
    accountNumber,
  };
}

router.post("/withdrawals", async (request, response, next) => {
  let connection;
  try {
    if (request.account.role !== "student") {
      throw new ApiError(403, "FORBIDDEN", "Hanya peserta yang dapat mengajukan pencairan saldo.");
    }
    const withdrawal = readWithdrawalBody(request.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM akun WHERE id = ? FOR UPDATE", [request.account.id]);
    const [activeRows] = await connection.execute(
      "SELECT id FROM arsip_pengajuan_pencairan WHERE peserta_id = ? AND status IN ('menunggu', 'diproses') FOR UPDATE",
      [request.account.id],
    );
    if (activeRows.length > 0) {
      throw new ApiError(409, "WITHDRAWAL_ALREADY_ACTIVE", "Selesaikan atau batalkan pengajuan aktif sebelum membuat yang baru.");
    }
    const [balanceRows] = await connection.execute(
      "SELECT COALESCE(SUM(nominal), 0) AS balance FROM arsip_transaksi_saldo WHERE peserta_id = ?",
      [request.account.id],
    );
    const balance = toSafeNumber(balanceRows[0].balance, "Saldo");
    if (withdrawal.amount > balance) {
      throw new ApiError(409, "INSUFFICIENT_BALANCE", "Saldo tersedia tidak cukup untuk pengajuan ini.");
    }
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO arsip_pengajuan_pencairan
        (id, peserta_id, nominal, jenis_tujuan, lembaga, nama_pemilik_rekening, nomor_rekening)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, request.account.id, withdrawal.amount, withdrawal.destinationType, withdrawal.institution, withdrawal.accountName, withdrawal.accountNumber],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       SELECT UUID(), id, 'Pengajuan pencairan saldo', ?, 'saldo', ?
       FROM akun WHERE peran = 'pengelola' AND aktif = TRUE`,
      [`${request.account.name} mengajukan pencairan saldo.`, id],
    );
    await connection.commit();
    const [rows] = await pool.execute(`${withdrawalSelect} WHERE id = ?`, [id]);
    response.status(201).json({ withdrawalRequest: mapWithdrawal(rows[0]) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch("/withdrawals/:id", async (request, response, next) => {
  let connection;
  try {
    if (request.account.role !== "student") {
      throw new ApiError(403, "FORBIDDEN", "Hanya peserta yang dapat mengubah pengajuan pencairan.");
    }
    const withdrawal = readWithdrawalBody(request.body);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM akun WHERE id = ? FOR UPDATE", [request.account.id]);
    const [requests] = await connection.execute(
      `SELECT id FROM arsip_pengajuan_pencairan
       WHERE id = ? AND peserta_id = ? AND status = 'menunggu' FOR UPDATE`,
      [request.params.id, request.account.id],
    );
    if (requests.length === 0) {
      throw new ApiError(409, "WITHDRAWAL_NOT_EDITABLE", "Pengajuan tidak ditemukan atau sudah diproses.");
    }
    const [balanceRows] = await connection.execute(
      "SELECT COALESCE(SUM(nominal), 0) AS balance FROM arsip_transaksi_saldo WHERE peserta_id = ?",
      [request.account.id],
    );
    const [reservedRows] = await connection.execute(
      `SELECT COALESCE(SUM(nominal), 0) AS reserved
       FROM arsip_pengajuan_pencairan
       WHERE peserta_id = ? AND status IN ('menunggu', 'diproses') AND id <> ?`,
      [request.account.id, request.params.id],
    );
    const available = toSafeNumber(balanceRows[0].balance, "Saldo") -
      toSafeNumber(reservedRows[0].reserved, "Saldo yang ditahan");
    if (withdrawal.amount > available) {
      throw new ApiError(409, "INSUFFICIENT_BALANCE", "Saldo tersedia tidak cukup untuk pengajuan ini.");
    }
    await connection.execute(
      `UPDATE arsip_pengajuan_pencairan
       SET nominal = ?, jenis_tujuan = ?, lembaga = ?, nama_pemilik_rekening = ?, nomor_rekening = ?
       WHERE id = ?`,
      [withdrawal.amount, withdrawal.destinationType, withdrawal.institution, withdrawal.accountName, withdrawal.accountNumber, request.params.id],
    );
    await connection.commit();
    const [rows] = await pool.execute(`${withdrawalSelect} WHERE id = ?`, [request.params.id]);
    response.json({ withdrawalRequest: mapWithdrawal(rows[0]) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post("/withdrawals/:id/cancel", async (request, response, next) => {
  try {
    const [result] = await pool.execute(
      `UPDATE arsip_pengajuan_pencairan SET status = 'dibatalkan'
       WHERE id = ? AND peserta_id = ? AND status = 'menunggu'`,
      [request.params.id, request.account.id],
    );
    if (result.affectedRows === 0) {
      throw new ApiError(409, "WITHDRAWAL_NOT_CANCELLABLE", "Pengajuan tidak ditemukan atau sudah diproses.");
    }
    response.json({ message: "Pengajuan pencairan dibatalkan." });
  } catch (error) {
    next(error);
  }
});

router.post("/withdrawals/:id/review", requireManager, async (request, response, next) => {
  let connection;
  try {
    requireObjectBody(request.body);
    const decision = request.body.decision;
    const note = readText(request.body.note ?? "", "Catatan", 500, { optional: true });
    if (decision !== "approve" && decision !== "reject") {
      throw new ApiError(400, "INVALID_DECISION", "Keputusan harus approve atau reject.");
    }
    if (decision === "reject" && !note) {
      throw new ApiError(400, "REJECTION_NOTE_REQUIRED", "Alasan penolakan wajib diisi.");
    }
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [requests] = await connection.execute(
      `SELECT id, peserta_id AS studentId, nominal AS amount, status
       FROM arsip_pengajuan_pencairan WHERE id = ? FOR UPDATE`,
      [request.params.id],
    );
    const withdrawal = requests[0];
    if (!withdrawal || withdrawal.status !== "menunggu") {
      throw new ApiError(409, "WITHDRAWAL_ALREADY_REVIEWED", "Pengajuan tidak ditemukan atau sudah ditinjau.");
    }
    if (decision === "approve") {
      const [balanceRows] = await connection.execute(
        "SELECT COALESCE(SUM(nominal), 0) AS balance FROM arsip_transaksi_saldo WHERE peserta_id = ?",
        [withdrawal.studentId],
      );
      const [reservedRows] = await connection.execute(
        `SELECT COALESCE(SUM(nominal), 0) AS reserved
         FROM arsip_pengajuan_pencairan
         WHERE peserta_id = ? AND status IN ('menunggu', 'diproses') AND id <> ?`,
        [withdrawal.studentId, withdrawal.id],
      );
      const balance = toSafeNumber(balanceRows[0].balance, "Saldo") -
        toSafeNumber(reservedRows[0].reserved, "Saldo yang ditahan");
      const amount = toSafeNumber(withdrawal.amount, "Nominal pencairan");
      if (amount > balance) {
        throw new ApiError(409, "INSUFFICIENT_BALANCE", "Saldo tidak cukup untuk menyetujui pencairan.");
      }
    }
    const status = decision === "approve" ? "diproses" : "ditolak";
    await connection.execute(
      `UPDATE arsip_pengajuan_pencairan SET status = ?, catatan = ?, ditinjau_oleh = ?,
        ditinjau_pada = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [status, note, request.account.id, withdrawal.id],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       VALUES (?, ?, ?, ?, 'saldo', ?)`,
      [randomUUID(), withdrawal.studentId,
        decision === "approve" ? "Pencairan disetujui" : "Pencairan ditolak",
        decision === "approve" ? "Pengajuan pencairan disetujui dan sedang diproses." : `Pengajuan pencairan ditolak.${note ? ` Alasan: ${note}` : ""}`,
        withdrawal.id],
    );
    await connection.commit();
    response.json({ message: decision === "approve" ? "Pencairan disetujui." : "Pencairan ditolak." });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post("/withdrawals/:id/pay", requireManager, async (request, response, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [requests] = await connection.execute(
      `SELECT id, peserta_id AS studentId, nominal AS amount, status
       FROM arsip_pengajuan_pencairan WHERE id = ? FOR UPDATE`,
      [request.params.id],
    );
    const withdrawal = requests[0];
    if (!withdrawal || withdrawal.status !== "diproses") {
      throw new ApiError(409, "WITHDRAWAL_NOT_PROCESSING", "Hanya pencairan yang disetujui dapat ditandai sudah dibayar.");
    }
    const amount = toSafeNumber(withdrawal.amount, "Nominal pencairan");
    const [balanceRows] = await connection.execute(
      "SELECT COALESCE(SUM(nominal), 0) AS balance FROM arsip_transaksi_saldo WHERE peserta_id = ?",
      [withdrawal.studentId],
    );
    const [reservedRows] = await connection.execute(
      `SELECT COALESCE(SUM(nominal), 0) AS reserved
       FROM arsip_pengajuan_pencairan
       WHERE peserta_id = ? AND status IN ('menunggu', 'diproses') AND id <> ?`,
      [withdrawal.studentId, withdrawal.id],
    );
    const balance = toSafeNumber(balanceRows[0].balance, "Saldo") -
      toSafeNumber(reservedRows[0].reserved, "Saldo yang ditahan");
    if (amount > balance) {
      throw new ApiError(409, "INSUFFICIENT_BALANCE", "Saldo tidak cukup untuk mencatat pencairan.");
    }
    await connection.execute(
      `UPDATE arsip_pengajuan_pencairan SET status = 'dibayar', dibayar_oleh = ?, dibayar_pada = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [request.account.id, withdrawal.id],
    );
    await connection.execute(
      `INSERT INTO arsip_transaksi_saldo
        (id, peserta_id, jenis, nominal, keterangan, pengajuan_pencairan_id, dibuat_oleh)
       VALUES (?, ?, 'pencairan', ?, 'Pencairan saldo', ?, ?)`,
      [randomUUID(), withdrawal.studentId, -amount, withdrawal.id, request.account.id],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       VALUES (?, ?, 'Saldo dicairkan', 'Pencairan saldo telah ditransfer oleh pengelola.', 'saldo', ?)`,
      [randomUUID(), withdrawal.studentId, withdrawal.id],
    );
    await connection.commit();
    response.json({ message: "Pencairan dicatat." });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
