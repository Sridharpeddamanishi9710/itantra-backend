import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";
import { resolveChannelCallsign } from "../../../../../../../lib/channel-auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ channelId: string; callsign: string }> }
) {
  try {
    const { channelId, callsign: rawCallsign } = await params;
    const callsign = rawCallsign.trim();

    if (!channelId || channelId.length > 64 || !callsign || callsign.length > 32) {
      return NextResponse.json(
        { success: false, error: "INVALID_CHANNEL_OR_CALLSIGN" },
        { status: 400 }
      );
    }

    const auth = resolveChannelCallsign(req, callsign);
    if (auth.errorResponse) return auth.errorResponse;

    const channel = await prisma.tacticalChannel.findUnique({
      where: { channelId },
      select: { channelId: true },
    });

    if (!channel) {
      return NextResponse.json(
        { success: false, error: "CHANNEL_NOT_FOUND" },
        { status: 404 }
      );
    }

    const membership = await prisma.channelMember.findUnique({
      where: { channelId_callsign: { channelId, callsign: auth.callsign } },
    });

    if (!membership || !membership.isActive) {
      return NextResponse.json({
        success: true,
        message: "Membership is already inactive",
        membership: membership ?? { channelId, callsign, isActive: false },
      });
    }

    const updatedMembership = await prisma.channelMember.update({
      where: { id: membership.id },
      data: { isActive: false },
    });

    return NextResponse.json({
      success: true,
      message: `Transceiver ${callsign} left channel ${channelId}`,
      membership: updatedMembership,
    });
  } catch (error) {
    console.error("Channel leave error:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}