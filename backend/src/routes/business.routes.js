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

function calculatePoints(quantity, rate) {
  const scaledQuantity = BigInt(Math.round(quantity * 1000));
  const points = (scaledQuantity * BigInt(rate)) / 1000n;
  if (points < 1n || points > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(points);
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
    pointsPerUnit: toSafeNumber(row.pointsPerUnit, "Tarif poin"),
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
      pricePerUnit: null,
      amount: null,
      pointsAwarded: line.pointsAwarded === null ? null : toSafeNumber(line.pointsAwarded, "Poin setoran"),
    })),
  };
}

function mapReward(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind === "barang" ? "item" : "money",
    pointsCost: toSafeNumber(row.pointsCost, "Biaya poin"),
    stock: row.stock === null ? null : Number(row.stock),
    moneyAmount: row.moneyAmount === null ? null : toSafeNumber(row.moneyAmount, "Nominal uang"),
    active: Boolean(row.active),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRedemption(row) {
  return {
    id: row.id,
    studentId: row.studentId,
    rewardId: row.rewardId ?? "",
    rewardName: row.rewardName,
    kind: row.kind === "barang" ? "item" : "money",
    pointsCost: toSafeNumber(row.pointsCost, "Biaya poin"),
    moneyAmount: row.moneyAmount === null ? null : toSafeNumber(row.moneyAmount, "Nominal uang"),
    status: ({
      menunggu: "pending",
      disetujui: "approved",
      ditolak: "rejected",
      selesai: "fulfilled",
      dibatalkan: "cancelled",
    })[row.status],
    note: row.note,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    fulfilledBy: row.fulfilledBy,
    fulfilledAt: row.fulfilledAt,
  };
}

const wasteSelect = `SELECT
  id,
  nama AS name,
  satuan AS unit,
  poin_per_satuan AS pointsPerUnit,
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

const rewardSelect = `SELECT
  id,
  nama AS name,
  keterangan AS description,
  jenis AS kind,
  poin_dibutuhkan AS pointsCost,
  stok AS stock,
  nominal_uang AS moneyAmount,
  aktif AS active,
  dibuat_pada AS createdAt,
  diperbarui_pada AS updatedAt
FROM katalog_reward`;

const redemptionSelect = `SELECT
  id,
  peserta_id AS studentId,
  reward_id AS rewardId,
  nama_reward AS rewardName,
  jenis_reward AS kind,
  poin_dibutuhkan AS pointsCost,
  nominal_uang AS moneyAmount,
  status,
  catatan AS note,
  ditinjau_oleh AS reviewedBy,
  ditinjau_pada AS reviewedAt,
  diserahkan_oleh AS fulfilledBy,
  diserahkan_pada AS fulfilledAt,
  dibuat_pada AS createdAt,
  diperbarui_pada AS updatedAt
FROM pengajuan_penukaran`;

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
      rincian_setoran.poin_didapat AS pointsAwarded
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

async function loadPoints(connection, account) {
  const manager = account.role === "manager";
  const [rows] = manager
    ? await connection.query(
      `SELECT id, peserta_id AS studentId, jumlah AS amount, keterangan AS description,
        setoran_id AS depositId, pengajuan_penukaran_id AS redemptionId,
        dibuat_pada AS createdAt, dibuat_oleh AS createdBy
       FROM transaksi_poin ORDER BY dibuat_pada DESC, id`,
    )
    : await connection.execute(
      `SELECT id, peserta_id AS studentId, jumlah AS amount, keterangan AS description,
        setoran_id AS depositId, pengajuan_penukaran_id AS redemptionId,
        dibuat_pada AS createdAt, dibuat_oleh AS createdBy
       FROM transaksi_poin WHERE peserta_id = ? ORDER BY dibuat_pada DESC, id`,
      [account.id],
    );
  return rows.map((row) => ({
    ...row,
    amount: toSafeNumber(row.amount, "Jumlah poin"),
  }));
}

async function loadPreferences(connection, account) {
  const [rows] = await connection.execute(
    `SELECT akun.notifikasi_dalam_aplikasi AS inAppNotifications,
      (SELECT pengelola.whatsapp FROM akun AS pengelola
       WHERE pengelola.peran = 'pengelola' AND pengelola.aktif = TRUE
       ORDER BY pengelola.dibuat_pada, pengelola.id LIMIT 1) AS managerWhatsapp,
      (SELECT rupiah_per_poin FROM pengaturan_bank_sampah WHERE id = 1) AS rupiahPerPoint
     FROM akun WHERE akun.id = ?`,
    [account.id],
  );
  if (rows.length === 0) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Akun tidak ditemukan.");
  return {
    inAppNotifications: Boolean(rows[0].inAppNotifications),
    managerWhatsapp: rows[0].managerWhatsapp ?? "",
    rupiahPerPoint: rows[0].rupiahPerPoint === null
      ? null
      : toSafeNumber(rows[0].rupiahPerPoint, "Nilai rupiah per poin"),
  };
}

async function loadBusinessData(connection, account) {
  const preferences = await loadPreferences(connection, account);
  const [wasteRows] = await connection.query(`${wasteSelect} ORDER BY nama, id`);
  const [rewardRows] = account.role === "manager"
    ? await connection.query(`${rewardSelect} ORDER BY dibuat_pada DESC, id`)
    : await connection.query(`${rewardSelect} WHERE aktif = TRUE ORDER BY nama, id`);
  const [redemptionRows] = account.role === "manager"
    ? await connection.query(`${redemptionSelect} ORDER BY dibuat_pada DESC, id`)
    : await connection.execute(`${redemptionSelect} WHERE peserta_id = ? ORDER BY dibuat_pada DESC, id`, [account.id]);
  return {
    wasteTypes: wasteRows.map(mapWasteType),
    deposits: await loadDeposits(connection, account),
    pointEntries: await loadPoints(connection, account),
    rewards: rewardRows.map(mapReward),
    redemptionRequests: redemptionRows.map(mapRedemption),
    notifications: preferences.inAppNotifications ? await loadNotifications(connection, account) : [],
    preferences,
  };
}

async function loadNotifications(connection, account) {
  const [rows] = await connection.execute(
    `SELECT id, penerima_id AS recipientId, judul AS title, pesan AS message,
      jenis AS kind, id_terkait AS relatedId, dibaca_pada AS readAt, dibuat_pada AS createdAt
     FROM notifikasi WHERE penerima_id = ? ORDER BY dibuat_pada DESC, id LIMIT 100`,
    [account.id],
  );
  return rows.map((row) => ({
    ...row,
    kind: ({ setoran: "deposit", poin: "wallet", penukaran: "reward", sistem: "system" })[row.kind],
  }));
}

router.use(requireAuth);

router.get("/ranking/monthly", async (request, response, next) => {
  if (request.account.role !== "student") {
    next(new ApiError(403, "FORBIDDEN", "Ranking ini hanya tersedia untuk peserta didik."));
    return;
  }
  try {
    const [rows] = await pool.query(
      `SELECT DATE_FORMAT(CURRENT_DATE(), '%Y-%m') AS month,
        akun.id AS studentId, akun.nama AS name, akun.kelas AS className,
        COALESCE(SUM(transaksi_poin.jumlah), 0) AS points
       FROM akun
       LEFT JOIN transaksi_poin
         ON transaksi_poin.peserta_id = akun.id
         AND transaksi_poin.setoran_id IS NOT NULL
         AND transaksi_poin.jumlah > 0
         AND transaksi_poin.dibuat_pada >= DATE_FORMAT(CURRENT_DATE(), '%Y-%m-01')
         AND transaksi_poin.dibuat_pada < DATE_FORMAT(
           DATE_ADD(CURRENT_DATE(), INTERVAL 1 MONTH), '%Y-%m-01'
         )
       WHERE akun.peran = 'peserta' AND akun.aktif = TRUE
       GROUP BY akun.id, akun.nama, akun.kelas
       ORDER BY points DESC, akun.nama ASC, akun.id ASC`,
    );
    response.json({
      month: rows[0].month,
      ranking: rows.map((row) => ({
        studentId: row.studentId,
        name: row.name,
        className: row.className,
        points: toSafeNumber(row.points, "Poin bulanan"),
      })),
    });
  } catch (error) {
    next(error);
  }
});

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
    const pointsPerUnit = readInteger(request.body.pointsPerUnit, "Tarif poin", { min: 1 });
    const icon = readText(request.body.icon ?? "♻️", "Ikon", 24);
    const image = readImage(request.body.image, "Gambar jenis sampah");
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO jenis_sampah
        (id, nama, satuan, poin_per_satuan, ikon, url_gambar, tipe_gambar, data_gambar, dibuat_oleh)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, unit, pointsPerUnit, icon, image.url, image.type, image.data, request.account.id],
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
    const pointsPerUnit = readInteger(request.body.pointsPerUnit, "Tarif poin", { min: 1 });
    const icon = readText(request.body.icon ?? "♻️", "Ikon", 24);
    const image = readImage(request.body.image, "Gambar jenis sampah");
    if (typeof request.body.active !== "boolean") {
      throw new ApiError(400, "INVALID_ACTIVE", "Status jenis sampah tidak valid.");
    }
    await pool.execute(
      `UPDATE jenis_sampah
       SET nama = ?, satuan = ?, poin_per_satuan = ?, ikon = ?, url_gambar = ?,
         tipe_gambar = ?, data_gambar = ?, aktif = ?
       WHERE id = ?`,
      [name, unit, pointsPerUnit, icon, image.url, image.type, image.data, request.body.active, request.params.id],
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
    if (!Array.isArray(request.body.wasteTypeIds) || request.body.wasteTypeIds.length < 1 || request.body.wasteTypeIds.length > 20) {
      throw new ApiError(400, "INVALID_WASTE_TYPES", "Pilih antara 1 sampai 20 jenis sampah.");
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
    const placeholders = wasteTypeIds.map(() => "?").join(", ");
    const [types] = await connection.execute(
      `SELECT id, nama, satuan FROM jenis_sampah
       WHERE id IN (${placeholders}) AND aktif = TRUE FOR SHARE`,
      wasteTypeIds,
    );
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
        satuan AS unit, NULLIF(jumlah, 0) AS quantity, poin_didapat AS pointsAwarded
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
          jenis_sampah.poin_per_satuan AS pointsPerUnit
         FROM rincian_setoran
         INNER JOIN jenis_sampah ON jenis_sampah.id = rincian_setoran.jenis_sampah_id
         WHERE rincian_setoran.setoran_id = ?
         ORDER BY rincian_setoran.id FOR UPDATE`,
        [deposit.id],
      );
      if (lines.length !== request.body.lines.length) {
        throw new ApiError(409, "DEPOSIT_LINES_CHANGED", "Rincian setoran sudah berubah. Muat ulang lalu coba lagi.");
      }
      let totalPoints = 0;
      const reviewedLines = [];
      for (let index = 0; index < lines.length; index += 1) {
        const savedLine = lines[index];
        const inputLine = request.body.lines[index];
        if (!inputLine || inputLine.wasteTypeId !== savedLine.wasteTypeId) {
          throw new ApiError(400, "INVALID_DEPOSIT_LINE", "Jenis sampah pada rincian tidak sesuai.");
        }
        const quantity = readQuantity(inputLine.quantity, savedLine.unit);
        const rate = toSafeNumber(savedLine.pointsPerUnit, "Tarif poin");
        if (rate <= 0) {
          throw new ApiError(409, "POINT_RATE_UNSET", `Tarif poin untuk ${savedLine.wasteName} belum diatur.`);
        }
        const pointsAwarded = calculatePoints(quantity, rate);
        if (pointsAwarded === null) {
          throw new ApiError(400, "POINTS_TOO_LOW", `Jumlah poin untuk ${savedLine.wasteName} harus minimal 1.`);
        }
        totalPoints += pointsAwarded;
        if (!Number.isSafeInteger(totalPoints)) {
          throw new ApiError(400, "POINTS_OUT_OF_RANGE", "Total poin setoran melebihi batas.");
        }
        reviewedLines.push({ id: savedLine.id, rate, quantity, pointsAwarded });
      }
      for (const line of reviewedLines) {
        await connection.execute(
          `UPDATE rincian_setoran
           SET jumlah = ?, poin_per_satuan = ?, poin_didapat = ?
           WHERE id = ?`,
          [line.quantity, line.rate, line.pointsAwarded, line.id],
        );
      }
      await connection.execute(
        `UPDATE pengajuan_setoran
         SET status = 'disetujui', catatan = ?, ditinjau_oleh = ?, ditinjau_pada = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [note, request.account.id, deposit.id],
      );
      await connection.execute(
        `INSERT INTO transaksi_poin
          (id, peserta_id, jenis, jumlah, keterangan, setoran_id, dibuat_oleh)
         VALUES (?, ?, 'setoran', ?, ?, ?, ?)`,
        [randomUUID(), deposit.studentId, totalPoints, `Setoran disetujui${note ? ` — ${note}` : ""}`, deposit.id, request.account.id],
      );
      await connection.execute(
        `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
         VALUES (?, ?, 'Setoran disetujui', ?, 'poin', ?)`,
        [randomUUID(), deposit.studentId, `Setoran disetujui dan menghasilkan ${totalPoints} poin.`, deposit.id],
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

router.patch("/conversion-rate", requireManager, async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const rupiahPerPoint = readInteger(request.body.rupiahPerPoint, "Nilai rupiah per poin", { min: 1 });
    await pool.execute(
      `INSERT INTO pengaturan_bank_sampah (id, rupiah_per_poin, diperbarui_oleh)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE rupiah_per_poin = ?, diperbarui_oleh = ?`,
      [rupiahPerPoint, request.account.id, rupiahPerPoint, request.account.id],
    );
    response.json({ rupiahPerPoint });
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

function readRewardBody(body, { partial = false } = {}) {
  requireObjectBody(body);
  const name = readText(body.name, "Nama reward", 100);
  const description = readText(body.description ?? "", "Keterangan", 300, { optional: true });
  const kind = body.kind;
  if (kind !== "item" && kind !== "money") {
    throw new ApiError(400, "INVALID_REWARD_KIND", "Jenis reward harus barang atau uang.");
  }
  const pointsCost = readInteger(body.pointsCost, "Biaya poin", { min: 1 });
  const stock = kind === "item" && body.stock !== null && body.stock !== undefined
    ? readInteger(body.stock, "Stok", { max: 4_294_967_295 })
    : null;
  const moneyAmount = kind === "money"
    ? readInteger(body.moneyAmount, "Nominal reward uang", { min: 1 })
    : null;
  if (partial && typeof body.active !== "boolean") {
    throw new ApiError(400, "INVALID_ACTIVE", "Status reward tidak valid.");
  }
  return { name, description, kind: kind === "item" ? "barang" : "uang", pointsCost, stock, moneyAmount, active: body.active ?? true };
}

router.post("/rewards", requireManager, async (request, response, next) => {
  try {
    const reward = readRewardBody(request.body);
    const id = randomUUID();
    await pool.execute(
      `INSERT INTO katalog_reward
        (id, nama, keterangan, jenis, poin_dibutuhkan, stok, nominal_uang, aktif, dibuat_oleh)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE, ?)`,
      [id, reward.name, reward.description, reward.kind, reward.pointsCost, reward.stock, reward.moneyAmount, request.account.id],
    );
    const [rows] = await pool.execute(`${rewardSelect} WHERE id = ?`, [id]);
    response.status(201).json({ reward: mapReward(rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.patch("/rewards/:id", requireManager, async (request, response, next) => {
  try {
    const reward = readRewardBody(request.body, { partial: true });
    await pool.execute(
      `UPDATE katalog_reward
       SET nama = ?, keterangan = ?, jenis = ?, poin_dibutuhkan = ?, stok = ?, nominal_uang = ?, aktif = ?
       WHERE id = ?`,
      [reward.name, reward.description, reward.kind, reward.pointsCost, reward.stock, reward.moneyAmount, reward.active, request.params.id],
    );
    const [rows] = await pool.execute(`${rewardSelect} WHERE id = ?`, [request.params.id]);
    if (rows.length === 0) {
      throw new ApiError(404, "REWARD_NOT_FOUND", "Reward tidak ditemukan.");
    }
    response.json({ reward: mapReward(rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.post("/redemptions", async (request, response, next) => {
  let connection;
  try {
    requireObjectBody(request.body);
    const rewardId = readText(request.body.rewardId, "Reward", 36);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    await connection.execute("SELECT id FROM akun WHERE id = ? FOR UPDATE", [request.account.id]);
    const [rewards] = await connection.execute(
      `SELECT id, nama AS name, jenis AS kind, poin_dibutuhkan AS pointsCost,
        stok AS stock, nominal_uang AS moneyAmount
       FROM katalog_reward WHERE id = ? AND aktif = TRUE FOR UPDATE`,
      [rewardId],
    );
    const reward = rewards[0];
    if (!reward) throw new ApiError(404, "REWARD_UNAVAILABLE", "Reward tidak tersedia.");
    if (reward.stock !== null && reward.stock < 1) {
      throw new ApiError(409, "REWARD_OUT_OF_STOCK", "Stok reward sedang habis.");
    }
    const [balanceRows] = await connection.execute(
      `SELECT COALESCE(SUM(jumlah), 0) AS balance
       FROM transaksi_poin WHERE peserta_id = ?`,
      [request.account.id],
    );
    const [pendingRows] = await connection.execute(
      `SELECT COALESCE(SUM(poin_dibutuhkan), 0) AS reserved
       FROM pengajuan_penukaran WHERE peserta_id = ? AND status = 'menunggu'`,
      [request.account.id],
    );
    const balance = toSafeNumber(balanceRows[0].balance, "Saldo poin");
    const reserved = toSafeNumber(pendingRows[0].reserved, "Poin tertahan");
    const pointsCost = toSafeNumber(reward.pointsCost, "Biaya poin");
    if (balance - reserved < pointsCost) {
      throw new ApiError(409, "INSUFFICIENT_POINTS", "Poin tersedia tidak cukup untuk menukar reward ini.");
    }
    const id = randomUUID();
    await connection.execute(
      `INSERT INTO pengajuan_penukaran
        (id, peserta_id, reward_id, nama_reward, jenis_reward, poin_dibutuhkan, nominal_uang)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, request.account.id, reward.id, reward.name, reward.kind, reward.pointsCost, reward.moneyAmount],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       SELECT UUID(), id, 'Pengajuan penukaran reward', ?, 'penukaran', ?
       FROM akun WHERE peran = 'pengelola' AND aktif = TRUE`,
      [`${request.account.name} mengajukan penukaran ${reward.name}.`, id],
    );
    await connection.commit();
    const [rows] = await pool.execute(`${redemptionSelect} WHERE id = ?`, [id]);
    response.status(201).json({ redemptionRequest: mapRedemption(rows[0]) });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post("/redemptions/:id/review", requireManager, async (request, response, next) => {
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
      `SELECT id, peserta_id AS studentId, reward_id AS rewardId, nama_reward AS rewardName,
        poin_dibutuhkan AS pointsCost, status
       FROM pengajuan_penukaran WHERE id = ? FOR UPDATE`,
      [request.params.id],
    );
    const redemption = requests[0];
    if (!redemption || redemption.status !== "menunggu") {
      throw new ApiError(409, "REDEMPTION_ALREADY_REVIEWED", "Pengajuan penukaran tidak ditemukan atau sudah diproses.");
    }
    await connection.execute("SELECT id FROM akun WHERE id = ? FOR UPDATE", [redemption.studentId]);
    if (decision === "approve") {
      const [balanceRows] = await connection.execute(
        `SELECT COALESCE(SUM(jumlah), 0) AS balance FROM transaksi_poin WHERE peserta_id = ?`,
        [redemption.studentId],
      );
      const [pendingRows] = await connection.execute(
        `SELECT COALESCE(SUM(poin_dibutuhkan), 0) AS reserved
         FROM pengajuan_penukaran WHERE peserta_id = ? AND status = 'menunggu'`,
        [redemption.studentId],
      );
      const balance = toSafeNumber(balanceRows[0].balance, "Saldo poin");
      const reserved = toSafeNumber(pendingRows[0].reserved, "Poin tertahan");
      if (balance < reserved) {
        throw new ApiError(409, "INSUFFICIENT_POINTS", "Saldo poin tidak cukup untuk menyetujui penukaran.");
      }
      if (redemption.rewardId) {
        const [stockResult] = await connection.execute(
          `UPDATE katalog_reward SET stok = stok - 1
           WHERE id = ? AND aktif = TRUE AND (stok IS NULL OR stok > 0)`,
          [redemption.rewardId],
        );
        if (stockResult.affectedRows === 0) {
          throw new ApiError(409, "REWARD_OUT_OF_STOCK", "Stok reward sudah habis.");
        }
      }
      await connection.execute(
        `INSERT INTO transaksi_poin
          (id, peserta_id, jenis, jumlah, keterangan, pengajuan_penukaran_id, dibuat_oleh)
         VALUES (?, ?, 'penukaran', ?, ?, ?, ?)`,
        [randomUUID(), redemption.studentId, -toSafeNumber(redemption.pointsCost, "Biaya poin"), `Penukaran reward: ${redemption.rewardName}`, redemption.id, request.account.id],
      );
    }
    const newStatus = decision === "approve" ? "disetujui" : "ditolak";
    await connection.execute(
      `UPDATE pengajuan_penukaran
       SET status = ?, catatan = ?, ditinjau_oleh = ?, ditinjau_pada = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [newStatus, note, request.account.id, redemption.id],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       VALUES (?, ?, ?, ?, 'penukaran', ?)`,
      [
        randomUUID(),
        redemption.studentId,
        decision === "approve" ? "Penukaran disetujui" : "Penukaran ditolak",
        decision === "approve"
          ? `Penukaran ${redemption.rewardName} disetujui. Pengelola akan menyerahkan reward secara langsung.`
          : `Penukaran ${redemption.rewardName} ditolak.${note ? ` Alasan: ${note}` : ""}`,
        redemption.id,
      ],
    );
    await connection.commit();
    response.json({ message: decision === "approve" ? "Penukaran disetujui." : "Penukaran ditolak." });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.post("/redemptions/:id/fulfill", requireManager, async (request, response, next) => {
  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();
    const [requests] = await connection.execute(
      `SELECT peserta_id AS studentId, nama_reward AS rewardName, status
       FROM pengajuan_penukaran WHERE id = ? FOR UPDATE`,
      [request.params.id],
    );
    const redemption = requests[0];
    if (!redemption || redemption.status !== "disetujui") {
      throw new ApiError(409, "REDEMPTION_NOT_APPROVED", "Hanya penukaran yang disetujui dapat ditandai selesai.");
    }
    await connection.execute(
      `UPDATE pengajuan_penukaran
       SET status = 'selesai', diserahkan_oleh = ?, diserahkan_pada = CURRENT_TIMESTAMP(3)
       WHERE id = ?`,
      [request.account.id, request.params.id],
    );
    await connection.execute(
      `INSERT INTO notifikasi (id, penerima_id, judul, pesan, jenis, id_terkait)
       VALUES (?, ?, 'Reward telah diserahkan', ?, 'penukaran', ?)`,
      [randomUUID(), redemption.studentId, `Reward ${redemption.rewardName} telah ditandai selesai oleh pengelola.`, request.params.id],
    );
    await connection.commit();
    response.json({ message: "Reward ditandai telah diserahkan." });
  } catch (error) {
    if (connection) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

export default router;
