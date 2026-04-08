import type { Express } from "express";
import { createServer, type Server } from "http";
import authRouter from "./auth";
import productsRouter from "./products";
import wizardRouter from "./wizard";
import dataRouter from "./data";
import autoMapperRouter from "./auto-mapper";
import mitreRouter from "./mitre";
import aiRouter from "./ai";
import adminRouter from "./admin";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use("/api/auth", authRouter);
  app.use("/api/products", productsRouter);
  app.use("/api/wizard", wizardRouter);
  app.use("/api", dataRouter);
  app.use("/api/auto-mapper", autoMapperRouter);
  app.use("/api", mitreRouter);
  app.use("/api/ai", aiRouter);
  app.use("/api/admin", adminRouter);

  return httpServer;
}
