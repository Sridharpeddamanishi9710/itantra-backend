import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";
import { resolveChannelCallsign } from "../../../../lib/channel-auth";

// GET /api/v1/channels -> List operational channels
export async function GET() {
  try {
    const channels = await prisma.tacticalChannel.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      include: {
        members: {
          where: { isActive: true },
          select: { id: true },
        },
      },
    });

    return NextResponse.json(
      {
        success: true,
        totalChannels: channels.length,
        channels: channels.map(({ members, ...channel }) => ({
          ...channel,
          activeSubscribers: members.length,
        })),
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Channel listing error:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}

// POST /api/v1/channels -> Join / Register a transceiver to a channel
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const bodyCallsign = typeof body.callsign === "string" ? body.callsign.trim() : "";
    const channelId = typeof body.channelId === "string" ? body.channelId.trim() : "";

    if (!bodyCallsign || bodyCallsign.length > 32 || !channelId || channelId.length > 64) {
      return NextResponse.json(
        { success: false, error: "MISSING_CALLSIGN_OR_CHANNEL_ID" },
        { status: 400 }
      );
    }

    const auth = resolveChannelCallsign(req, bodyCallsign);
    if (auth.errorResponse) return auth.errorResponse;
    const callsign = auth.callsign;

    const matchedChannel = await prisma.tacticalChannel.findUnique({
      where: { channelId },
    });

    if (!matchedChannel) {
      return NextResponse.json(
        { success: false, error: "CHANNEL_NOT_FOUND" },
        { status: 404 }
      );
    }

    if (!matchedChannel.isActive) {
      return NextResponse.json(
        { success: false, error: "CHANNEL_INACTIVE" },
        { status: 409 }
      );
    }

    const membership = await prisma.channelMember.upsert({
      where: {
        channelId_callsign: { channelId, callsign },
      },
      update: { isActive: true },
      create: { channelId, callsign },
    });

    // Broadcast member joined notification to Gateway
    try {
      const socket = new WebSocket("ws://localhost:8443");
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            action: "BROADCAST_MESSAGE",
            channel: matchedChannel.name,
            event: "TRANSCEIVER_JOINED_CHANNEL",
            data: {
              callsign,
              channelId,
              channelName: matchedChannel.name,
              joinedAt: membership.joinedAt.toISOString(),
            },
          })
        );
        socket.close();
      };
    } catch {
      // Non-blocking if gateway is busy
    }

    return NextResponse.json(
      {
        success: true,
        message: `Transceiver ${callsign} assigned to channel ${matchedChannel.name}`,
        assignment: {
          callsign,
          channelId: matchedChannel.channelId,
          channelName: matchedChannel.name,
          frequencyMhz: matchedChannel.frequencyMhz,
          isEncrypted: matchedChannel.isEncrypted,
        },
        membership: {
          id: membership.id,
          callsign: membership.callsign,
          channelId: membership.channelId,
          joinedAt: membership.joinedAt,
          isActive: membership.isActive,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Channel assignment error:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}