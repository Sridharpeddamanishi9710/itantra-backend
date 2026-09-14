import { NextResponse } from "next/server";

export async function GET() {
  const timestamp = new Date().toISOString();
  
  return NextResponse.json(
    {
      status: "HEALTHY",
      uptime: process.uptime(),
      timestamp,
      services: {
        c2Portal: "UP",
        streamGateway: "UP",
        database: "CONNECTED",
      },
    },
    { status: 200 }
  );
}