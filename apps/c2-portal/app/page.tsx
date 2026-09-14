"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { MapMarkerData } from "../components/TacticalMap";

// Disable SSR for Leaflet map component
const TacticalMap = dynamic(() => import("../components/TacticalMap"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] rounded-lg border border-slate-800 bg-slate-900/50 flex items-center justify-center font-mono text-xs text-slate-500">
      INITIALIZING GEOSPATIAL RADAR...
    </div>
  ),
});

interface EmergencyAlert {
  incidentId: string;
  packetId: string;
  callsign: string;
  text: string;
  transport: string;
  latitude?: number;
  longitude?: number;
  timestamp: string;
}

export default function TacticalDashboard() {
  const [gatewayStatus, setGatewayStatus] = useState<"CONNECTING" | "ONLINE" | "DISCONNECTED">("CONNECTING");
  const [alerts, setAlerts] = useState<EmergencyAlert[]>([]);
  const [recentLogs, setRecentLogs] = useState<string[]>([]);
  const [mapMarkers, setMapMarkers] = useState<MapMarkerData[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8443");
    socketRef.current = ws;

    ws.onopen = () => {
      setGatewayStatus("ONLINE");
      setRecentLogs((prev) => [
        `[${new Date().toLocaleTimeString()}] Connected to stream gateway on :8443`,
        ...prev,
      ]);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        console.log("[WS INCOMING]", payload);

        // Normalize payload: handle nested data object or root object
        const raw = payload.data || payload;
        const eventType = payload.event || payload.type || "";

        if (!raw) return;

        const callsign = raw.senderCallsign || raw.callsign || "UNKNOWN_NODE";
        const text = raw.compactTextPayload || raw.text || "NO DETAILS";
        const transport = raw.transportUsed || raw.transport || "UNKNOWN";
        const lat = raw.latitude !== undefined && raw.latitude !== null ? Number(raw.latitude) : undefined;
        const lng = raw.longitude !== undefined && raw.longitude !== null ? Number(raw.longitude) : undefined;

        // 1. Critical SOS Dispatch Event
        const isEmergency =
          eventType === "CRITICAL_SOS_TRIGGERED" ||
          eventType === "EMERGENCY_SOS" ||
          Boolean(raw.incidentId);

        if (isEmergency) {
          const alertItem: EmergencyAlert = {
            incidentId: raw.incidentId || `${Date.now()}`,
            packetId: raw.packetId || "",
            callsign,
            text,
            transport,
            latitude: lat,
            longitude: lng,
            timestamp: raw.timestamp || new Date().toISOString(),
          };

          setAlerts((prev) => [alertItem, ...prev]);
          setRecentLogs((prev) => [
            `[${new Date().toLocaleTimeString()}] SOS: ${callsign} - ${text}`,
            ...prev,
          ]);

          if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
            setMapMarkers((prev) => [
              {
                id: alertItem.incidentId,
                callsign,
                text,
                transport,
                latitude: lat,
                longitude: lng,
                isEmergency: true,
              },
              ...prev,
            ]);
          }
          return;
        }

        // 2. Routine Ingestion / Telemetry Event
        setRecentLogs((prev) => [
          `[${new Date().toLocaleTimeString()}] TELEMETRY: ${callsign} [${transport}] - ${text}`,
          ...prev,
        ]);

        if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
          setMapMarkers((prev) => [
            {
              id: raw.packetId || `${Date.now()}`,
              callsign,
              text,
              transport,
              latitude: lat,
              longitude: lng,
              isEmergency: false,
            },
            ...prev,
          ]);
        }
      } catch (err) {
        console.error("Message processing error:", err);
      }
    };

    ws.onerror = () => {
      setGatewayStatus("DISCONNECTED");
      setRecentLogs((prev) => [`[${new Date().toLocaleTimeString()}] Socket error`, ...prev]);
    };

    ws.onclose = () => {
      setGatewayStatus("DISCONNECTED");
      setRecentLogs((prev) => [`[${new Date().toLocaleTimeString()}] Disconnected from gateway`, ...prev]);
    };

    return () => {
      ws.close();
    };
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-6 max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-wide text-white">iTantra C2 Tactical Portal</h1>
          <p className="text-sm text-slate-400">Tactical Node & Incident Command Stream</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-400">GATEWAY :8443</span>
          <span
            className={`px-3 py-1 text-xs font-semibold rounded-full border ${
              gatewayStatus === "ONLINE"
                ? "bg-emerald-950 text-emerald-400 border-emerald-800"
                : gatewayStatus === "CONNECTING"
                ? "bg-amber-950 text-amber-400 border-amber-800 animate-pulse"
                : "bg-red-950 text-red-400 border-red-800"
            }`}
          >
            {gatewayStatus}
          </span>
        </div>
      </header>

      {/* Geospatial Map Section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Geospatial Tactical Radar
          </h2>
          <span className="text-xs font-mono text-slate-500">
            {mapMarkers.length} Active Targets
          </span>
        </div>
        <TacticalMap markers={mapMarkers} />
      </section>

      {/* Grid: SOS Incidents & Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-200">Active SOS Dispatches</h2>
            <span className="text-xs font-mono bg-slate-800 px-2.5 py-0.5 rounded text-slate-300">
              {alerts.length} Incidents
            </span>
          </div>

          {alerts.length === 0 ? (
            <div className="p-8 border border-dashed border-slate-800 rounded-lg text-center text-slate-500">
              No emergency incidents reported. Listening on channel{" "}
              <span className="font-mono text-slate-400">EMERGENCY_BROADCAST</span>...
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((item, idx) => (
                <div
                  key={item.incidentId || idx}
                  className="p-4 rounded-lg bg-red-950/30 border border-red-800/60 flex flex-col gap-2 transition hover:border-red-600"
                >
                  <div className="flex justify-between items-center">
                    <span className="px-2 py-0.5 text-xs font-bold bg-red-600 text-white rounded">
                      FLASH OVERRIDE
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      {item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : "LIVE"}
                    </span>
                  </div>

                  <p className="text-base font-medium text-slate-100">{item.text}</p>

                  <div className="flex flex-wrap gap-4 text-xs font-mono text-slate-300 pt-2 border-t border-red-900/40">
                    <div>
                      <span className="text-slate-500">Callsign: </span>
                      <span className="text-amber-400 font-bold">{item.callsign}</span>
                    </div>
                    <div>
                      <span className="text-slate-500">Transport: </span>
                      <span>{item.transport}</span>
                    </div>
                    {item.latitude !== undefined && item.longitude !== undefined && (
                      <div>
                        <span className="text-slate-500">Location: </span>
                        <span>{item.latitude.toFixed(4)}, {item.longitude.toFixed(4)}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="border border-slate-800 bg-slate-900/40 rounded-lg p-4 flex flex-col h-[480px]">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400 mb-3 border-b border-slate-800 pb-2">
            Gateway Telemetry Log
          </h2>
          <div className="flex-1 overflow-y-auto font-mono text-xs text-slate-300 space-y-2 pr-2">
            {recentLogs.map((log, i) => (
              <div key={i} className="leading-relaxed border-b border-slate-900/60 pb-1 text-slate-400">
                {log}
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}