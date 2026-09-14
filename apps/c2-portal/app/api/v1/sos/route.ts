import { NextRequest, NextResponse } from "next/server";
import { prisma, Prisma } from "@itantra/database";
import { z } from "zod";
import { validateTacticalAuth } from "../../../../lib/auth";

const SosPayloadSchema = z.object({
  senderCallsign: z.string().min(1).max(32),
  recipientCallsign: z.string().default("BROADCAST_ALL"),
  sourceLanguage: z.string().default("en"),
  targetLanguage: z.string().default("en"),
  compactTextPayload: z.string().min(1),
  transportUsed: z.enum([
    "WIFI_DIRECT",
    "TACTICAL_GATEWAY",
    "BLE",
    "BLUETOOTH_LE",
    "SATELLITE",
    "TACTICAL_UPLINK",
  ]),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  alertType: z.string().default("CRITICAL_SOS_BROADCAST"),
});

const STREAM_GATEWAY_URL =
  process.env.STREAM_GATEWAY_URL || "http://localhost:8443";

export async function POST(req: NextRequest) {
  // 1. Tactical Authentication & Header Guard
  const auth = validateTacticalAuth(req);

  if (!auth.authenticated) {
    return auth.errorResponse!;
  }

  try {
    const body = await req.json();
    const validated = SosPayloadSchema.parse(body);

    // 2. Ensure transceiver node exists and record heartbeat
    await prisma.transceiver.upsert({
      where: {
        callsign: validated.senderCallsign,
      },
      update: {
        lastHeartbeat: new Date(),
      },
      create: {
        deviceId: `DEV-${validated.senderCallsign}`,
        callsign: validated.senderCallsign,
        primaryTransport: validated.transportUsed as any,
      },
    });

    // 3. Atomically persist transmission and declare active emergency incident
    const incident = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        const transmission = await tx.transmission.create({
          data: {
            senderCallsign: validated.senderCallsign,
            recipientCallsign: validated.recipientCallsign,
            sourceLanguage: validated.sourceLanguage,
            targetLanguage: validated.targetLanguage,
            compactTextPayload: validated.compactTextPayload,
            payloadByteSize: Buffer.byteLength(
              validated.compactTextPayload,
              "utf8"
            ),
            priority: "PRIORITY_EMERGENCY_SOS" as any,
            transportUsed: validated.transportUsed as any,
            latitude: validated.latitude,
            longitude: validated.longitude,
            status: "DISPATCHED" as any,
          },
        });

        const emergency = await tx.emergencyIncident.create({
          data: {
            packetId: transmission.packetId,
            initiatingCallsign: validated.senderCallsign,
            alertType: validated.alertType,
            status: "ACTIVE_DISPATCH" as any,
          },
        });

        return {
          transmission,
          emergency,
        };
      }
    );

    // 4. Broadcast live override to WebSocket Gateway
    try {
      const broadcastPayload = {
        action: "BROADCAST_MESSAGE",
        channel: "EMERGENCY_BROADCAST",
        event: "CRITICAL_SOS_TRIGGERED",
        data: {
          incidentId: incident.emergency.incidentId,
          packetId: incident.transmission.packetId,
          senderCallsign: validated.senderCallsign,
          compactTextPayload: validated.compactTextPayload,
          transportUsed: validated.transportUsed,
          latitude: validated.latitude,
          longitude: validated.longitude,
          timestamp: incident.emergency.createdAt,
        },
      };

      fetch(`${STREAM_GATEWAY_URL}/broadcast`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(broadcastPayload),
      }).catch((err: Error) => {
        console.warn(
          "[C2-PORTAL] Gateway broadcast listener offline:",
          err.message
        );
      });
    } catch (relayErr: any) {
      console.warn(
        "[C2-PORTAL] Gateway broadcast dispatch failed:",
        relayErr.message
      );
    }

    return NextResponse.json(
      {
        success: true,
        incidentId: incident.emergency.incidentId,
        packetId: incident.transmission.packetId,
        status: incident.emergency.status,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[C2-PORTAL] SOS route exception:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error.errors ||
          error.message ||
          "Internal server error",
      },
      {
        status: error.name === "ZodError" ? 400 : 500,
      }
    );
  }
}