import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const TACTICAL_SECRET = process.env.JWT_TACTICAL_SECRET || "iTantra-Tactical-Auth-Secret-2026";
const DEV_BYPASS_TOKEN = process.env.TACTICAL_BEARER_TOKEN || "DEV_TACTICAL_TOKEN_2026";

export interface TacticalTokenPayload {
  callsign: string;
  deviceId: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Generate an HMAC-SHA256 signed session token for a transceiver
 */
export function issueTacticalToken(callsign: string, deviceId: string, ttlHours = 168): string {
  const payload: TacticalTokenPayload = {
    callsign,
    deviceId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + ttlHours * 60 * 60 * 1000,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", TACTICAL_SECRET)
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Verify and decode an HMAC-SHA256 signed tactical session token
 */
export function verifyTacticalToken(token: string): TacticalTokenPayload | null {
  try {
    const [payloadB64, signature] = token.split(".");
    if (!payloadB64 || !signature) return null;

    const expectedSig = crypto
      .createHmac("sha256", TACTICAL_SECRET)
      .update(payloadB64)
      .digest("base64url");

    if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      const payload: TacticalTokenPayload = JSON.parse(
        Buffer.from(payloadB64, "base64url").toString("utf8")
      );

      if (Date.now() > payload.expiresAt) {
        return null; // Expired
      }
      return payload;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Validates transceiver headers across mutating tactical API endpoints
 */
export function validateTacticalAuth(req: NextRequest): {
  authenticated: boolean;
  errorResponse?: NextResponse;
  callsign?: string;
} {
  const callsignHeader = req.headers.get("x-transceiver-callsign");
  const authHeader = req.headers.get("authorization");

  const isDevMode =
    process.env.NODE_ENV !== "production" || process.env.AUTH_BYPASS_DEV === "true";

  if (!callsignHeader || callsignHeader.trim() === "") {
    return {
      authenticated: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: "UNAUTHORIZED_MISSING_CALLSIGN_HEADER",
          message: "Header 'x-transceiver-callsign' is required.",
        },
        { status: 401 }
      ),
    };
  }

  // If token is provided, verify it
  if (authHeader) {
    const rawToken = authHeader.startsWith("Bearer ")
      ? authHeader.substring(7).trim()
      : authHeader.trim();

    // 1. Check dev static token override
    if (rawToken === DEV_BYPASS_TOKEN) {
      return { authenticated: true, callsign: callsignHeader };
    }

    // 2. Cryptographic signature check
    const verified = verifyTacticalToken(rawToken);
    if (!verified) {
      return {
        authenticated: false,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: "UNAUTHORIZED_INVALID_TOKEN",
            message: "Tactical session token signature mismatch or expired.",
          },
          { status: 401 }
        ),
      };
    }

    // Verify token binds to the stated callsign
    if (verified.callsign !== callsignHeader) {
      return {
        authenticated: false,
        errorResponse: NextResponse.json(
          {
            success: false,
            error: "UNAUTHORIZED_CALLSIGN_MISMATCH",
            message: "Token was issued for a different callsign.",
          },
          { status: 403 }
        ),
      };
    }

    return { authenticated: true, callsign: verified.callsign };
  }

  // If token is omitted, permit in local dev mode if callsign present
  if (!isDevMode) {
    return {
      authenticated: false,
      errorResponse: NextResponse.json(
        {
          success: false,
          error: "UNAUTHORIZED_MISSING_BEARER_TOKEN",
          message: "Authorization Bearer token is required in production.",
        },
        { status: 401 }
      ),
    };
  }

  return { authenticated: true, callsign: callsignHeader };
}