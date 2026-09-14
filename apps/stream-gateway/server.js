const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = process.env.PORT || 8443;

// HTTP server for upgrade handling and REST broadcast intake
const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/broadcast") {
    let rawBody = "";
    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", () => {
      try {
        const payload = JSON.parse(rawBody);
        const deliveredCount = broadcastFrame(payload);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            delivered: true,
            recipients: deliveredCount,
          })
        );
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: "Invalid JSON broadcast payload",
          })
        );
      }
    });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("iTantra Tactical Stream Gateway Active\n");
});

const wss = new WebSocketServer({ noServer: true });

function normalizeChannel(ch) {
  if (!ch) return "TELEMETRY";
  return String(ch).trim().toUpperCase();
}

server.on("upgrade", (request, socket, head) => {
  const host = request.headers.host || `localhost:${PORT}`;
  const pathname = new URL(request.url, `http://${host}`).pathname;

  if (pathname === "/v1/transceiver/channel" || pathname === "/") {
    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.callsign = request.headers["x-transceiver-callsign"] || "ANONYMOUS";
      ws.subscriptions = new Set(["EMERGENCY_BROADCAST", "TELEMETRY"]);
      ws.isAlive = true;
      wss.emit("connection", ws, request);
    });
  } else {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws, req) => {
  if (!ws.subscriptions) {
    ws.subscriptions = new Set(["EMERGENCY_BROADCAST", "TELEMETRY"]);
  }
  ws.isAlive = true;

  const host = req.headers.host || `localhost:${PORT}`;
  const clientPath = new URL(req.url, `http://${host}`).pathname;
  console.log(`[STREAM GATEWAY] Connected: ${ws.callsign} on ${clientPath}`);

  // Connection ACK: emit both type and event for client compatibility
  ws.send(
    JSON.stringify({
      type: "SYSTEM_CONNECTED",
      event: "CONNECTION_ESTABLISHED",
      clientId: `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      callsign: ws.callsign,
      channels: Array.from(ws.subscriptions),
      defaultChannels: Array.from(ws.subscriptions),
      timestamp: new Date().toISOString(),
    })
  );

  ws.on("pong", () => {
    ws.isAlive = true;
  });

  ws.on("message", (raw) => {
    try {
      const rawText = raw.toString();
      const msg = JSON.parse(rawText);
      const command = (msg.action || msg.type || "").toUpperCase();

      // 1. PING Keepalive
      if (command === "PING") {
        ws.isAlive = true;
        ws.send(
          JSON.stringify({
            type: "PONG",
            event: "PONG",
            timestamp: Date.now(),
          })
        );
        return;
      }

      // 2. SUBSCRIBE
      if (command === "SUBSCRIBE" && msg.channel) {
        const chan = normalizeChannel(msg.channel);
        ws.subscriptions.add(chan);
        ws.send(
          JSON.stringify({
            type: "SUBSCRIPTION_ACK",
            event: "SUBSCRIPTION_ACK",
            channel: chan,
            status: "SUBSCRIBED",
            channels: Array.from(ws.subscriptions),
            activeSubscriptions: Array.from(ws.subscriptions),
          })
        );
        return;
      }

      // 3. UNSUBSCRIBE
      if (command === "UNSUBSCRIBE" && msg.channel) {
        const chan = normalizeChannel(msg.channel);
        if (chan === "EMERGENCY_BROADCAST") {
          ws.send(
            JSON.stringify({
              type: "ERROR",
              event: "ERROR",
              message: "Cannot unsubscribe from EMERGENCY_BROADCAST",
            })
          );
          return;
        }

        ws.subscriptions.delete(chan);
        ws.send(
          JSON.stringify({
            type: "UNSUBSCRIPTION_ACK",
            event: "UNSUBSCRIPTION_ACK",
            channel: chan,
            status: "UNSUBSCRIBED",
            channels: Array.from(ws.subscriptions),
            activeSubscriptions: Array.from(ws.subscriptions),
          })
        );
        return;
      }

      // 4. Inbound Client Broadcast
      if (
        command === "BROADCAST_MESSAGE" ||
        command === "BROADCAST" ||
        msg.event
      ) {
        broadcastFrame(msg);
        return;
      }

      ws.send(
        JSON.stringify({
          type: "ERROR",
          event: "ERROR",
          message: `Unknown action '${msg.action || msg.type}'`,
        })
      );
    } catch (err) {
      ws.send(
        JSON.stringify({
          type: "ERROR",
          event: "ERROR",
          message: "Invalid JSON frame format",
        })
      );
    }
  });

  ws.on("close", () => {
    console.log(`[STREAM GATEWAY] Disconnected: ${ws.callsign}`);
  });

  ws.on("error", (err) => {
    console.error(
      `[STREAM GATEWAY] Socket error for ${ws.callsign}:`,
      err.message
    );
  });
});

function broadcastFrame(payload) {
  const targetChannel = normalizeChannel(payload.channel);

  const outgoingEvent = {
    type: "BROADCAST_MESSAGE",
    action: payload.action || "BROADCAST_MESSAGE",
    channel: targetChannel,
    event: payload.event || "MESSAGE",
    data: payload.data || {},
  };

  const frameStr = JSON.stringify(outgoingEvent);
  let delivered = 0;

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      const subs = client.subscriptions || new Set();
      const isEmergency =
        targetChannel === "EMERGENCY_BROADCAST" ||
        targetChannel === "SOS" ||
        targetChannel === "MAYDAY";

      if (isEmergency || subs.has(targetChannel)) {
        client.send(frameStr);
        delivered++;
      }
    }
  });

  return delivered;
}

const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log(`[STREAM GATEWAY] Terminating dead client: ${ws.callsign}`);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on("close", () => clearInterval(pingInterval));

server.listen(PORT, () => {
  console.log(`[STREAM GATEWAY] Listening on port :${PORT}`);
  console.log(
    `[STREAM GATEWAY] Route: ws://localhost:${PORT}/v1/transceiver/channel`
  );
});