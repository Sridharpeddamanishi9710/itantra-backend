"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";

// Fix default Leaflet icon paths in Next.js bundler
const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

export interface MapMarkerData {
  id: string;
  callsign: string;
  text: string;
  transport: string;
  latitude: number;
  longitude: number;
  isEmergency?: boolean;
}

function MapCenterController({ coords }: { coords: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(coords, map.getZoom());
  }, [coords, map]);
  return null;
}

export default function TacticalMap({ markers }: { markers: MapMarkerData[] }) {
  const defaultCenter: [number, number] =
    markers.length > 0
      ? [markers[0].latitude, markers[0].longitude]
      : [17.3850, 78.4867];

  return (
    <div className="w-full h-[400px] rounded-lg overflow-hidden border border-slate-800 relative z-0">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        className="w-full h-full"
      >
        <MapCenterController coords={defaultCenter} />

        {/* Free, keyless dark tactical layer via inverted OpenStreetMap tiles */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          className="tactical-tile-invert"
        />

        {markers.map((m) => (
          <Marker
            key={m.id}
            position={[m.latitude, m.longitude]}
            icon={markerIcon}
          >
            <Popup className="tactical-popup">
              <div className="text-slate-900 font-sans text-xs space-y-1">
                <p className="font-bold text-sm text-red-600">
                  {m.isEmergency ? "🚨 SOS ALERT" : "📍 TELEMETRY"}
                </p>
                <p>
                  <strong>Callsign:</strong> {m.callsign}
                </p>
                <p>
                  <strong>Transport:</strong> {m.transport}
                </p>
                <p>
                  <strong>Payload:</strong> {m.text}
                </p>
                <p className="text-slate-500 font-mono">
                  {m.latitude.toFixed(4)}, {m.longitude.toFixed(4)}
                </p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}