import type { NextFunction, Request, Response } from "express";

import type { ResponseCryptoService } from "./response-crypto.service.ts";

/** Paths never encrypted: docs, the key endpoint itself, and provider webhooks. */
function isExcluded(path: string): boolean {
  return (
    path.startsWith("/docs") ||
    path.startsWith("/crypto/") ||
    path.startsWith("/favicon") ||
    path.includes("/webhook")
  );
}

/**
 * - Adds transport-safety headers (nosniff, no-referrer, no-store; HSTS when the
 *   request arrived over HTTPS, directly or through a proxy).
 * - When the client sent `X-Client-Key`, replaces the JSON body of successful
 *   responses with an encrypted envelope.
 *
 * It wraps `res.json`, which Nest calls with the final body, after interceptors
 * and the request logger have seen the plain data (so admin logs stay readable).
 * Error responses (status >= 400) stay plain so clients can always show them.
 */
export function secureTransport(crypto: ResponseCryptoService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = (req.originalUrl || req.url || "").split("?")[0] ?? "";
    if (isExcluded(path)) {
      next();
      return;
    }

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    const forwardedProto = req.headers["x-forwarded-proto"];
    if (req.secure || forwardedProto === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    }

    const clientKey = req.headers["x-client-key"];
    if (typeof clientKey !== "string" || clientKey.length === 0) {
      next();
      return;
    }

    const aad = `${req.method.toUpperCase()} ${path}`;
    const plainJson = res.json.bind(res);
    res.json = (body?: unknown) => {
      if (res.statusCode >= 400 || body === undefined) return plainJson(body);
      try {
        const sealed = crypto.seal(clientKey, body, aad);
        res.setHeader("X-Encrypted", "1");
        return plainJson(sealed);
      } catch {
        // Bad client key: fall back to plain JSON rather than failing the request.
        return plainJson(body);
      }
    };
    next();
  };
}
