import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";
import { z } from "zod";
import { validateTacticalAuth } from "@/lib/auth";

const IngestPayloadSchema = z.object({
  senderCallsign: z.string().min(1).max(32),
  recipientCallsign: z.string().default("BROADCAST_ALL"),
  sourceLanguage: z.string().default("en"),
  targetLanguage: z.string().default("en"),
  compactTextPayload: z.string().min(1),
  priority: z
    .enum(["PRIORITY_ROUTINE", "PRIORITY_URGENT", "PRIORITY_EMERGENCY_SOS"])
    .default("PRIORITY_ROUTINE"),
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
  compressionRatio: z.number().optional(),
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
    const validated = IngestPayloadSchema.parse(body);

    // 2. Upsert transceiver heartbeat and record
    await prisma.transceiver.upsert({
      where: { callsign: validated.senderCallsign },
      update: {
        lastHeartbeat: new Date(),
      },
      create: {
        deviceId: `DEV-${validated.senderCallsign}`,
        callsign: validated.senderCallsign,
        primaryTransport: validated.transportUsed as any,
      },
    });

    // 3. Persist transmission record with type casting
    const transmission = await prisma.transmission.create({
      data: {
        senderCallsign: validated.senderCallsign,
        recipientCallsign: validated.recipientCallsign,
        sourceLanguage: validated.sourceLanguage,
        targetLanguage: validated.targetLanguage,
        compactTextPayload: validated.compactTextPayload,
        payloadByteSize: Buffer.byteLength(validated.compactTextPayload, "utf8"),
        priority: validated.priority as any,
        transportUsed: validated.transportUsed as any,
        latitude: validated.latitude,
        longitude: validated.longitude,
        status: "DELIVERED" as any,
      },
    });

    // 4. Relay packet to Tactical Stream Gateway over TELEMETRY channel
    try {
      const broadcastPayload = {
        action: "BROADCAST_MESSAGE",
        channel: "TELEMETRY",
        event: "INGEST_PACKET_RECEIVED",
        data: {
          packetId: transmission.packetId,
          callsign: validated.senderCallsign,
          recipient: validated.recipientCallsign,
          text: validated.compactTextPayload,
          transport: validated.transportUsed,
          priority: validated.priority,
          latitude: validated.latitude,
          longitude: validated.longitude,
          timestamp: new Date().toISOString(),
        },
      };

      fetch(`${STREAM_GATEWAY_URL}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(broadcastPayload),
      }).catch((err: Error) => {
        console.warn("[C2-PORTAL] Telemetry broadcast drop:", err.message);
      });
    } catch (err: any) {
      console.warn("[C2-PORTAL] Telemetry dispatch error:", err.message);
    }

    return NextResponse.json(
      {
        success: true,
        packetId: transmission.packetId,
        status: transmission.status,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[C2-PORTAL] Ingest exception:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.errors || error.message || "Ingest processing failure",
      },
      { status: error.name === "ZodError" ? 400 : 500 }
    );
  }
}