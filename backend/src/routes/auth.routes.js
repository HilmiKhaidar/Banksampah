import { randomBytes, timingSafeEqual } from "node:crypto";
import { Router } from "express";
import { pool } from "../config/database.js";
import { env } from "../config/env.js";
import { clearSessionCookie, requireAuth } from "../middleware/require-auth.js";
import {
  createAccountId,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  toPublicAccount,
  verifyPassword,
} from "../services/auth.service.js";

const router = Router();

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function requireObjectBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "INVALID_REQUEST", "Isi request tidak valid.");
  }
}

function readText(value, field, maxLength, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "INVALID_REQUEST", `${field} wajib berupa teks.`);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} wajib diisi dan maksimal ${maxLength} karakter.`);
  }
  return normalized;
}

function readPassword(value, field = "Kata sandi") {
  if (typeof value !== "string" || value.length < 8 || value.length > 128) {
    throw new ApiError(400, "INVALID_REQUEST", `${field} harus terdiri dari 8 sampai 128 karakter.`);
  }
  return value;
}

function setSessionCookie(response, token) {
  const secure = env.nodeEnv === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`,
  );
}

function constantTimeMatch(candidate, expected) {
  if (!expected || typeof candidate !== "string") {
    return false;
  }
  const candidateBytes = Buffer.from(candidate);
  const expectedBytes = Buffer.from(expected);
  return candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes);
}

function sendDatabaseError(error, next) {
  if (error?.code === "ER_DUP_ENTRY") {
    next(new ApiError(409, "IDENTIFIER_IN_USE", "NIS atau nama pengguna tersebut sudah terdaftar."));
    return;
  }
  next(error);
}

async function createSession(account, response) {
  const token = createSessionToken();
  const tokenHash = hashSessionToken(token);
  await pool.execute(
    `INSERT INTO sesi (hash_token, akun_id, kedaluwarsa_pada)
     VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL ? SECOND))`,
    [tokenHash, account.id, SESSION_TTL_SECONDS],
  );
  setSessionCookie(response, token);
  return toPublicAccount(account);
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

async function insertAccount(input, role) {
  const passwordHash = await hashPassword(input.password);
  const account = {
    id: createAccountId(),
    role,
    name: input.name,
    identifier: input.identifier,
    className: role === "student" ? input.className : null,
    whatsapp: input.whatsapp,
    active: true,
    createdAt: new Date(),
  };

  await pool.execute(
    `INSERT INTO akun
      (id, peran, nama, identitas, kelas, whatsapp, hash_kata_sandi)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      account.id,
      account.role === "manager" ? "pengelola" : "peserta",
      account.name,
      account.identifier,
      account.className,
      account.whatsapp,
      passwordHash,
    ],
  );
  return account;
}

async function ensureManagerSetupAvailable(connection) {
  const [rows] = await connection.query(
    "SELECT GET_LOCK('kunci_pengelola_pertama_bank_sampah', 5) AS lockAcquired",
  );
  if (rows[0].lockAcquired !== 1) {
    throw new ApiError(503, "SETUP_BUSY", "Pengaturan akun pengelola sedang berlangsung. Coba lagi.");
  }

  try {
    const [managers] = await connection.execute(
      "SELECT id FROM akun WHERE peran = 'pengelola' LIMIT 1",
    );
    if (managers.length > 0) {
      throw new ApiError(409, "MANAGER_ALREADY_CONFIGURED", "Akun pengelola sudah dibuat.");
    }
  } catch (error) {
    await releaseManagerSetupLock(connection);
    throw error;
  }
}

async function releaseManagerSetupLock(connection) {
  await connection.query("SELECT RELEASE_LOCK('kunci_pengelola_pertama_bank_sampah')");
}

router.get("/setup", async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id FROM akun WHERE peran = 'pengelola' LIMIT 1",
    );
    response.json({
      managerSetupAvailable: Boolean(env.managerSetupKey) && rows.length === 0,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/setup-manager", async (request, response, next) => {
  let connection;
  let lockAcquired = false;
  try {
    requireObjectBody(request.body);
    if (!env.managerSetupKey) {
      throw new ApiError(503, "MANAGER_SETUP_DISABLED", "Kunci setup pengelola belum dikonfigurasi server.");
    }
    if (!constantTimeMatch(request.get("x-manager-setup-key"), env.managerSetupKey)) {
      throw new ApiError(403, "INVALID_SETUP_KEY", "Kunci setup pengelola tidak valid.");
    }

    const input = {
      name: readText(request.body.name, "Nama", 100),
      identifier: readText(request.body.identifier, "Nama pengguna", 100),
      whatsapp: readText(request.body.whatsapp, "Nomor WhatsApp", 24),
      password: readPassword(request.body.password),
    };

    connection = await pool.getConnection();
    try {
      await ensureManagerSetupAvailable(connection);
      lockAcquired = true;
      const account = await insertAccount(input, "manager");
      response.status(201).json({ account: await createSession(account, response) });
    } finally {
      if (lockAcquired) await releaseManagerSetupLock(connection);
    }
  } catch (error) {
    sendDatabaseError(error, next);
  } finally {
    connection?.release();
  }
});

router.post("/login", async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const identifier = readText(request.body.identifier, "NISN atau nama pengguna", 100);
    if (typeof request.body.password !== "string" || request.body.password.length > 128) {
      throw new ApiError(400, "INVALID_REQUEST", "Kata sandi tidak valid.");
    }

    const [rows] = await pool.execute(
      `SELECT
        id,
        peran AS role,
        nama AS name,
        identitas AS identifier,
        kelas AS className,
        whatsapp,
        aktif AS active,
        wajib_ganti_kata_sandi AS passwordChangeRequired,
        hash_kata_sandi AS passwordHash,
        dibuat_pada AS createdAt
      FROM akun
      WHERE identitas = ?
      LIMIT 1`,
      [identifier],
    );
    const account = rows[0];
    const passwordMatches = account
      ? await verifyPassword(request.body.password, account.passwordHash)
      : false;
    if (!account || !account.active || !passwordMatches) {
      throw new ApiError(401, "INVALID_CREDENTIALS", "NISN/nama pengguna atau kata sandi tidak sesuai.");
    }

    await pool.execute("DELETE FROM sesi WHERE kedaluwarsa_pada <= CURRENT_TIMESTAMP(3)");
    response.json({ account: await createSession(account, response) });
  } catch (error) {
    next(error);
  }
});

router.get("/session", requireAuth, (request, response) => {
  response.json({ account: toPublicAccount(request.account) });
});

router.get("/students", requireAuth, requireManager, async (_request, response, next) => {
  try {
    const [rows] = await pool.execute(
      `SELECT
        id,
        peran AS role,
        nama AS name,
        identitas AS identifier,
        kelas AS className,
        whatsapp,
        aktif AS active,
        wajib_ganti_kata_sandi AS passwordChangeRequired,
        dibuat_pada AS createdAt
      FROM akun
      WHERE peran = 'peserta'
      ORDER BY nama, id`,
    );
    response.json({ students: rows.map(toPublicAccount) });
  } catch (error) {
    next(error);
  }
});

router.post("/students/import", requireAuth, requireManager, async (request, response, next) => {
  let connection;
  try {
    requireObjectBody(request.body);
    if (!Array.isArray(request.body.students) || request.body.students.length === 0) {
      throw new ApiError(400, "INVALID_REQUEST", "Pilih minimal satu data siswa untuk diimpor.");
    }
    if (request.body.students.length > 500) {
      throw new ApiError(400, "IMPORT_LIMIT_EXCEEDED", "Maksimal 500 siswa untuk satu kali impor.");
    }

    const identifiers = new Set();
    const students = request.body.students.map((student, index) => {
      if (!student || typeof student !== "object" || Array.isArray(student)) {
        throw new ApiError(400, "INVALID_REQUEST", `Data siswa pada baris ${index + 1} tidak valid.`);
      }
      const name = readText(student.name, `Nama pada baris ${index + 1}`, 100);
      const identifier = readText(student.identifier, `NISN pada baris ${index + 1}`, 100);
      const className = student.className == null || student.className === ""
        ? null
        : readText(student.className, `Kelas pada baris ${index + 1}`, 80);
      const normalizedIdentifier = identifier.toLowerCase();
      if (identifiers.has(normalizedIdentifier)) {
        throw new ApiError(400, "DUPLICATE_IMPORT_IDENTIFIER", `NISN ${identifier} muncul lebih dari sekali dalam file.`);
      }
      identifiers.add(normalizedIdentifier);
      return {
        id: createAccountId(),
        name,
        identifier,
        className,
        temporaryPassword: randomBytes(12).toString("base64url"),
      };
    });

    connection = await pool.getConnection();
    await connection.beginTransaction();
    for (const student of students) {
      const passwordHash = await hashPassword(student.temporaryPassword);
      await connection.execute(
        `INSERT INTO akun
          (id, peran, nama, identitas, kelas, whatsapp, hash_kata_sandi, wajib_ganti_kata_sandi)
         VALUES (?, 'peserta', ?, ?, ?, '', ?, TRUE)`,
        [student.id, student.name, student.identifier, student.className, passwordHash],
      );
    }
    await connection.commit();
    response.status(201).json({
      importedCount: students.length,
      credentials: students.map(({ name, identifier, temporaryPassword }) => ({
        name,
        identifier,
        temporaryPassword,
      })),
    });
  } catch (error) {
    if (connection) await connection.rollback();
    sendDatabaseError(error, next);
  } finally {
    connection?.release();
  }
});

router.post("/students/:id/reset-password", requireAuth, requireManager, async (request, response, next) => {
  let connection;
  let transactionStarted = false;
  try {
    requireObjectBody(request.body);
    const temporaryPassword = readPassword(request.body.temporaryPassword, "Kata sandi sementara");
    const passwordHash = await hashPassword(temporaryPassword);
    connection = await pool.getConnection();
    await connection.beginTransaction();
    transactionStarted = true;

    const [students] = await connection.execute(
      `SELECT id, nama AS name, identitas AS identifier
       FROM akun
       WHERE id = ? AND peran = 'peserta'
       LIMIT 1
       FOR UPDATE`,
      [request.params.id],
    );
    if (students.length === 0) {
      throw new ApiError(404, "STUDENT_NOT_FOUND", "Data peserta tidak ditemukan.");
    }

    await connection.execute(
      `UPDATE akun
       SET hash_kata_sandi = ?, wajib_ganti_kata_sandi = TRUE
       WHERE id = ? AND peran = 'peserta'`,
      [passwordHash, request.params.id],
    );
    await connection.execute("DELETE FROM sesi WHERE akun_id = ?", [request.params.id]);
    await connection.commit();
    transactionStarted = false;
    response.json({
      credential: {
        name: students[0].name,
        identifier: students[0].identifier,
        temporaryPassword,
      },
    });
  } catch (error) {
    if (connection && transactionStarted) await connection.rollback();
    next(error);
  } finally {
    connection?.release();
  }
});

router.patch("/students/:id", requireAuth, requireManager, async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    if (typeof request.body.active !== "boolean") {
      throw new ApiError(400, "INVALID_REQUEST", "Status akun peserta tidak valid.");
    }
    const name = readText(request.body.name, "Nama", 100);
    const className = typeof request.body.className === "string" && request.body.className.trim()
      ? readText(request.body.className, "Kelas", 80)
      : null;
    const whatsapp = typeof request.body.whatsapp === "string" && request.body.whatsapp.trim()
      ? readText(request.body.whatsapp, "Nomor WhatsApp", 24)
      : "";
    const [existing] = await pool.execute(
      "SELECT id FROM akun WHERE id = ? AND peran = 'peserta' LIMIT 1",
      [request.params.id],
    );
    if (existing.length === 0) {
      throw new ApiError(404, "STUDENT_NOT_FOUND", "Data peserta tidak ditemukan.");
    }
    await pool.execute(
      `UPDATE akun
       SET nama = ?, kelas = ?, whatsapp = ?, aktif = ?
       WHERE id = ? AND peran = 'peserta'`,
      [name, className, whatsapp, request.body.active, request.params.id],
    );
    if (!request.body.active) {
      await pool.execute("DELETE FROM sesi WHERE akun_id = ?", [request.params.id]);
    }

    const [rows] = await pool.execute(
      `SELECT
        id,
        peran AS role,
        nama AS name,
        identitas AS identifier,
        kelas AS className,
        whatsapp,
        aktif AS active,
        wajib_ganti_kata_sandi AS passwordChangeRequired,
        dibuat_pada AS createdAt
      FROM akun
      WHERE id = ?`,
      [request.params.id],
    );
    response.json({ student: toPublicAccount(rows[0]) });
  } catch (error) {
    next(error);
  }
});

router.post("/logout", requireAuth, async (request, response, next) => {
  try {
    await pool.execute("DELETE FROM sesi WHERE hash_token = ?", [request.sessionTokenHash]);
    clearSessionCookie(response);
    response.json({ message: "Anda berhasil keluar." });
  } catch (error) {
    next(error);
  }
});

router.patch("/profile", requireAuth, async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const name = readText(request.body.name, "Nama", 100);
    const whatsapp = readText(request.body.whatsapp, "Nomor WhatsApp", 24);
    const className = request.account.role === "student"
      ? readText(request.body.className, "Kelas", 80)
      : null;

    await pool.execute(
      `UPDATE akun
       SET nama = ?, whatsapp = ?, kelas = ?
       WHERE id = ?`,
      [name, whatsapp, className, request.account.id],
    );
    response.json({
      account: toPublicAccount({
        ...request.account,
        name,
        whatsapp,
        className,
      }),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/password", requireAuth, async (request, response, next) => {
  try {
    requireObjectBody(request.body);
    const newPassword = readPassword(request.body.newPassword, "Kata sandi baru");
    if (!request.account.passwordChangeRequired) {
      if (typeof request.body.currentPassword !== "string") {
        throw new ApiError(400, "INVALID_REQUEST", "Kata sandi saat ini wajib diisi.");
      }
      const [rows] = await pool.execute(
        "SELECT hash_kata_sandi AS passwordHash FROM akun WHERE id = ? LIMIT 1",
        [request.account.id],
      );
      const matches = rows[0]
        ? await verifyPassword(request.body.currentPassword, rows[0].passwordHash)
        : false;
      if (!matches) {
        throw new ApiError(400, "CURRENT_PASSWORD_MISMATCH", "Kata sandi saat ini tidak sesuai.");
      }
    }

    const newPasswordHash = await hashPassword(newPassword);
    await pool.execute(
      "UPDATE akun SET hash_kata_sandi = ?, wajib_ganti_kata_sandi = FALSE WHERE id = ?",
      [newPasswordHash, request.account.id],
    );
    await pool.execute(
      "DELETE FROM sesi WHERE akun_id = ? AND hash_token <> ?",
      [request.account.id, request.sessionTokenHash],
    );
    response.json({ message: "Kata sandi berhasil diperbarui." });
  } catch (error) {
    next(error);
  }
});

export default router;
