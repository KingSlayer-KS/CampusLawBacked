import "dotenv/config";
import "express-async-errors";
import express, { ErrorRequestHandler } from "express";
import cors from "cors";
import pino from "pino";            // <— you forgot this import
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";

import { askRouter } from "./routes/ask.js";
import { ingestRouter } from "./routes/ingest.js";
import { sourcesRouter } from "./routes/sources.js";
import { feedbackRouter } from "./routes/feedback.js";
import { authRouter } from "./routes/auth.js";
import { historyRouter } from "./routes/history.js";

const app = express();
const log = pino({ name: "api" });

// attach early so every request is logged
app.use(pinoHttp({ logger: log }));

app.use(cookieParser());

const allowedOrigins = [
  "http://localhost:3000",
  "https://campuslaw.sirjan.dev",   // <— fix: you had .dev.com
];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/auth", authRouter);
app.use("/history", historyRouter);
app.use("/ask", askRouter);
app.use("/ingest", ingestRouter);
app.use("/sources", sourcesRouter);
app.use("/feedback", feedbackRouter);

const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  log.error({ err }, "UNCAUGHT ROUTE ERROR");
  res.status(500).json({ error: err?.message || "Internal server error" });
};
app.use(errorHandler);

process.on("unhandledRejection", (e) => log.error({ e }, "unhandledRejection"));
process.on("uncaughtException", (e) => log.error({ e }, "uncaughtException"));

const port = Number(process.env.PORT || 4001);
app.listen(port, () => log.info({ port }, "API listening"));