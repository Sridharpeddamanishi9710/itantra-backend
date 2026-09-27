import { NextResponse } from "next/server";
import { prisma } from "@itantra/database";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ channelId: string }> }
) {
  try {
    const { channelId } = await params;
    const channel = await prisma.tacticalChannel.findUnique({
      where: { channelId },
      include: {
        members: {
          where: { isActive: true },
          select: {
            callsign: true,
            joinedAt: true,
            isActive: true,
          },
          orderBy: { joinedAt: "asc" },
        },
      },
    });

    if (!channel) {
      return NextResponse.json(
        { success: false, error: "CHANNEL_NOT_FOUND" },
        { status: 404 }
      );
    }

    const { members, ...channelInfo } = channel;
    return NextResponse.json({
      success: true,
      channel: channelInfo,
      totalActiveMembers: members.length,
      members,
    });
  } catch (error) {
    console.error("Channel member listing error:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}