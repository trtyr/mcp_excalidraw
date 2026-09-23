// Single-token auth for the public-facing canvas + MCP endpoints.
//
// Contract:
// - Token comes from env `EXCALIDRAW_AUTH_TOKEN`. Unset/empty ⇒ auth disabled
//   (local dev stays friction-free; upstream behaviour unchanged).
// - MCP clients (agents) authenticate with `Authorization: Bearer <token>`.
// - Browsers open `/?token=<token>`; on success the middleware injects an
//   HttpOnly cookie so the stock frontend (which knows nothing about tokens)
//   keeps working against `/api/*` and the WebSocket upgrade — zero frontend
//   changes.
import type { NextFunction, Request, Response } from 'express';
import type { IncomingMessage } from 'node:http';
import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';

const COOKIE_NAME = 'excalidraw_auth';

// Per-process random secret for the canvas process's OWN internal HTTP calls
// (canvas-client → its own /api). Never exported via env or disk, so a public
// attacker cannot present it; it exists so the single-token gate doesn't lock
// the server out of itself.
let internalSecretValue: string | null = null;
export function internalSecret(): string {
  if (!internalSecretValue) internalSecretValue = randomUUID();
  return internalSecretValue;
}

export function authToken(): string | null {
  const t = process.env.EXCALIDRAW_AUTH_TOKEN;
  const trimmed = t?.trim();
  return trimmed ? trimmed : null;
}

function extractToken(req: { headers: IncomingMessage['headers']; query?: Record<string, unknown> }): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length).trim() || null;
  }
  const cookieHeader = req.headers.cookie;
  if (cookieHeader) {
    for (const pair of cookieHeader.split(';')) {
      const [name, ...rest] = pair.trim().split('=');
      if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
    }
  }
  const q = (req.query as { token?: unknown } | undefined)?.token;
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Express middleware guarding `/mcp` and `/api/*`. Mount BEFORE the MCP
 * endpoint (i.e. before anything that touches the request body).
 */
export function requireToken(req: Request, res: Response, next: NextFunction): void {
  // Health endpoint stays open: the CLI's start/stop/status lifecycle and the
  // auto-start health polling depend on it, and it leaks nothing sensitive.
  if (req.path === '/health') {
    next();
    return;
  }
  const expected = authToken();
  if (!expected) {
    next();
    return;
  }
  const got = extractToken(req);
  if (got && constantTimeEqual(got, internalSecret())) {
    next();
    return;
  }
  if (got && constantTimeEqual(got, expected)) {
    // First browser visit via ?token= — hand back a cookie so subsequent
    // /api/* calls and the WebSocket upgrade authenticate automatically.
    const viaQuery = typeof (req.query as { token?: unknown })?.token === 'string';
    if (viaQuery && !res.headersSent) {
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${encodeURIComponent(expected)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
      );
      logger.info('Auth: token accepted via query param, cookie issued');
    }
    next();
    return;
  }
  res.status(401).json({
    error:
      'Unauthorized. Pass `Authorization: Bearer <EXCALIDRAW_AUTH_TOKEN>` (agents) or open the canvas as `/?token=<token>` (browsers).'
  });
}

/**
 * Guard for WebSocket upgrades (used as the ws `verifyClient` hook).
 * Browsers send cookies automatically; agents can pass the token via the
 * `Authorization` header or `?token=` on the ws URL.
 */
export function verifyWebSocketUpgrade(req: IncomingMessage): boolean {
  const expected = authToken();
  if (!expected) return true;
  const got = extractToken({ headers: req.headers, query: reqUrlQuery(req) });
  return !!got && constantTimeEqual(got, expected);
}

function reqUrlQuery(req: IncomingMessage): Record<string, string> {
  const url = req.url || '';
  const qIndex = url.indexOf('?');
  if (qIndex === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(qIndex + 1)));
}
