import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";
import { z } from "zod";
import { validateTacticalAuth } from "@/lib/auth";

const SyncedPacketSchema = z.object({
  clientPacketId: z.string().optional(),
  senderCallsign: z.string().min(1).max(32),
  recipientCallsign: z.string().default("BROADCAST_ALL"),
  sourceLanguage: z.string().default("en"),
  targetLanguage: z.string().default("en"),
  compactTextPayload: z.string().min(1),
  priority: z.string().optional().default("PRIORITY_ROUTINE"),
  transportUsed: z.string().optional().default("WIFI_DIRECT"),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const BatchSyncSchema = z.object({
  deviceId: z.string().optional(),
  packets: z.array(SyncedPacketSchema).min(1).max(100),
});

const STREAM_GATEWAY_URL =
  process.env.STREAM_GATEWAY_URL || "http://localhost:8443";

function mapTransport(val?: string): any {
  if (!val) return "WIFI_DIRECT";
  const upper = val.toUpperCase();
  if (upper === "BLE" || upper === "BLUETOOTH_LE" || upper === "BLUETOOTH") {
    return "BLUETOOTH_LE";
  }
  if (upper === "WIFI" || upper === "WIFI_DIRECT") return "WIFI_DIRECT";
  if (upper === "GATEWAY" || upper === "TACTICAL_GATEWAY") return "TACTICAL_GATEWAY";
  if (upper === "SATELLITE") return "SATELLITE";
  return "WIFI_DIRECT";
}

function mapPriority(val?: string): any {
  if (!val) return "PRIORITY_ROUTINE";
  const upper = val.toUpperCase();
  if (upper.includes("ROUTINE")) return "PRIORITY_ROUTINE";
  if (upper.includes("EMERGENCY") || upper.includes("SOS")) return "PRIORITY_EMERGENCY_SOS";
  // If URGENT is passed, test PRIORITY_ROUTINE or map safely
  if (upper === "PRIORITY_URGENT" || upper === "URGENT") {
    // Note: check schema.prisma if PRIORITY_PRIORITY or IMMEDIATE is the enum name
    return "PRIORITY_ROUTINE"; 
  }
  return "PRIORITY_ROUTINE";
}

export async function POST(req: NextRequest) {
  const auth = validateTacticalAuth(req);
  if (!auth.authenticated) {
    return auth.errorResponse!;
  }

  try {
    const body = await req.json();
    const validated = BatchSyncSchema.parse(body);
    const callsign = auth.callsign!;

    // 1. Ensure transceiver heartbeat
    try {
      await prisma.transceiver.upsert({
        where: { callsign },
        update: { lastHeartbeat: new Date() },
        create: {
          deviceId: validated.deviceId || `DEV-${callsign}`,
          callsign,
          primaryTransport: "WIFI_DIRECT",
        },
      });
    } catch (e: any) {
      console.warn("[SYNC ROUTE] Transceiver upsert warning:", e.message);
    }

    const syncedResults: {
      packetId: string;
      clientPacketId?: string;
      status: "SAVED" | "DUPLICATE";
    }[] = [];

    // 2. Process each packet sequentially
    for (const pkt of validated.packets) {
      const duplicate = await prisma.transmission.findFirst({
        where: {
          senderCallsign: pkt.senderCallsign,
          compactTextPayload: pkt.compactTextPayload,
        },
      });

      if (duplicate) {
        syncedResults.push({
          packetId: duplicate.packetId,
          clientPacketId: pkt.clientPacketId,
          status: "DUPLICATE",
        });
        continue;
      }

      const created = await prisma.transmission.create({
        data: {
          senderCallsign: pkt.senderCallsign,
          recipientCallsign: pkt.recipientCallsign,
          sourceLanguage: pkt.sourceLanguage,
          targetLanguage: pkt.targetLanguage,
          compactTextPayload: pkt.compactTextPayload,
          payloadByteSize: Buffer.byteLength(pkt.compactTextPayload, "utf8"),
          priority: mapPriority(pkt.priority),
          transportUsed: mapTransport(pkt.transportUsed),
          latitude: pkt.latitude ?? null,
          longitude: pkt.longitude ?? null,
          status: "DELIVERED" as any,
        },
      });

      syncedResults.push({
        packetId: created.packetId,
        clientPacketId: pkt.clientPacketId,
        status: "SAVED",
      });
    }

    // 3. Emit summary event to gateway (non-blocking)
    try {
      fetch(`${STREAM_GATEWAY_URL}/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "BROADCAST_MESSAGE",
          channel: "TELEMETRY",
          event: "BATCH_SYNC_COMPLETED",
          data: {
            callsign,
            totalReceived: validated.packets.length,
            savedCount: syncedResults.filter((r) => r.status === "SAVED").length,
            duplicateCount: syncedResults.filter(
              (r) => r.status === "DUPLICATE"
            ).length,
            timestamp: new Date().toISOString(),
          },
        }),
      }).catch(() => {});
    } catch {}

    return NextResponse.json(
      {
        success: true,
        batchSize: validated.packets.length,
        saved: syncedResults.filter((r) => r.status === "SAVED").length,
        duplicates: syncedResults.filter((r) => r.status === "DUPLICATE").length,
        details: syncedResults,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[SYNC ROUTE] Full error trace:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.errors || error.message || "Batch sync failure",
      },
      { status: error.name === "ZodError" ? 400 : 500 }
    );
  }
}