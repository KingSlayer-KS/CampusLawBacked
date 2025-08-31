// src/middleware/validate.ts
import type { AnyZodObject } from "zod";
import type { Request, Response, NextFunction } from "express";

export const validate =
  (schema: AnyZodObject, source: "body" | "query" | "params" = "body") =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      (req as any).validated = schema.parse(req[source]);
      next();
    } catch (err: any) {
      return res.status(400).json({ error: err?.errors ?? err?.message ?? "Validation error" });
    }
  };
