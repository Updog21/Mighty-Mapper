import type { Request, Response, NextFunction } from "express";
import { UnauthorizedError, ForbiddenError } from "../errors";
import type { UserRole } from "@shared/schema";

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (req.isAuthenticated()) {
    return next();
  }
  next(new UnauthorizedError("Authentication required"));
}

/**
 * Require the authenticated user to have one of the specified roles.
 * Must be used after `requireAuth`.
 */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      return next(new UnauthorizedError("Authentication required"));
    }
    if (!roles.includes(user.role)) {
      return next(new ForbiddenError("Insufficient permissions"));
    }
    next();
  };
}

/**
 * Require the authenticated user to be an admin, OR to own the resource
 * identified by `req.params[paramName]` matching `req.user.id`.
 * For product ownership, pass a resolver function.
 */
export function requireAdminOrOwner(
  resolveOwnerId: (req: Request) => Promise<string | null | undefined>
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      return next(new UnauthorizedError("Authentication required"));
    }
    // Viewers are always read-only, regardless of ownership
    if (user.role === "viewer") {
      return next(new ForbiddenError("Insufficient permissions"));
    }
    if (user.role === "admin") {
      return next();
    }
    try {
      const ownerId = await resolveOwnerId(req);
      if (ownerId && ownerId === user.id) {
        return next();
      }
      next(new ForbiddenError("You do not have permission to modify this resource"));
    } catch (err) {
      next(err);
    }
  };
}
