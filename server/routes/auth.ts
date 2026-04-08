import { Router } from "express";
import passport from "passport";
import { storage } from "../storage";
import { hashPassword, comparePasswords, validatePassword } from "../auth";
import { asyncHandler } from "../middleware/async-handler";
import { requireAuth, requireRole } from "../middleware/auth";
import { ConflictError, ValidationError, UnauthorizedError, NotFoundError, ForbiddenError } from "../errors";
import { userRoleEnum, users } from "@shared/schema";
import { db } from "../db";
import { eq } from "drizzle-orm";

const router = Router();

// ── Public ──

router.post("/login", (req, res, next) => {
  passport.authenticate("local", async (err: any, user: Express.User | false, info: { message: string }) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || "Invalid credentials", status: 401 });
    try {
      if (user.username === "admin" && user.role !== "admin") {
        await storage.updateUserRole(user.id, "admin");
        (user as any).role = "admin";
      }
    } catch {
      // Ignore role enforcement failure during login; proceed with current role
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.json({ id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.requirePasswordChange });
    });
  })(req, res, next);
});

router.post("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return res.status(500).json({ error: "Logout failed", status: 500 });
    res.json({ message: "Logged out" });
  });
});

router.get("/me", (req, res) => {
  if (!req.isAuthenticated()) throw new UnauthorizedError("Not authenticated");
  const user = req.user!;
  const role = user.username === "admin" ? "admin" : user.role;
  res.json({ id: user.id, username: user.username, role, mustChangePassword: !!user.requirePasswordChange });
});

router.post("/setup", asyncHandler(async (req, res) => {
  const existing = await storage.getUserByUsername("admin");
  if (existing) throw new ConflictError("Admin account already exists");
  const { password } = req.body;
  const pwError = validatePassword(password);
  if (pwError) throw new ValidationError(pwError);
  const hashed = await hashPassword(password);
  const user = await storage.createUser({ username: "admin", password: hashed, role: "admin" });
  req.logIn(user as Express.User, (err) => {
    if (err) return res.status(500).json({ error: "Account created but login failed", status: 500 });
    return res.json({ id: user.id, username: user.username, role: user.role });
  });
}));

router.get("/status", asyncHandler(async (_req, res) => {
  const existing = await storage.getUserByUsername("admin");
  res.json({ needsSetup: !existing });
}));

// ── Password change (any authenticated user) ──

router.post("/change-password", requireAuth, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || typeof currentPassword !== "string") {
    throw new ValidationError("Current password is required");
  }
  const pwError = validatePassword(newPassword);
  if (pwError) throw new ValidationError(pwError);
  // Re-fetch user with password hash for comparison
  const fullUser = await storage.getUser(req.user!.id);
  if (!fullUser) throw new UnauthorizedError("User not found");
  const valid = await comparePasswords(currentPassword, fullUser.password);
  if (!valid) throw new ValidationError("Current password is incorrect");
  const hashed = await hashPassword(newPassword);
  await db.update(users).set({ password: hashed, requirePasswordChange: false }).where(eq(users.id, fullUser.id));
  res.json({ message: "Password changed" });
}));

// ── User Management (admin only) ──

router.get("/users", requireAuth, requireRole("admin"), asyncHandler(async (_req, res) => {
  const userList = await storage.listUsers();
  res.json(userList);
}));

router.post("/users", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { username, password, role, requirePasswordChange } = req.body;
  if (!username || typeof username !== "string" || username.trim().length < 2) {
    throw new ValidationError("Username must be at least 2 characters");
  }
  const pwError = validatePassword(password);
  if (pwError) throw new ValidationError(pwError);
  if (role && !userRoleEnum.includes(role)) {
    throw new ValidationError(`Role must be one of: ${userRoleEnum.join(", ")}`);
  }
  const existing = await storage.getUserByUsername(username.trim());
  if (existing) throw new ConflictError(`User "${username}" already exists`);
  const hashed = await hashPassword(password);
  const user = await storage.createUser({ username: username.trim(), password: hashed, role: role || "user", requirePasswordChange: !!requirePasswordChange });
  res.status(201).json({ id: user.id, username: user.username, role: user.role, mustChangePassword: !!user.requirePasswordChange });
}));

router.patch("/users/:userId/role", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;
  if (!role || !userRoleEnum.includes(role)) {
    throw new ValidationError(`Role must be one of: ${userRoleEnum.join(", ")}`);
  }
  if (userId === req.user!.id) {
    throw new ForbiddenError("Cannot change your own role");
  }
  const updated = await storage.updateUserRole(userId, role);
  if (!updated) throw new NotFoundError("User not found");
  res.json({ id: updated.id, username: updated.username, role: updated.role });
}));

router.delete("/users/:userId", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const { userId } = req.params;
  if (userId === req.user!.id) {
    throw new ForbiddenError("Cannot delete your own account");
  }
  const deleted = await storage.deleteUser(userId);
  if (!deleted) throw new NotFoundError("User not found");
  res.json({ message: "User deleted" });
}));

export default router;
