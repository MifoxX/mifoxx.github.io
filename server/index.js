import http from "http";
import WebSocket from "ws";
import client from "prom-client";

// Create a Registry which registers the metrics
const register = new client.Registry();
register.setDefaultLabels({ app: "clocktower-online" });

const PING_INTERVAL = 30000; // 30 seconds

// --- SERVER SETUP ---
const server = process.env.NODE_ENV === "development" ? null : http.createServer();

// --- WEBSOCKET SERVER ---
const wss = new WebSocket.Server({
  ...(process.env.NODE_ENV === "development" ? { port: 8081 } : { server }),
  verifyClient: (info) =>
    info.origin &&
    !!info.origin.match(
      /^https?:\/\/([^.]+\.github\.io|localhost|clocktower\.online|eddbra1nprivatetownsquare\.xyz)/i
    ),
});

// --- UTILS ---
function noop() {}
function heartbeat() {
  this.latency = Math.round((new Date().getTime() - this.pingStart) / 2);
  this.counter = 0;
  this.isAlive = true;
}

// --- CHANNELS & METRICS ---
const channels = {};

const metrics = {
  players_concurrent: new client.Gauge({
    name: "players_concurrent",
    help: "Concurrent Players",
    collect() { this.set(wss.clients.size); },
  }),
  channels_concurrent: new client.Gauge({
    name: "channels_concurrent",
    help: "Concurrent Channels",
    collect() { this.set(Object.keys(channels).length); },
  }),
  channels_list: new client.Gauge({
    name: "channel_players",
    help: "Players in each channel",
    labelNames: ["name"],
    collect() {
      for (let channel in channels) {
        this.set(
          { name: channel },
          channels[channel].filter(
            (ws) => ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)
          ).length
        );
      }
    },
  }),
  messages_incoming: new client.Counter({ name: "messages_incoming", help: "Incoming messages" }),
  messages_outgoing: new client.Counter({ name: "messages_outgoing", help: "Outgoing messages" }),
  connection_terminated_host: new client.Counter({ name: "connection_terminated_host", help: "Duplicate host" }),
  connection_terminated_spam: new client.Counter({ name: "connection_terminated_spam", help: "Spam" }),
  connection_terminated_timeout: new client.Counter({ name: "connection_terminated_timeout", help: "Timeout" }),
};

// register metrics
for (let metric in metrics) register.registerMetric(metrics[metric]);

// --- CONNECTION HANDLER ---
wss.on("connection", function connection(ws, req) {
  const url = req.url.toLowerCase().split("/");
  ws.playerId = url.pop();
  ws.channel = url.pop();

  if (
    ws.playerId === "host" &&
    channels[ws.channel] &&
    channels[ws.channel].some(
      (client) => client !== ws && client.readyState === WebSocket.OPEN && client.playerId === "host"
    )
  ) {
    console.log(ws.channel, "duplicate host");
    ws.close(1000, `The channel "${ws.channel}" already has a host`);
    metrics.connection_terminated_host.inc();
    return;
  }

  ws.isAlive = true;
  ws.pingStart = Date.now();
  ws.counter = 0;

  if (!channels[ws.channel]) channels[ws.channel] = [];
  channels[ws.channel].push(ws);

  ws.ping(noop);
  ws.on("pong", heartbeat);

  ws.on("message", function incoming(data) {
    metrics.messages_incoming.inc();
    ws.counter++;
    if (ws.counter > (5 * PING_INTERVAL) / 1000) {
      console.log(ws.channel, "disconnecting user due to spam");
      ws.close(1000, "Your app seems to be malfunctioning, please clear your browser cache.");
      metrics.connection_terminated_spam.inc();
      return;
    }

    const messageType = data.toLowerCase().substr(1).split(",", 1).pop();
    switch (messageType) {
      case '"ping"':
        channels[ws.channel].forEach(client => {
          if (
            client !== ws &&
            client.readyState === WebSocket.OPEN &&
            (ws.playerId === "host" || client.playerId === "host")
          ) {
            client.send(data.replace(/latency/, (client.latency || 0) + (ws.latency || 0)));
            metrics.messages_outgoing.inc();
          }
        });
        break;
      case '"direct"':
        try {
          const dataToPlayer = JSON.parse(data)[1];
          channels[ws.channel].forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN && dataToPlayer[client.playerId]) {
              client.send(JSON.stringify(dataToPlayer[client.playerId]));
              metrics.messages_outgoing.inc();
            }
          });
        } catch (e) {
          console.log("error parsing direct message JSON", e);
        }
        break;
      default:
        channels[ws.channel].forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(data);
            metrics.messages_outgoing.inc();
          }
        });
        break;
    }
  });
});

// --- PING INTERVAL ---
const interval = setInterval(function ping() {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      metrics.connection_terminated_timeout.inc();
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.pingStart = Date.now();
    ws.ping(noop);
  });

  for (let channel in channels) {
    if (!channels[channel].some(ws => ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING))) {
      metrics.channels_list.remove({ name: channel });
      delete channels[channel];
    }
  }
}, PING_INTERVAL);

wss.on("close", () => clearInterval(interval));

// --- START SERVER & METRICS ---
if (process.env.NODE_ENV !== "development") {
  console.log("server starting");
  server.listen(8080);
  server.on("request", (req, res) => {
    res.setHeader("Content-Type", register.contentType);
    register.metrics().then(out => res.end(out));
  });
}
