import path from "node:path";
import protobuf from "protobufjs";

export type TransmissionPriority =
  | "PRIORITY_ROUTINE"
  | "PRIORITY_HIGH"
  | "PRIORITY_EMERGENCY_SOS"
  | "PRIORITY_URGENT";

export type RadioTransportType =
  | "WIFI_DIRECT"
  | "BLUETOOTH_LE"
  | "TACTICAL_GATEWAY"
  | "SATELLITE"
  | "TACTICAL_UPLINK";

export interface TransmissionLocation {
  latitude: number;
  longitude: number;
}

export interface TransmissionPacket {
  packetId: string;
  senderCallsign: string;
  recipientCallsign: string;
  channelId?: string;
  sourceLanguage: string;
  targetLanguage: string;
  compactTextPayload: string;
  priority: TransmissionPriority;
  transportUsed: RadioTransportType;
  location?: TransmissionLocation;
  timestamp: Date;
  signature: Uint8Array;
}

export const TRANSMISSION_PROTOBUF_CONTENT_TYPE = "application/x-protobuf";
export const MAX_TRANSMISSION_PACKET_BYTES = 64 * 1024;

const root = protobuf.loadSync(
  path.resolve(__dirname, "../proto/transmission.proto")
);
const packetType = root.lookupType(
  "itantra.transmission.v1.TransmissionPacket"
);

const priorityCodes: Record<TransmissionPriority, number> = {
  PRIORITY_ROUTINE: 1,
  PRIORITY_HIGH: 2,
  PRIORITY_EMERGENCY_SOS: 3,
  PRIORITY_URGENT: 4,
};

const transportCodes: Record<RadioTransportType, number> = {
  WIFI_DIRECT: 1,
  BLUETOOTH_LE: 2,
  TACTICAL_GATEWAY: 3,
  SATELLITE: 4,
  TACTICAL_UPLINK: 5,
};

const priorityNames = new Set(Object.keys(priorityCodes));
const transportNames = new Set(Object.keys(transportCodes));

function assertPacket(packet: TransmissionPacket): void {
  if (!packet || typeof packet !== "object") {
    throw new TypeError("A transmission packet object is required");
  }

  for (const [field, value] of Object.entries({
    packetId: packet.packetId,
    senderCallsign: packet.senderCallsign,
    recipientCallsign: packet.recipientCallsign,
    sourceLanguage: packet.sourceLanguage,
    targetLanguage: packet.targetLanguage,
    compactTextPayload: packet.compactTextPayload,
  })) {
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError(`${field} must be a non-empty string`);
    }
  }

  if (packet.channelId !== undefined && typeof packet.channelId !== "string") {
    throw new TypeError("channelId must be a string when provided");
  }

  if (!priorityNames.has(packet.priority)) {
    throw new TypeError("priority is not a supported transmission priority");
  }

  if (!transportNames.has(packet.transportUsed)) {
    throw new TypeError("transportUsed is not a supported radio transport");
  }

  if (!(packet.timestamp instanceof Date) || !Number.isSafeInteger(packet.timestamp.getTime())) {
    throw new TypeError("timestamp must be a valid Date");
  }
  if (packet.timestamp.getTime() < 0) {
    throw new RangeError("timestamp must be a non-negative Unix millisecond value");
  }

  if (!(packet.signature instanceof Uint8Array)) {
    throw new TypeError("signature must be a Uint8Array");
  }

  if (packet.location !== undefined) {
    if (
      !Number.isFinite(packet.location.latitude) ||
      !Number.isFinite(packet.location.longitude)
    ) {
      throw new TypeError("location coordinates must be finite numbers");
    }
  }
}

export function encodeTransmissionPacket(packet: TransmissionPacket): Buffer {
  assertPacket(packet);

  const message = {
    packetId: packet.packetId,
    senderCallsign: packet.senderCallsign,
    recipientCallsign: packet.recipientCallsign,
    channelId: packet.channelId ?? "",
    sourceLanguage: packet.sourceLanguage,
    targetLanguage: packet.targetLanguage,
    compactTextPayload: packet.compactTextPayload,
    priority: priorityCodes[packet.priority],
    transportUsed: transportCodes[packet.transportUsed],
    location: packet.location,
    timestampUnixMs: packet.timestamp.getTime(),
    signature: Buffer.from(packet.signature),
  };

  const verificationError = packetType.verify(message);
  if (verificationError) {
    throw new TypeError(`Invalid transmission packet: ${verificationError}`);
  }

  return Buffer.from(packetType.encode(packetType.create(message)).finish());
}

export class TransmissionPacketDecodeError extends Error {
  constructor(message = "Invalid TransmissionPacket protobuf payload") {
    super(message);
    this.name = "TransmissionPacketDecodeError";
  }
}

export function decodeTransmissionPacket(data: Uint8Array): TransmissionPacket {
  if (!(data instanceof Uint8Array)) {
    throw new TransmissionPacketDecodeError();
  }
  if (data.byteLength > MAX_TRANSMISSION_PACKET_BYTES) {
    throw new TransmissionPacketDecodeError(
      `TransmissionPacket protobuf payload exceeds the ${MAX_TRANSMISSION_PACKET_BYTES}-byte limit`
    );
  }

  try {
    const decoded = packetType.decode(data);
    const value = packetType.toObject(decoded, {
      bytes: Uint8Array,
      enums: String,
      longs: Number,
    }) as Record<string, unknown>;

    const packet: TransmissionPacket = {
      packetId: value.packetId as string,
      senderCallsign: value.senderCallsign as string,
      recipientCallsign: value.recipientCallsign as string,
      channelId: value.channelId as string,
      sourceLanguage: value.sourceLanguage as string,
      targetLanguage: value.targetLanguage as string,
      compactTextPayload: value.compactTextPayload as string,
      priority: value.priority as TransmissionPriority,
      transportUsed: value.transportUsed as RadioTransportType,
      location: value.location as TransmissionLocation | undefined,
      timestamp: new Date(value.timestampUnixMs as number),
      signature: Uint8Array.from(value.signature as Uint8Array),
    };

    assertPacket(packet);
    return packet;
  } catch {
    throw new TransmissionPacketDecodeError();
  }
}