/**
 * Auth middleware — resolves the request's uid from the Bearer token.
 *
 *   - optionalAuth: valid Bearer → req.uid = uid; no token → req.uid =
 *     'guest'; present-but-invalid token → 401 invalid_token (never falls
 *     back to guest silently, so a stale client token cannot masquerade).
 *   - requireAuth: 401 unless req.uid is a real (non-guest) account.
 */
import type { NextFunction, Request, Response } from 'express';
import { resolveToken } from '../utils/security.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Resolved account id, or 'guest' when no (valid) token was sent. */
      uid?: string;
    }
  }
}

/** Parse the Bearer token out of an Authorization header. */
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  if (!header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}

/** Attach req.uid ('guest' fallback) without rejecting anonymous requests. */
export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const token = bearerToken(req);
  if (!token) {
    req.uid = 'guest';
    next();
    return;
  }
  const uid = resolveToken(token);
  if (!uid) {
    res.status(401).json({ error: 'invalid_token', message: '登录已失效，请重新登录' });
    return;
  }
  req.uid = uid;
  next();
}

/** Reject requests that did not resolve to a real account. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.uid || req.uid === 'guest') {
    res.status(401).json({ error: 'unauthorized', message: '请先登录' });
    return;
  }
  next();
}
