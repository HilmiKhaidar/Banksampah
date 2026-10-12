import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export const SESSION_COOKIE = "bank_sampah_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

const scrypt = promisify(scryptCallback);
const HASH_BYTES = 64;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derivedKey = await scrypt(password, salt, HASH_BYTES);
  return `scrypt$${salt.toString("hex")}$${derivedKey.toString("hex")}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, keyHex, ...extra] = storedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    extra.length > 0 ||
    !/^(?:[a-f0-9]{2}){16}$/i.test(saltHex ?? "") ||
    !/^(?:[a-f0-9]{2}){64}$/i.test(keyHex ?? "")
  ) {
    return false;
  }

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), HASH_BYTES);
  return timingSafeEqual(expected, actual);
}

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function createAccountId() {
  return randomUUID();
}

export function toPublicAccount(account) {
  return {
    id: account.id,
    role: account.role === "pengelola" || account.role === "manager" ? "manager" : "student",
    name: account.name,
    identifier: account.identifier,
    className: account.className,
    whatsapp: account.whatsapp,
    active: Boolean(account.active),
    passwordChangeRequired: Boolean(account.passwordChangeRequired),
    createdAt: new Date(account.createdAt).toISOString(),
  };
}
