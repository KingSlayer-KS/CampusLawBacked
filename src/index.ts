// src/index.ts
import "dotenv/config";
import "express-async-errors";               // <— auto-catches async throws
import express from "express";
import cors from "cors";
import pino from "pino";
import pinoHttp from "pino-http";
import { askRouter } from "./routes/ask.js";
import { ingestRouter } from "./routes/ingest.js";
import { sourcesRouter } from "./routes/sources.js";
import { feedbackRouter } from "./routes/feedback.js";
import { authRouter } from './routes/auth.js';
import { historyRouter } from './routes/history.js';
import cookieParser from "cookie-parser";

const app = express();
const log = pino({ name: "api" });
app.use(cookieParser());

app.use(pinoHttp({ logger: log }));          // <— request/response logs
const allowedOrigins = [
  "http://localhost:3000",
  "https://yourdomain.com", // add prod domain here
];

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true, // allow cookies / auth headers
  })
);



app.use(express.json({ limit: "2mb" }));     // seed body is small; URLs only

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use('/auth', authRouter);
app.use('/history', historyRouter);
app.use('/ask', askRouter);
app.use('/ingest', ingestRouter);
app.use('/sources', sourcesRouter);
app.use('/feedback', feedbackRouter);
// Central error handler (must be after routers)
app.use((err: any, _req: any, res: any, _next: any) => {
  log.error({ err }, "UNCAUGHT ROUTE ERROR");
  res.status(500).json({ error: err?.message || "Internal server error" });
});

// Don’t let the process die without a log
process.on("unhandledRejection", (e) => log.error({ e }, "unhandledRejection"));
process.on("uncaughtException", (e) => log.error({ e }, "uncaughtException"));

const port = Number(process.env.PORT || 4001);
app.listen(port, () => log.info({ port }, "API listening"));
