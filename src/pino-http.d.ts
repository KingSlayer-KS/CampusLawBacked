declare module "pino-http" {
    import type { Handler } from "express";
    import type pino from "pino";
  
    export interface Options {
      logger?: pino.Logger;
      [key: string]: unknown;
    }
  
    /** Callable default export */
    export default function pinoHttp(options?: Options): Handler;
  }