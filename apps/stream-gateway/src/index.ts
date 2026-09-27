import http from "http";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import path from "path";
import { prisma } from "@itantra/database";


dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const PORT = parseInt(process.env.STREAM_GATEWAY_PORT || "8443", 10);

const DEVICE_MESSAGE_STATUSES = new Set([
  "RECEIVED",
  "HEARD",
  "FAILED",
]);

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  callsign?: string;
  subscriptions: Set<string>;
}

const clients = new Map<string, ConnectedClient>();

function verifyTacticalToken(
  token: string,
  expectedCallsign: string
): boolean {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;

    const [encodedPayload, providedSignature] = parts;

    const secret =
      process.env.JWT_TACTICAL_SECRET ||
      "iTantra-Tactical-Auth-Secret-2026";

    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest("base64url");

    if (providedSignature !== expectedSignature) {
      return false;
    }

    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    );

    if (payload.callsign !== expectedCallsign) {
      return false;
    }

    if (payload.deviceId === undefined) {
      return false;
    }

    if (
      typeof payload.expiresAt === "number" &&
      Date.now() > payload.expiresAt
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function normalizeChannel(channel?: string): string {
  if (!channel) return "TELEMETRY";
  return String(channel).trim().toUpperCase();
}

// Fan-out payload to clients subscribed to a channel.
// Emergency messages are delivered to all connected clients.
function broadcastToChannel(channel: string, message: any): number {
  const normChan = normalizeChannel(channel);
  const payloadStr = JSON.stringify(message);
  let deliveredCount = 0;

  const isEmergency =
    normChan === "EMERGENCY_BROADCAST" ||
    normChan === "SOS" ||
    normChan === "MAYDAY";

  for (const [, client] of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      if (isEmergency || client.subscriptions.has(normChan)) {
        client.ws.send(payloadStr);
        deliveredCount++;
      }
    }
  }

  console.log(
    `[STREAM-GW] Broadcast [${normChan}] delivered to ${deliveredCount} subscriber(s).`
  );

  return deliveredCount;
}

const server = http.createServer(async (req, res) => {
  // ============================================================
  // DEVICE REGISTRATION
  // POST /api/v1/auth/register
  // ============================================================
  if (req.method === "POST" && req.url === "/api/v1/auth/register") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", async () => {
      try {
        const data = JSON.parse(body);

        const requiredFields = [
          "deviceId",
          "callsign",
          "publicKeyPem",
          "primaryTransport",
        ];

        for (const field of requiredFields) {
          if (!data[field]) {
            res.writeHead(400, {
              "Content-Type": "application/json",
            });

            res.end(
              JSON.stringify({
                success: false,
                error: `Missing required field: ${field}`,
              })
            );

            return;
          }
        }

        const challenge = crypto.randomBytes(32).toString("hex");

        const challengeExpiresAt = new Date(
          Date.now() + 5 * 60 * 1000
        );

        const transceiver = await prisma.transceiver.upsert({
          where: {
            deviceId: data.deviceId,
          },

          update: {
            callsign: data.callsign,
            operatorName: data.operatorName || null,
            publicKeyPem: data.publicKeyPem,
            authChallenge: challenge,
            challengeExpiresAt,
            primaryTransport: data.primaryTransport,
            currentFirmwareVersion:
              data.firmwareVersion || "v1.0.0",
            currentAiModelVersion:
              data.aiModelVersion || "v1.0.0",
            isActive: true,
          },

          create: {
            deviceId: data.deviceId,
            callsign: data.callsign,
            operatorName: data.operatorName || null,
            publicKeyPem: data.publicKeyPem,
            authChallenge: challenge,
            challengeExpiresAt,
            primaryTransport: data.primaryTransport,
            currentFirmwareVersion:
              data.firmwareVersion || "v1.0.0",
            currentAiModelVersion:
              data.aiModelVersion || "v1.0.0",
          },
        });

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: true,
            status: "REGISTERED",
            deviceId: transceiver.deviceId,
            callsign: transceiver.callsign,
            challenge,
            challengeExpiresAt,
          })
        );
      } catch (error) {
        console.error("[AUTH] Registration error:", error);

        res.writeHead(400, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid registration request",
          })
        );
      }
    });

    return;
  }

  // ============================================================
  // HEALTH CHECK
  // GET /health
  // ============================================================
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "application/json",
    });

    res.end(
      JSON.stringify({
        status: "healthy",
        service: "stream-gateway",
        clients: clients.size,
      })
    );

    return;
  }

  // ============================================================
  // HTTP BROADCAST
  // POST /broadcast
  // Used by C2 portal and testing
  // ============================================================
  if (req.method === "POST" && req.url === "/broadcast") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(body);

        const channel = normalizeChannel(
          payload.channel || "EMERGENCY_BROADCAST"
        );

        const deliveredCount = broadcastToChannel(
          channel,
          payload
        );

        res.writeHead(200, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: true,
            delivered: true,
            recipients: deliveredCount,
          })
        );
      } catch {
        res.writeHead(400, {
          "Content-Type": "application/json",
        });

        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON payload",
          })
        );
      }
    });

    return;
  }

  res.writeHead(404);
  res.end();
});

// ============================================================
// WEBSOCKET SERVER
// ============================================================

const wss = new WebSocketServer({
  server,
});

wss.on("connection", (ws: WebSocket, req) => {
  const authorization = req.headers["authorization"];
  const urlCallsign = req.headers[
    "x-transceiver-callsign"
  ] as string | undefined;

  if (!urlCallsign) {
    ws.close(1008, "Missing callsign");
    return;
  }

  if (
    typeof authorization !== "string" ||
    !authorization.startsWith("Bearer ")
  ) {
    ws.close(1008, "Missing bearer token");
    return;
  }

  const token = authorization.substring("Bearer ".length).trim();

  if (!verifyTacticalToken(token, urlCallsign)) {
    ws.close(1008, "Invalid bearer token");
    return;
  }

  const clientId = `client-${Date.now()}-${Math.random()
    .toString(36)
    .substring(2, 7)}`;

  const client: ConnectedClient = {
    id: clientId,
    ws,
    callsign: urlCallsign,
    subscriptions: new Set([
      "EMERGENCY_BROADCAST",
      "TELEMETRY",
    ]),
  };

  clients.set(clientId, client);

  console.log(
    `[STREAM-GW] Client connected: ${clientId} (${
      client.callsign || "ANONYMOUS"
    }) (Total: ${clients.size})`
  );

  // ============================================================
  // CONNECTION ACK
  // ============================================================

  ws.send(
    JSON.stringify({
      event: "ACK",
      action: "CONNECTION_ESTABLISHED",
      status: "OK",
      clientId,
      callsign: client.callsign,
      timestamp: new Date().toISOString(),
      channels: Array.from(client.subscriptions),
    })
  );

  // ============================================================
  // WEBSOCKET MESSAGE HANDLER
  // ============================================================

  ws.on("message", async (raw: Buffer) => {
    try {
      const message = JSON.parse(
        raw.toString("utf8")
      );

      const event = String(
        message.event ||
          message.action ||
          message.type ||
          ""
      ).toUpperCase();

      const data = message.data || message;

      switch (event) {
        // ========================================================
        // REGISTER CALLSIGN
        // ========================================================

        case "REGISTER_CALLSIGN": {
          client.callsign = data.callsign;

          if (client.callsign) {
            await prisma.transceiver.upsert({
              where: {
                callsign: client.callsign,
              },

              update: {
                lastHeartbeat: new Date(),
                isActive: true,
              },

              create: {
                deviceId: `DEV-${client.callsign}`,
                callsign: client.callsign,
                primaryTransport:
                  "TACTICAL_GATEWAY",
              },
            });
          }

          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "REGISTER_CALLSIGN",
              status: "OK",
              callsign: client.callsign,
              timestamp:
                new Date().toISOString(),
            })
          );

          break;
        }

        // ========================================================
        // HEARTBEAT
        // ========================================================

        case "HEARTBEAT": {
          if (client.callsign) {
            await prisma.transceiver
              .update({
                where: {
                  callsign: client.callsign,
                },
                data: {
                  lastHeartbeat: new Date(),
                  isActive: true,
                },
              })
              .catch(() => {
                // Device may not exist yet.
              });

            const heartbeatData = message.data || {};
            const telemetryLog = (prisma as any).telemetryLog;

            if (telemetryLog) {
              await telemetryLog
                .create({
                  data: {
                    deviceId: heartbeatData.deviceId || client.callsign,
                    battery: heartbeatData.battery ?? null,
                    rssi: heartbeatData.rssi ?? null,
                    temperature: heartbeatData.temperature ?? null,
                    latency: heartbeatData.latency ?? null,
                    bufferOverruns: heartbeatData.bufferOverruns ?? 0,
                  },
                })
                .catch((error: unknown) => {
                  console.error("Telemetry persistence failed:", error);
                });
            }
          }

          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "HEARTBEAT",
              status: "OK",
              callsign: client.callsign,
              timestamp: new Date().toISOString(),
            })
          );

          break;
        }

        // ========================================================
        // PING
        // ========================================================

        case "PING": {
          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "PING",
              status: "OK",
              timestamp:
                new Date().toISOString(),
            })
          );

          break;
        }

        // ========================================================
        // SUBSCRIBE
        // ========================================================

        case "SUBSCRIBE": {
          const requestedChannel =
            typeof data.channelId === "string"
              ? data.channelId.trim()
              : typeof data.channel === "string"
                ? data.channel.trim()
                : "";

          if (!requestedChannel) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "SUBSCRIBE",
                status: "REJECTED",
                reason: "A channelId or channel is required",
                timestamp: new Date().toISOString(),
              })
            );
            break;
          }

          const normalizedRequest = normalizeChannel(requestedChannel);
          if (normalizedRequest === "TELEMETRY") {
            client.subscriptions.add(normalizedRequest);
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "SUBSCRIBE",
                status: "OK",
                channelId: normalizedRequest,
                channels: Array.from(client.subscriptions),
                timestamp: new Date().toISOString(),
              })
            );
            break;
          }

          try {
            const channelRecord = await prisma.tacticalChannel.findFirst({
              where: {
                isActive: true,
                OR: [
                  { channelId: requestedChannel },
                  { name: normalizedRequest },
                ],
              },
              select: { channelId: true, name: true },
            });

            if (!channelRecord) {
              ws.send(
                JSON.stringify({
                  event: "ACK",
                  action: "SUBSCRIBE",
                  status: "REJECTED",
                  reason: "Channel does not exist or is inactive",
                  channelId: requestedChannel,
                  timestamp: new Date().toISOString(),
                })
              );
              break;
            }

            const membership = client.callsign
              ? await prisma.channelMember.findUnique({
                  where: {
                    channelId_callsign: {
                      channelId: channelRecord.channelId,
                      callsign: client.callsign,
                    },
                  },
                  select: { isActive: true },
                })
              : null;

            if (!membership?.isActive) {
              ws.send(
                JSON.stringify({
                  event: "ACK",
                  action: "SUBSCRIBE",
                  status: "REJECTED",
                  reason: "Active channel membership is required",
                  channelId: channelRecord.channelId,
                  timestamp: new Date().toISOString(),
                })
              );
              break;
            }

            const channel = normalizeChannel(channelRecord.name);
            client.subscriptions.add(channel);
            client.subscriptions.add(
              normalizeChannel(channelRecord.channelId)
            );

            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "SUBSCRIBE",
                status: "OK",
                channelId: channelRecord.channelId,
                channel: channelRecord.name,
                channels: Array.from(client.subscriptions),
                timestamp: new Date().toISOString(),
              })
            );
          } catch (error) {
            console.error("[STREAM-GW] Channel subscription check failed:", error);
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "SUBSCRIBE",
                status: "REJECTED",
                reason: "Channel membership could not be verified",
                channelId: requestedChannel,
                timestamp: new Date().toISOString(),
              })
            );
          }

          break;
        }

        // ========================================================
        // UNSUBSCRIBE
        // ========================================================

        case "UNSUBSCRIBE": {
          const channel = normalizeChannel(
            data.channelId ||
              data.channel
          );

          if (
            channel ===
            "EMERGENCY_BROADCAST"
          ) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "UNSUBSCRIBE",
                status: "REJECTED",
                reason:
                  "Emergency channel cannot be unsubscribed",
                channelId: channel,
                timestamp:
                  new Date().toISOString(),
              })
            );

            break;
          }

          client.subscriptions.delete(
            channel
          );

          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "UNSUBSCRIBE",
              status: "OK",
              channelId: channel,
              channels: Array.from(
                client.subscriptions
              ),
              timestamp:
                new Date().toISOString(),
            })
          );

          break;
        }

        // ========================================================
        // INGEST PACKET
        // Main text communication event
        // ========================================================

        case "INGEST_PACKET": {
          const packetId =
            data.packetId ||
            crypto.randomUUID();

          const channelId =
            normalizeChannel(
              data.channelId ||
                data.channel
            );

          const senderCallsign =
            data.senderCallsign ||
            data.callsign ||
            client.callsign ||
            "UNKNOWN";

          const recipientCallsign =
            data.recipientCallsign ||
            "BROADCAST";

          const compactTextPayload =
            data.compactTextPayload ||
            data.text ||
            "";

          if (!compactTextPayload) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "INGEST_PACKET",
                status: "REJECTED",
                error:
                  "compactTextPayload or text is required",
                timestamp:
                  new Date().toISOString(),
              })
            );

            break;
          }

          const priority = String(
            data.priority ||
              "PRIORITY_ROUTINE"
          ).toUpperCase();

          let normalizedPriority:
            | "PRIORITY_ROUTINE"
            | "PRIORITY_HIGH"
            | "PRIORITY_EMERGENCY_SOS";

          if (
            priority ===
            "PRIORITY_EMERGENCY_SOS"
          ) {
            normalizedPriority =
              "PRIORITY_EMERGENCY_SOS";
          } else if (
            priority ===
            "PRIORITY_HIGH"
          ) {
            normalizedPriority =
              "PRIORITY_HIGH";
          } else {
            normalizedPriority =
              "PRIORITY_ROUTINE";
          }

          const transmission =
            await prisma.transmission.create({
              data: {
                packetId,

                senderCallsign,

                recipientCallsign,

                sourceLanguage:
                  data.sourceLanguage ||
                  "en",

                targetLanguage:
                  data.targetLanguage ||
                  data.sourceLanguage ||
                  "en",

                compactTextPayload,

                payloadByteSize:
                  Buffer.byteLength(
                    compactTextPayload,
                    "utf8"
                  ),

                priority:
                  normalizedPriority,

                transportUsed:
                  data.transportUsed ||
                  "TACTICAL_GATEWAY",

                latitude:
                  typeof data.latitude ===
                  "number"
                    ? data.latitude
                    : null,

                longitude:
                  typeof data.longitude ===
                  "number"
                    ? data.longitude
                    : null,

                status: "SENT",
              },
            });

          const outgoingPacket = {
            event: "INGEST_PACKET",

            callsign: senderCallsign,

            timestamp:
              new Date().toISOString(),

            data: {
              packetId:
                transmission.packetId,

              senderCallsign,

              recipientCallsign,

              channelId,

              sourceLanguage:
                transmission.sourceLanguage,

              targetLanguage:
                transmission.targetLanguage,

              compactTextPayload,

              payloadByteSize:
                transmission.payloadByteSize,

              priority:
                transmission.priority,

              transportUsed:
                transmission.transportUsed,

              latitude:
                transmission.latitude,

              longitude:
                transmission.longitude,

              status: "SENT",
            },
          };

          const deliveredCount = broadcastToChannel(
            channelId,
            outgoingPacket
          );

          const deliveryStatus =
            deliveredCount > 0 ? "DELIVERED" : "SENT";

          if (deliveredCount > 0) {
            await prisma.transmission.update({
              where: {
                packetId: transmission.packetId,
              },
              data: {
                status: "DELIVERED",
              },
            });
          }

          // ACK sender
          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "INGEST_PACKET",
              status: deliveryStatus,
              packetId: transmission.packetId,
              deliveredCount,
              timestamp: new Date().toISOString(),
            })
          );

          console.log(
            `[INGEST] ${senderCallsign} -> ${recipientCallsign} | ${compactTextPayload}`
          );

          break;
        }

        // ========================================================
        // MESSAGE STATUS
        // Device reports RECEIVED / HEARD / FAILED
        // ========================================================

        case "MESSAGE_STATUS": {
          const packetId = String(data.packetId || "").trim();
          const requestedStatus = String(
            data.status || ""
          ).toUpperCase();

          if (!packetId) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "MESSAGE_STATUS",
                status: "REJECTED",
                error: "packetId is required",
                timestamp: new Date().toISOString(),
              })
            );

            break;
          }

          if (!DEVICE_MESSAGE_STATUSES.has(requestedStatus)) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "MESSAGE_STATUS",
                status: "REJECTED",
                packetId,
                error:
                  "Allowed device statuses: RECEIVED, HEARD, FAILED",
                timestamp: new Date().toISOString(),
              })
            );

            break;
          }

          const transmission =
            await prisma.transmission.findUnique({
              where: {
                packetId,
              },
            });

          if (!transmission) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "MESSAGE_STATUS",
                status: "REJECTED",
                packetId,
                error: "Transmission not found",
                timestamp: new Date().toISOString(),
              })
            );

            break;
          }

          const reportingCallsign = client.callsign;

          if (!reportingCallsign) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "MESSAGE_STATUS",
                status: "REJECTED",
                packetId,
                error: "Client is not registered",
                timestamp: new Date().toISOString(),
              })
            );

            break;
          }

          const isRecipient =
            transmission.recipientCallsign === reportingCallsign ||
            transmission.recipientCallsign === "BROADCAST" ||
            transmission.recipientCallsign === "ALL";

          const isSender =
            transmission.senderCallsign === reportingCallsign;

          // RECEIVED and HEARD must come from the receiving device.
          // FAILED can be reported by either side.
          if (
            (requestedStatus === "RECEIVED" ||
              requestedStatus === "HEARD") &&
            !isRecipient
          ) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "MESSAGE_STATUS",
                status: "REJECTED",
                packetId,
                error:
                  "Only the receiving device can report RECEIVED or HEARD",
                timestamp: new Date().toISOString(),
              })
            );

            break;
          }

          if (
            requestedStatus === "FAILED" &&
            !isRecipient &&
            !isSender
          ) {
            ws.send(
              JSON.stringify({
                event: "ACK",
                action: "MESSAGE_STATUS",
                status: "REJECTED",
                packetId,
                error:
                  "Only sender or recipient can report FAILED",
                timestamp: new Date().toISOString(),
              })
            );

            break;
          }

          const updatedTransmission =
            await prisma.transmission.update({
              where: {
                packetId,
              },
              data: {
                status: requestedStatus,
              },
            });

          const statusEvent = {
            event: "MESSAGE_STATUS",
            callsign: reportingCallsign,
            timestamp: new Date().toISOString(),
            data: {
              packetId: updatedTransmission.packetId,
              senderCallsign:
                updatedTransmission.senderCallsign,
              recipientCallsign:
                updatedTransmission.recipientCallsign,
              status: requestedStatus,
            },
          };

          // Notify the sender about receiver-side status.
          for (const [, connectedClient] of clients) {
            if (
              connectedClient.ws.readyState === WebSocket.OPEN &&
              connectedClient.callsign ===
                updatedTransmission.senderCallsign
            ) {
              connectedClient.ws.send(
                JSON.stringify(statusEvent)
              );
            }
          }

          // ACK the device that reported the status.
          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "MESSAGE_STATUS",
              status: "UPDATED",
              packetId,
              messageStatus: requestedStatus,
              timestamp: new Date().toISOString(),
            })
          );

          console.log(
            `[STATUS] ${reportingCallsign} -> ${packetId} | ${requestedStatus}`
          );

          break;
        }

        // ========================================================
        // CRITICAL SOS
        // ========================================================

        case "CRITICAL_SOS": {
          const packetId =
            data.packetId ||
            crypto.randomUUID();

          const senderCallsign =
            data.senderCallsign ||
            data.callsign ||
            client.callsign ||
            "UNKNOWN";

          const compactTextPayload =
            data.compactTextPayload ||
            data.text ||
            "CRITICAL SOS";

          const transmission =
            await prisma.transmission.create({
              data: {
                packetId,

                senderCallsign,

                recipientCallsign:
                  data.recipientCallsign ||
                  "ALL",

                sourceLanguage:
                  data.sourceLanguage ||
                  "en",

                targetLanguage:
                  data.targetLanguage ||
                  data.sourceLanguage ||
                  "en",

                compactTextPayload,

                payloadByteSize:
                  Buffer.byteLength(
                    compactTextPayload,
                    "utf8"
                  ),

                priority:
                  "PRIORITY_EMERGENCY_SOS",

                transportUsed:
                  data.transportUsed ||
                  "TACTICAL_GATEWAY",

                latitude:
                  typeof data.latitude ===
                  "number"
                    ? data.latitude
                    : null,

                longitude:
                  typeof data.longitude ===
                  "number"
                    ? data.longitude
                    : null,

                status:
                  "EMERGENCY_RECEIVED",
              },
            });

          const incident =
            await prisma.emergencyIncident.create({
              data: {
                packetId:
                  transmission.packetId,

                initiatingCallsign:
                  senderCallsign,

                alertType:
                  "CRITICAL_SOS_BROADCAST",

                status:
                  "ACTIVE_DISPATCH",
              },
            });

          const sosPacket = {
            event: "CRITICAL_SOS",

            callsign:
              senderCallsign,

            timestamp:
              new Date().toISOString(),

            data: {
              packetId:
                transmission.packetId,

              incidentId:
                incident.incidentId,

              initiatingCallsign:
                senderCallsign,

              text:
                compactTextPayload,

              priority:
                "PRIORITY_EMERGENCY_SOS",

              latitude:
                transmission.latitude,

              longitude:
                transmission.longitude,

              nonInterruptible: true,
            },
          };

          // Emergency messages go to ALL clients.
          broadcastToChannel(
            "EMERGENCY_BROADCAST",
            sosPacket
          );

          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "CRITICAL_SOS",
              status: "RECEIVED",
              packetId:
                transmission.packetId,
              incidentId:
                incident.incidentId,
              timestamp:
                new Date().toISOString(),
            })
          );

          console.log(
            `[SOS] CRITICAL SOS from ${senderCallsign} | Incident: ${incident.incidentId}`
          );

          break;
        }

        // ========================================================
        // LEGACY BROADCAST COMPATIBILITY
        // ========================================================

        case "BROADCAST_MESSAGE":
        case "BROADCAST": {
          const channel =
            normalizeChannel(
              data.channelId ||
                data.channel
            );

          broadcastToChannel(channel, {
            event:
              "INGEST_PACKET",

            callsign:
              client.callsign ||
              "UNKNOWN",

            timestamp:
              new Date().toISOString(),

            data:
              data.payload ||
              data.data ||
              data,
          });

          ws.send(
            JSON.stringify({
              event: "ACK",
              action: "BROADCAST",
              status: "OK",
              timestamp:
                new Date().toISOString(),
            })
          );

          break;
        }

        // ========================================================
        // UNKNOWN EVENT
        // ========================================================

        default: {
          ws.send(
            JSON.stringify({
              event: "ACK",

              action:
                event || "UNKNOWN",

              status: "REJECTED",

              error:
                `Unknown event '${event}'`,

              timestamp:
                new Date().toISOString(),
            })
          );
        }
      }
    } catch (error) {
      console.error(
        "[STREAM-GW] WebSocket message error:",
        error
      );

      ws.send(
        JSON.stringify({
          event: "ACK",

          status: "REJECTED",

          error:
            "Malformed JSON or server processing error",

          timestamp:
            new Date().toISOString(),
        })
      );
    }
  });

  // ============================================================
  // CLIENT DISCONNECTED
  // ============================================================

  ws.on("close", () => {
    clients.delete(clientId);

    console.log(
      `[STREAM-GW] Client disconnected: ${clientId} (Total: ${clients.size})`
    );
  });

  // ============================================================
  // SOCKET ERROR
  // ============================================================

  ws.on("error", (error) => {
    console.error(
      `[STREAM-GW] Socket error on ${clientId}:`,
      error
    );
  });
});

// ============================================================
// START SERVER
// ============================================================

server.listen(PORT, () => {
  console.log(
    `[STREAM-GW] Tactical Stream Gateway live on port ${PORT}`
  );

  console.log(
    `[STREAM-GW] WebSocket URI: ws://localhost:${PORT}`
  );

  console.log(
    `[STREAM-GW] Health check: http://localhost:${PORT}/health`
  );
});