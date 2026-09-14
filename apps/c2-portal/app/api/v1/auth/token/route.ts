import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";
import { z } from "zod";
import { issueTacticalToken } from "@/lib/auth";

const TokenRequestSchema = z.object({
  callsign: z.string().min(1).max(32),
  deviceId: z.string().min(1).max(64),
  hardwareInfo: z
    .object({
      model: z.string().optional(),
      platform: z.string().optional(),
      appVersion: z.string().optional(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = TokenRequestSchema.parse(body);

    // Register or update transceiver status and heartbeat in database
    const transceiver = await prisma.transceiver.upsert({
      where: { callsign: validated.callsign },
      update: {
        lastHeartbeat: new Date(),
      },
      create: {
        deviceId: validated.deviceId,
        callsign: validated.callsign,
        primaryTransport: "WIFI_DIRECT",
      },
    });

    // Issue cryptographic tactical session token valid for 7 days
    const token = issueTacticalToken(validated.callsign, validated.deviceId, 168);
    const expiresAt = new Date(Date.now() + 168 * 60 * 60 * 1000).toISOString();

    return NextResponse.json(
      {
        success: true,
        token,
        tokenType: "Bearer",
        expiresAt,
        transceiver: {
          callsign: transceiver.callsign,
          deviceId: transceiver.deviceId,
          registeredAt: transceiver.registeredAt,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[AUTH ROUTE] Token issuance error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.errors || error.message || "Failed to issue tactical token",
      },
      { status: error.name === "ZodError" ? 400 : 500 }
    );
  }
}