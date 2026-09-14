import { NextResponse } from "next/server";
import { prisma } from "@itantra/database";

export async function GET() {
  try {
    const activeIncidents = await prisma.emergencyIncident.findMany({
      where: {
        status: "ACTIVE_DISPATCH",
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      {
        success: true,
        totalActive: activeIncidents.length,
        incidents: activeIncidents,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[INCIDENTS ROUTE] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch active incidents" },
      { status: 500 }
    );
  }
}