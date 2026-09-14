import { createServer } from "node:http";
import { WebSocketServer } from "ws";
const PORT = Number(process.env.PORT ?? 8443);
const httpServer = createServer((req, res) => {
    if (req.url === "/healthz") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok", service: "itantra-stream-gateway" }));
        return;
    }
    res.writeHead(404);
    res.end();
});
const wss = new WebSocketServer({
    server: httpServer,
    path: "/v1/transceiver/channel",
});
wss.on("connection", (socket) => {
    console.log("[Stream Gateway] Client connected");
    socket.send(JSON.stringify({ type: "connection_ack", status: "connected" }));
    socket.on("message", (data) => {
        console.log("[Stream Gateway] Packet received");
        socket.send(data);
    });
    socket.on("close", () => {
        console.log("[Stream Gateway] Client disconnected");
    });
});
httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`[Stream Gateway] Listening on port ${PORT}`);
});
