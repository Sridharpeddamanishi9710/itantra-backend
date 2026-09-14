import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params;
    const { searchParams } = new URL(req.url);

    const limit = Math.min(parseInt(searchParams.get("limit") || "50", 10), 100);

    const whereClause: any = {};

    if (channelId !== "all" && channelId !== "GLOBAL") {
      whereClause.OR = [
        { recipientCallsign: channelId },
        { recipientCallsign: "BROADCAST_ALL" },
      ];
    }

    const messages = await prisma.transmission.findMany({
      where: whereClause,
      take: limit,
      select: {
        packetId: true,
        senderCallsign: true,
        recipientCallsign: true,
        compactTextPayload: true,
        priority: true,
        transportUsed: true,
        latitude: true,
        longitude: true,
        status: true,
      },
    });

    const formatted = messages.map((m: any) => ({
      packetId: m.packetId,
      senderCallsign: m.senderCallsign,
      recipientCallsign: m.recipientCallsign,
      compactTextPayload: m.compactTextPayload,
      priority: m.priority,
      transportUsed: m.transportUsed,
      latitude: m.latitude,
      longitude: m.longitude,
      status: m.status,
    }));

    return NextResponse.json(
      {
        success: true,
        channelId,
        count: formatted.length,
        messages: formatted,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[MESSAGES ROUTE] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to retrieve channel messages" },
      { status: 500 }
    );
  }
}