import "dotenv/config";

function readPort(name, value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be a valid TCP port.`);
  }
  return parsed;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: readPort("PORT", process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",
  managerSetupKey: process.env.MANAGER_SETUP_KEY ?? "",
  database: {
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: readPort("DB_PORT", process.env.DB_PORT, 3306),
    name: process.env.DB_NAME ?? "bank_sampah",
    user: process.env.DB_USER ?? "root",
    password: process.env.DB_PASSWORD ?? "",
  },
};
