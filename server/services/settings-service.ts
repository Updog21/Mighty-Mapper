import { db } from "../db";
import { settings, type InsertSettings } from "../../shared/schema";
import { eq } from "drizzle-orm";
import * as crypto from "crypto";

const SENSITIVE_KEYS = new Set([
  "gemini_api_key",
  "openai_api_key",
  "gemini_model", // Optionally sensitive, but good to protect
]);

const ALGORITHM = "aes-256-gcm";
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Must be 32 bytes hex or 32 chars if utf8? Usually hex string of 32 bytes (64 chars) or just a long string.
// Ideally, the user provides a hex string. Let's assume hex string for robustness, or handle raw buffer.
// If ENCRYPTION_KEY is missing, we can't encrypt/decrypt safely.

export class SettingsService {
  private getKeyBuffer(): Buffer {
    if (!ENCRYPTION_KEY) {
      throw new Error("ENCRYPTION_KEY is not defined in environment variables.");
    }
    // If key is hex string of 64 chars, parse it. Otherwise, scrypt/hash it or raw buffer?
    // Let's assume standard behavior: if it looks like hex and is 64 chars, treat as hex key.
    // Otherwise, throw or try to use as is (if 32 bytes).
    if (/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY)) {
      return Buffer.from(ENCRYPTION_KEY, "hex");
    }
    if (ENCRYPTION_KEY.length === 32) {
      return Buffer.from(ENCRYPTION_KEY, "utf-8");
    }
    // Fallback: Hash it to 32 bytes if it's some other passphrase
    return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
  }

  private encrypt(text: string): string {
    if (!text) return text;
    const key = this.getKeyBuffer();
    const iv = crypto.randomBytes(12); // GCM standard IV size
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    // Return IV:AuthTag:Encrypted
    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
  }

  private decrypt(text: string): string {
    if (!text) return text;
    if (!text.includes(":")) return text; // Not encrypted or legacy format

    try {
      const parts = text.split(":");
      if (parts.length !== 3) return text; // Unknown format

      const [ivHex, authTagHex, encryptedHex] = parts;
      const key = this.getKeyBuffer();
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encryptedHex, "hex", "utf8");
      decrypted += decipher.final("utf8");
      return decrypted;
    } catch (error) {
      // Failed to decrypt (wrong key, corrupted data, or not encrypted)
      console.warn("SettingsService: Failed to decrypt value. Returning raw.", error);
      return text;
    }
  }

  /**
   * Retrieves a setting value by key.
   * Priority: Database -> Environment Variable -> Default Value
   */
  async get(key: string, defaultValue: string = ""): Promise<string> {
    try {
      const [record] = await db
        .select()
        .from(settings)
        .where(eq(settings.key, key))
        .limit(1);

      if (record) {
        if (SENSITIVE_KEYS.has(key)) {
          return this.decrypt(record.value);
        }
        return record.value;
      }
    } catch (error) {
      console.warn(`SettingsService: Failed to fetch key '${key}' from DB. Falling back to env/default.`);
    }

    // Fallback to Env Var (Upper Snake Case)
    // e.g., "gemini_api_key" -> process.env.GEMINI_API_KEY
    const envKey = key.toUpperCase().replace(/-/g, "_");
    return process.env[envKey] || defaultValue;
  }

  /**
   * Sets a setting value in the database.
   */
  async set(key: string, value: string): Promise<void> {
    try {
      let storedValue = value;
      if (SENSITIVE_KEYS.has(key)) {
        storedValue = this.encrypt(value);
      }

      await db
        .insert(settings)
        .values({ key, value: storedValue })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: storedValue, updatedAt: new Date() },
        });
    } catch (error) {
      console.error(`SettingsService: Failed to save key '${key}'.`, error);
      throw error;
    }
  }

  /**
   * Getting specific API keys
   */
  async getGeminiKey(): Promise<string> {
    return this.get("gemini_api_key");
  }

  async getGeminiModel(): Promise<string> {
    return this.get("gemini_model", process.env.GEMINI_MODEL || "gemini-1.5-flash");
  }

  async getOpenAIKey(): Promise<string> {
    return this.get("openai_api_key");
  }
}

export const settingsService = new SettingsService();
