import { NextRequest, NextResponse } from "next/server";

// Standard iTantra Tactical Operational Channels
const TACTICAL_CHANNELS = [
  {
    channelId: "chan-emergency-01",
    name: "EMERGENCY_BROADCAST",
    description: "High-priority emergency distress and override channel",
    frequencyMhz: 433.175,
    isEncrypted: false,
    activeSubscribers: 12,
  },
  {
    channelId: "chan-cmd-net-02",
    name: "COMMAND_NET",
    description: "Squad lead and command telemetry channel",
    frequencyMhz: 434.250,
    isEncrypted: true,
    activeSubscribers: 6,
  },
  {
    channelId: "chan-sector4-03",
    name: "SECTOR_4_TAC",
    description: "Local ground patrol and sector 4 coordination",
    frequencyMhz: 868.100,
    isEncrypted: true,
    activeSubscribers: 4,
  },
];

// GET /api/v1/channels -> List operational channels
export async function GET() {
  return NextResponse.json(
    {
      success: true,
      totalChannels: TACTICAL_CHANNELS.length,
      channels: TACTICAL_CHANNELS,
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

// POST /api/v1/channels -> Join / Register a transceiver to a channel
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { callsign, channelId } = body;

    if (!callsign || !channelId) {
      return NextResponse.json(
        { success: false, error: "MISSING_CALLSIGN_OR_CHANNEL_ID" },
        { status: 400 }
      );
    }

    const matchedChannel = TACTICAL_CHANNELS.find((c) => c.channelId === channelId);

    if (!matchedChannel) {
      return NextResponse.json(
        { success: false, error: "CHANNEL_NOT_FOUND" },
        { status: 404 }
      );
    }

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
              joinedAt: new Date().toISOString(),
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