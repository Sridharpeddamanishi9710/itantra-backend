import { NextRequest, NextResponse } from "next/server";
import { validateTacticalAuth } from "./auth";

export function resolveChannelCallsign(
  req: NextRequest,
  requestedCallsign: string
): { callsign: string; errorResponse?: never } | { callsign?: never; errorResponse: NextResponse } {
  const hasAuthContext =
    req.headers.has("authorization") ||
    req.headers.has("x-transceiver-callsign");

  if (!hasAuthContext && process.env.NODE_ENV !== "production") {
    return { callsign: requestedCallsign };
  }

  const auth = validateTacticalAuth(req);
  if (!auth.authenticated || !auth.callsign) {
    return {
      errorResponse:
        auth.errorResponse ??
        NextResponse.json({ success: false, error: "UNAUTHORIZED" }, { status: 401 }),
    };
  }

  if (auth.callsign !== requestedCallsign) {
    return {
      errorResponse: NextResponse.json(
        { success: false, error: "UNAUTHORIZED_CALLSIGN_MISMATCH" },
        { status: 403 }
      ),
    };
  }

  return { callsign: auth.callsign };
}