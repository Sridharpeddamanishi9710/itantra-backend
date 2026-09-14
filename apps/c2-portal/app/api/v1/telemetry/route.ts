import { NextRequest, NextResponse } from "next/server";

interface TelemetryInput {
  callsign: string;
  batteryPercent: number;
  signalStrengthDbm?: number;
  transportType: "WIFI_DIRECT" | "TACTICAL_GATEWAY" | "BLE";
  latitude?: number;
  longitude?: number;
  nodeTemperatureC?: number;
}

export async function POST(req: NextRequest) {
  try {
    const body: TelemetryInput = await req.json();

    if (!body.callsign || body.batteryPercent === undefined || !body.transportType) {
      return NextResponse.json(
        { success: false, error: "MISSING_REQUIRED_FIELDS" },
        { status: 400 }
      );
    }

    const telemetryReport = {
      reportId: crypto.randomUUID(),
      callsign: body.callsign,
      batteryPercent: Number(body.batteryPercent),
      signalStrengthDbm: body.signalStrengthDbm ?? -70,
      transportType: body.transportType,
      latitude: body.latitude ? Number(body.latitude) : null,
      longitude: body.longitude ? Number(body.longitude) : null,
      nodeTemperatureC: body.nodeTemperatureC ?? 35.0,
      timestamp: new Date().toISOString(),
    };

    // Forward to WebSocket stream gateway so dashboard operator sees live hardware stats
    try {
      const socket = new WebSocket("ws://localhost:8443");
      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            action: "BROADCAST_MESSAGE",
            channel: "TELEMETRY",
            event: "NODE_DIAGNOSTICS_RECEIVED",
            data: telemetryReport,
          })
        );
        socket.close();
      };
    } catch {
      // Non-fatal if gateway is temporarily cycling
    }

    return NextResponse.json(
      {
        success: true,
        reportId: telemetryReport.reportId,
        status: "RECORDED",
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("Telemetry processing failed:", error);
    return NextResponse.json(
      { success: false, error: "INTERNAL_SERVER_ERROR" },
      { status: 500 }
    );
  }
}