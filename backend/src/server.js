import app from "./app.js";
import { closeDatabasePool } from "./config/database.js";
import { env } from "./config/env.js";

const server = app.listen(env.port, () => {
  console.log(`Bank Sampah API listening at http://localhost:${env.port}`);
});

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`${signal} received; shutting down API.`);

  server.close(async (error) => {
    try {
      await closeDatabasePool();
    } catch (closeError) {
      console.error("Failed to close the MySQL connection pool:", closeError);
      process.exitCode = 1;
    }

    if (error) {
      console.error("Failed to close the HTTP server:", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
