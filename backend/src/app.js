import cors from "cors";
import express from "express";
import helmet from "helmet";
import { env } from "./config/env.js";
import authRoutes from "./routes/auth.routes.js";
import businessRoutes from "./routes/business.routes.js";
import healthRoutes from "./routes/health.routes.js";

const app = express();
const allowedOrigins = env.corsOrigin.split(",").map((origin) => origin.trim()).filter(Boolean);

function isAllowedOrigin(request, origin) {
  if (allowedOrigins.includes(origin)) return true;
  if (env.nodeEnv !== "development") return false;
  try {
    const parsedOrigin = new URL(origin);
    return parsedOrigin.protocol === `${request.protocol}:` &&
      parsedOrigin.hostname === request.hostname;
  } catch {
    return false;
  }
}

app.disable("x-powered-by");
app.use(helmet());
app.use("/api", (_request, response, next) => {
  response.setHeader("Cache-Control", "no-store, private");
  next();
});
app.use(cors((request, callback) => {
  const origin = request.get("origin");
  callback(null, {
    origin: origin && isAllowedOrigin(request, origin) ? origin : false,
    credentials: true,
  });
}));
app.use(express.json({ limit: "2mb" }));
app.use((request, response, next) => {
  if (
    ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) &&
    request.get("origin") &&
    !isAllowedOrigin(request, request.get("origin"))
  ) {
    response.status(403).json({
      error: { code: "UNTRUSTED_ORIGIN", message: "Origin request tidak diizinkan." },
    });
    return;
  }
  next();
});

app.get("/api", (_request, response) => {
  response.json({ name: "Bank Sampah API", version: "1.0.0" });
});
app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/business", businessRoutes);

app.use((_request, response) => {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "Endpoint tidak ditemukan.",
    },
  });
});

app.use((error, _request, response, _next) => {
  if (error?.status && error?.code) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    });
    return;
  }

  if (error?.type === "entity.parse.failed") {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "Format JSON request tidak valid.",
      },
    });
    return;
  }

  console.error("Unhandled API error:", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Terjadi kesalahan pada server.",
    },
  });
});

export default app;
