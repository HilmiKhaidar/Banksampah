import { Router } from "express";
import { checkDatabaseConnection } from "../config/database.js";

const router = Router();

router.get("/", async (_request, response, next) => {
  try {
    await checkDatabaseConnection();
    response.json({
      status: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("MySQL health check failed:", error);
    response.status(503).json({
      status: "error",
      database: "unavailable",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
