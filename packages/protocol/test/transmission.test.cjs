const assert = require("node:assert/strict");
const test = require("node:test");

const {
  decodeTransmissionPacket,
  encodeTransmissionPacket,
  MAX_TRANSMISSION_PACKET_BYTES,
  TRANSMISSION_PROTOBUF_CONTENT_TYPE,
  TransmissionPacketDecodeError,
} = require("../dist/index.js");

function makePacket() {
  return {
    packetId: "a8c957e7-2175-421a-b143-2a109e570d2e",
    senderCallsign: "TEAM-ALPHA-01",
    recipientCallsign: "BROADCAST_ALL",
    channelId: "chan-sector4-03",
    sourceLanguage: "te",
    targetLanguage: "en",
    compactTextPayload: "స్థానం సురక్షితం, తదుపరి సూచనల కోసం వేచి ఉండండి.",
    priority: "PRIORITY_HIGH",
    transportUsed: "TACTICAL_GATEWAY",
    location: { latitude: 17.385, longitude: 78.4867 },
    timestamp: new Date("2026-09-27T12:34:56.789Z"),
    signature: Uint8Array.from({ length: 64 }, (_, index) => index),
  };
}

test("encodes and decodes a transmission packet", () => {
  const packet = makePacket();
  const encoded = encodeTransmissionPacket(packet);
  const decoded = decodeTransmissionPacket(encoded);

  assert.ok(encoded instanceof Buffer);
  assert.equal(decoded.packetId, packet.packetId);
  assert.equal(decoded.senderCallsign, packet.senderCallsign);
  assert.equal(decoded.recipientCallsign, packet.recipientCallsign);
  assert.equal(decoded.channelId, packet.channelId);
  assert.equal(decoded.sourceLanguage, packet.sourceLanguage);
  assert.equal(decoded.targetLanguage, packet.targetLanguage);
  assert.equal(decoded.compactTextPayload, packet.compactTextPayload);
});

test("preserves UTF-8 Telugu text", () => {
  const packet = makePacket();
  const decoded = decodeTransmissionPacket(encodeTransmissionPacket(packet));
  assert.equal(decoded.compactTextPayload, packet.compactTextPayload);
});

test("preserves signature bytes", () => {
  const packet = makePacket();
  const decoded = decodeTransmissionPacket(encodeTransmissionPacket(packet));
  assert.deepEqual(decoded.signature, packet.signature);
});

test("preserves location, timestamp, priority, and transport", () => {
  const packet = makePacket();
  const decoded = decodeTransmissionPacket(encodeTransmissionPacket(packet));

  assert.deepEqual(decoded.location, packet.location);
  assert.equal(decoded.timestamp.getTime(), packet.timestamp.getTime());
  assert.equal(decoded.priority, packet.priority);
  assert.equal(decoded.transportUsed, packet.transportUsed);
});

test("preserves PRIORITY_URGENT without changing existing enum values", () => {
  const packet = { ...makePacket(), priority: "PRIORITY_URGENT" };
  const decoded = decodeTransmissionPacket(encodeTransmissionPacket(packet));
  assert.equal(decoded.priority, "PRIORITY_URGENT");
});

test("rejects a pre-epoch timestamp before encoding", () => {
  const packet = { ...makePacket(), timestamp: new Date(-1) };
  assert.throws(
    () => encodeTransmissionPacket(packet),
    /timestamp must be a non-negative Unix millisecond value/
  );
});

test("rejects malformed protobuf safely", () => {
  assert.throws(
    () => decodeTransmissionPacket(Uint8Array.from([0x0a, 0x80])),
    TransmissionPacketDecodeError
  );
});

test("rejects oversized protobuf input before decoding", () => {
  const oversized = new Uint8Array(MAX_TRANSMISSION_PACKET_BYTES + 1);
  assert.throws(
    () => decodeTransmissionPacket(oversized),
    new RegExp(`exceeds the ${MAX_TRANSMISSION_PACKET_BYTES}-byte limit`)
  );
});

test("measures JSON and protobuf packet sizes", (t) => {
  const packet = makePacket();
  const jsonPacket = {
    ...packet,
    timestamp: packet.timestamp.toISOString(),
    signature: Buffer.from(packet.signature).toString("base64"),
  };
  const jsonSize = Buffer.byteLength(JSON.stringify(jsonPacket), "utf8");
  const protobufSize = encodeTransmissionPacket(packet).byteLength;
  const reduction = ((jsonSize - protobufSize) / jsonSize) * 100;

  t.diagnostic(
    `Representative packet: JSON=${jsonSize} bytes, protobuf=${protobufSize} bytes, measured reduction=${reduction.toFixed(1)}%`
  );
  assert.ok(protobufSize < jsonSize);
  assert.equal(TRANSMISSION_PROTOBUF_CONTENT_TYPE, "application/x-protobuf");
});