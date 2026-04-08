import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import type { Express, RequestHandler } from "express";
import { storage } from "./storage";
import type { User, UserRole } from "@shared/schema";
import { db } from "./db";
import { sql as dsql } from "drizzle-orm";

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function comparePasswords(supplied: string, stored: string): Promise<boolean> {
  const [hashed, salt] = stored.split(".");
  if (!hashed || !salt) return false;
  const hashedBuf = Buffer.from(hashed, "hex");
  const suppliedBuf = (await scryptAsync(supplied, salt, 64)) as Buffer;
  return timingSafeEqual(hashedBuf, suppliedBuf);
}

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export function validatePassword(password: unknown): string | null {
  if (!password || typeof password !== "string") return "Password is required";
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (!PASSWORD_REGEX.test(password)) return "Password must contain uppercase, lowercase, and a number";
  return null;
}

declare global {
  namespace Express {
    interface User {
      id: string;
      username: string;
      password: string;
      role: UserRole;
      requirePasswordChange: boolean;
      createdAt: Date;
    }
  }
}

export async function setupAuth(app: Express): Promise<void> {
  const isProd = process.env.NODE_ENV === "production";

  if (isProd && !process.env.SESSION_SECRET) {
    console.error("FATAL: SESSION_SECRET must be set in production");
    process.exit(1);
  }

  const PgStore = connectPgSimple(session);

  // Ensure session table exists to avoid connect-pg-simple trying to read its table.sql (which
  // is unavailable when bundling). We proactively create it here.
  try {
    await db.execute(dsql`CREATE TABLE IF NOT EXISTS "user_sessions" (
      "sid" varchar PRIMARY KEY,
      "sess" json NOT NULL,
      "expire" timestamp(6) NOT NULL
    )`);
    await db.execute(dsql`CREATE INDEX IF NOT EXISTS "user_sessions_expire_idx" ON "user_sessions" ("expire")`);
  } catch (e) {
    console.error("[Startup] Failed to ensure user_sessions table:", e);
  }

  const cookieSecure = isProd ? (process.env.COOKIE_SECURE !== "false" && process.env.COOKIE_SECURE !== "0") : false;

  const sessionMiddleware = session({
    store: new PgStore({
      conString: process.env.DATABASE_URL,
      createTableIfMissing: false,
      tableName: "user_sessions",
    }),
    secret: process.env.SESSION_SECRET || "mighty-mapper-dev-secret",
    name: "sid",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
    },
  });

  app.use(sessionMiddleware);
  app.use(passport.initialize());
  app.use(passport.session() as RequestHandler);

  passport.use(
    new LocalStrategy(async (username, password, done) => {
      try {
        const user = await storage.getUserByUsername(username);
        if (!user) {
          return done(null, false, { message: "Invalid credentials" });
        }
        const isValid = await comparePasswords(password, user.password);
        if (!isValid) {
          return done(null, false, { message: "Invalid credentials" });
        }
        return done(null, user as Express.User);
      } catch (err) {
        return done(err);
      }
    })
  );

  passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id: string, done) => {
    try {
      const user = await storage.getUser(id);
      if (!user) return done(null, undefined);
      // Never leak password hash into session
      const { password: _pw, ...safeUser } = user;
      done(null, { ...safeUser, password: "" } as Express.User);
    } catch (err) {
      done(err);
    }
  });
}
