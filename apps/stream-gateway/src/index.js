import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import path from "path";
import { prisma } from "@itantra/database";
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
const PORT = parseInt(process.env.STREAM_GATEWAY_PORT || "8443", 10);
const clients = new Map();
function normalizeChannel(channel) {
    if (!channel)
        return "TELEMETRY";
    return String(channel).trim().toUpperCase();
}
// Fan-out payload to clients subscribed to a channel (or all clients for emergency alerts)
function broadcastToChannel(channel, message) {
    const normChan = normalizeChannel(channel);
    const payloadStr = JSON.stringify(message);
    let deliveredCount = 0;
    const isEmergency = normChan === "EMERGENCY_BROADCAST" ||
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
    console.log(`[STREAM-GW] Broadcast [${normChan}] delivered to ${deliveredCount} subscriber(s).`);
    return deliveredCount;
}
const server = http.createServer(async (req, res) => {
    // Health Check
    if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "healthy", service: "stream-gateway", clients: clients.size }));
        return;
    }
    // HTTP POST /broadcast: Ingests events from c2-portal or tests
    if (req.method === "POST" && req.url === "/broadcast") {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk;
        });
        req.on("end", () => {
            try {
                const payload = JSON.parse(body);
                const channel = normalizeChannel(payload.channel || "EMERGENCY_BROADCAST");
                const deliveredCount = broadcastToChannel(channel, payload);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: true, delivered: true, recipients: deliveredCount }));
            }
            catch (err) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ success: false, error: "Invalid JSON payload" }));
            }
        });
        return;
    }
    res.writeHead(404);
    res.end();
});
const wss = new WebSocketServer({ server });
wss.on("connection", (ws, req) => {
    const clientId = `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const urlCallsign = req.headers["x-transceiver-callsign"];
    const client = {
        id: clientId,
        ws,
        callsign: urlCallsign,
        subscriptions: new Set(["EMERGENCY_BROADCAST", "TELEMETRY"]),
    };
    clients.set(clientId, client);
    console.log(`[STREAM-GW] Client connected: ${clientId} (${client.callsign || "ANONYMOUS"}) (Total: ${clients.size})`);
    // Connection ACK
    ws.send(JSON.stringify({
        type: "SYSTEM_CONNECTED",
        event: "CONNECTION_ESTABLISHED",
        clientId,
        callsign: client.callsign,
        timestamp: new Date().toISOString(),
        channels: Array.from(client.subscriptions),
    }));
    ws.on("message", async (raw) => {
        try {
            const message = JSON.parse(raw.toString("utf8"));
            const action = (message.action || message.type || "").toUpperCase();
            switch (action) {
                case "REGISTER_CALLSIGN":
                    client.callsign = message.callsign;
                    if (message.callsign) {
                        await prisma.transceiver.upsert({
                            where: { callsign: message.callsign },
                            update: { lastHeartbeat: new Date() },
                            create: {
                                deviceId: `DEV-${message.callsign}`,
                                callsign: message.callsign,
                                primaryTransport: "TACTICAL_GATEWAY",
                            },
                        });
                    }
                    ws.send(JSON.stringify({ type: "ACK", action: "REGISTER_CALLSIGN", status: "OK" }));
                    break;
                case "PING":
                    ws.send(JSON.stringify({ type: "PONG", event: "PONG", timestamp: Date.now() }));
                    break;
                case "SUBSCRIBE": {
                    const chan = normalizeChannel(message.channel);
                    client.subscriptions.add(chan);
                    ws.send(JSON.stringify({
                        type: "SUBSCRIPTION_ACK",
                        event: "SUBSCRIPTION_ACK",
                        channel: chan,
                        status: "SUBSCRIBED",
                        channels: Array.from(client.subscriptions),
                    }));
                    break;
                }
                case "UNSUBSCRIBE": {
                    const chan = normalizeChannel(message.channel);
                    if (chan === "EMERGENCY_BROADCAST") {
                        ws.send(JSON.stringify({ type: "ERROR", message: "Cannot unsubscribe from EMERGENCY_BROADCAST" }));
                        break;
                    }
                    client.subscriptions.delete(chan);
                    ws.send(JSON.stringify({
                        type: "UNSUBSCRIPTION_ACK",
                        event: "UNSUBSCRIPTION_ACK",
                        channel: chan,
                        status: "UNSUBSCRIBED",
                        channels: Array.from(client.subscriptions),
                    }));
                    break;
                }
                case "BROADCAST_MESSAGE":
                case "BROADCAST":
                    broadcastToChannel(message.channel || "TELEMETRY", {
                        type: "STREAM_PACKET",
                        from: client.callsign || "UNKNOWN",
                        payload: message.payload || message.data,
                        timestamp: new Date().toISOString(),
                    });
                    break;
                default:
                    ws.send(JSON.stringify({ type: "ERROR", message: `Unknown action '${message.action || message.type}'` }));
            }
        }
        catch {
            ws.send(JSON.stringify({ type: "ERROR", message: "Malformed JSON payload" }));
        }
    });
    ws.on("close", () => {
        clients.delete(clientId);
        console.log(`[STREAM-GW] Client disconnected: ${clientId} (Total: ${clients.size})`);
    });
    ws.on("error", (error) => {
        console.error(`[STREAM-GW] Socket error on ${clientId}:`, error);
    });
});
server.listen(PORT, () => {
    console.log(`[STREAM-GW] Tactical Stream Gateway live on port ${PORT}`);
    console.log(`[STREAM-GW] WebSocket URI: ws://localhost:${PORT}`);
    console.log(`[STREAM-GW] Health check: http://localhost:${PORT}/health`);
});
