import { createHash } from "node:crypto";
import { pool } from "../config/database.js";
import { SESSION_COOKIE } from "../services/auth.service.js";

function readSessionToken(request) {
  const cookies = request.headers.cookie?.split(";") ?? [];
  const cookie = cookies.find((part) => part.trim().startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.trim().slice(SESSION_COOKIE.length + 1) : null;
}

export function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/api; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

export async function requireAuth(request, response, next) {
  try {
    const token = readSessionToken(request);
    if (!token) {
      response.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Silakan masuk kembali." },
      });
      return;
    }

    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [rows] = await pool.execute(
      `SELECT
        sesi.hash_token AS tokenHash,
        akun.id,
        CASE akun.peran
          WHEN 'pengelola' THEN 'manager'
          ELSE 'student'
        END AS role,
        akun.nama AS name,
        akun.identitas AS identifier,
        akun.kelas AS className,
        akun.whatsapp,
        akun.aktif AS active,
        akun.wajib_ganti_kata_sandi AS passwordChangeRequired,
        akun.dibuat_pada AS createdAt
      FROM sesi
      INNER JOIN akun ON akun.id = sesi.akun_id
      WHERE sesi.hash_token = ?
        AND sesi.kedaluwarsa_pada > CURRENT_TIMESTAMP(3)
        AND akun.aktif = TRUE
      LIMIT 1`,
      [tokenHash],
    );

    if (rows.length === 0) {
      clearSessionCookie(response);
      response.status(401).json({
        error: { code: "UNAUTHENTICATED", message: "Sesi berakhir. Silakan masuk kembali." },
      });
      return;
    }

    request.account = rows[0];
    request.sessionTokenHash = tokenHash;
    const passwordChangeAllowed =
      (request.baseUrl === "/api/auth" && request.method === "GET" && request.path === "/session") ||
      (request.baseUrl === "/api/auth" && request.method === "PUT" && request.path === "/password") ||
      (request.baseUrl === "/api/auth" && request.method === "POST" && request.path === "/logout");
    if (request.account.passwordChangeRequired && !passwordChangeAllowed) {
      response.status(403).json({
        error: {
          code: "PASSWORD_CHANGE_REQUIRED",
          message: "Ganti kata sandi sementara sebelum menggunakan aplikasi.",
        },
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
