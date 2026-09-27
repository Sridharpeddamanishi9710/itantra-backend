import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@itantra/database";
import { validateTacticalAuth } from "../../../../../lib/auth";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { incidentId: string } }
) {
  const auth = validateTacticalAuth(req);

  if (!auth.authenticated) {
    return auth.errorResponse!;
  }

  try {
    const body = await req.json();
    const { action, responder } = body;

    const incident = await prisma.emergencyIncident.findUnique({
      where: {
        incidentId: params.incidentId,
      },
    });

    if (!incident) {
      return NextResponse.json(
        {
          success: false,
          error: "INCIDENT_NOT_FOUND",
        },
        { status: 404 }
      );
    }

    if (action === "ASSIGN") {
      if (!responder || typeof responder !== "string") {
        return NextResponse.json(
          {
            success: false,
            error: "RESPONDER_REQUIRED",
          },
          { status: 400 }
        );
      }

      const updated = await prisma.emergencyIncident.update({
        where: {
          incidentId: params.incidentId,
        },
        data: {
          firstResponderAssigned: responder,
          status: "RESPONDER_ASSIGNED",
        },
      });

      return NextResponse.json({
        success: true,
        action: "ASSIGN",
        incident: updated,
      });
    }

    if (action === "RESOLVE") {
      const updated = await prisma.emergencyIncident.update({
        where: {
          incidentId: params.incidentId,
        },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
        },
      });

      return NextResponse.json({
        success: true,
        action: "RESOLVE",
        incident: updated,
      });
    }

    return NextResponse.json(
      {
        success: false,
        error: "INVALID_ACTION",
        allowedActions: ["ASSIGN", "RESOLVE"],
      },
      { status: 400 }
    );
  } catch (error: any) {
    console.error("[INCIDENT UPDATE] Error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Incident update failed",
      },
      { status: 500 }
    );
  }
}