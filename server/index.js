const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
app.use(express.json());
app.get("/health", (req, res) => res.json({ ok: true }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const PORT = process.env.PORT || 4000;

const VIDEOS = [
  {
    id: "big-buck-bunny",
    title: "Big Buck Bunny",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  },
  {
    id: "elephants-dream",
    title: "Elephants Dream (sample)",
    url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm",
  },
];

const session = {
  videoId: VIDEOS[0].id,
  isPlaying: false,
  positionAtLastUpdate: 0, // seconds
  serverTimestampAtLastUpdate: Date.now(),
  seq: 0, // increments on every authoritative state change
};

const displays = new Map();
const statsByClientId = new Map();

function getStats(clientId) {
  if (!statsByClientId.has(clientId)) {
    statsByClientId.set(clientId, { correctionCount: 0, disconnectCount: 0, driftSamples: [] });
  }
  return statsByClientId.get(clientId);
}

function getExpectedPosition(atTime = Date.now()) {
  if (!session.isPlaying) return session.positionAtLastUpdate;
  const elapsedSec = (atTime - session.serverTimestampAtLastUpdate) / 1000;
  return session.positionAtLastUpdate + elapsedSec;
}

function setSessionState(partial) {
  const now = Date.now();
  session.positionAtLastUpdate = getExpectedPosition(now);
  session.serverTimestampAtLastUpdate = now;
  Object.assign(session, partial);
  session.seq += 1;
}

function publicSession() {
  return {
    videoId: session.videoId,
    isPlaying: session.isPlaying,
    expectedPosition: getExpectedPosition(),
    seq: session.seq,
    serverTime: Date.now(),
  };
}

function publicDisplays() {
  return Array.from(displays.values()).map((d) => ({
    clientId: d.clientId,
    connected: true,
    position: d.position,
    isPlaying: d.isPlaying,
    isLoading: d.isLoading,
    drift: d.drift,
    lastReportAt: d.lastReportAt,
  }));
}

function broadcastState() {
  io.emit("session:state", publicSession());
}

function broadcastDisplays() {
  io.to("controllers").emit("displays:update", publicDisplays());
}

const DRIFT_THRESHOLD_MS = 400;
const CORRECTION_COOLDOWN_MS = 3000; 

function maybeCorrect(socketId) {
  const d = displays.get(socketId);
  if (!d) return;

  const now = Date.now();
  const withinCooldown = d.lastCorrectionAt && now - d.lastCorrectionAt < CORRECTION_COOLDOWN_MS;
  if (withinCooldown) return;
  if (Math.abs(d.drift) <= DRIFT_THRESHOLD_MS) return;

  const target = getExpectedPosition(now);
  d.lastCorrectionAt = now;
  getStats(d.clientId).correctionCount += 1;
  io.to(socketId).emit("display:correct", {
    position: target,
    isPlaying: session.isPlaying,
    reason: "drift-threshold-exceeded",
    seq: session.seq,
  });
}

const HEALTHY_DRIFT_MS = 150;
const WATCH_DRIFT_MS = 400; 
const FREQUENT_CORRECTIONS = 5;
const FREQUENT_DISCONNECTS = 2;

function averageAbs(samples) {
  if (!samples.length) return 0;
  return samples.reduce((sum, v) => sum + Math.abs(v), 0) / samples.length;
}

function classifyDisplay(clientId, live) {
  const stats = getStats(clientId);
  const avgDrift = Math.round(averageAbs(stats.driftSamples));
  const currentDrift = live ? Math.abs(live.drift) : avgDrift;

  const reasons = [];
  let status = "Healthy";

  if (currentDrift > WATCH_DRIFT_MS || avgDrift > WATCH_DRIFT_MS) {
    status = "Needs attention";
    reasons.push(`sustained drift averaging ${avgDrift}ms (threshold ${WATCH_DRIFT_MS}ms)`);
  } else if (currentDrift > HEALTHY_DRIFT_MS) {
    status = "Watch";
    reasons.push(`drift above baseline (${currentDrift}ms)`);
  }

  if (stats.correctionCount >= FREQUENT_CORRECTIONS) {
    status = "Needs attention";
    reasons.push(`${stats.correctionCount} corrections applied — repeated correction suggests an underlying issue, not just noise`);
  }

  if (stats.disconnectCount >= FREQUENT_DISCONNECTS) {
    status = "Needs attention";
    reasons.push(`${stats.disconnectCount} disconnects observed`);
  }

  let recommendation = null;
  if (status === "Needs attention") {
    if (stats.disconnectCount >= FREQUENT_DISCONNECTS) {
      recommendation = "Check the display device's network connectivity, or restart it.";
    } else if (stats.correctionCount >= FREQUENT_CORRECTIONS) {
      recommendation = "Frequent drift corrections indicate possible network instability or CPU contention on the display device — check connectivity or restart it.";
    } else {
      recommendation = "Monitor drift trend; if it continues to exceed threshold, restart the display device.";
    }
  }

  return {
    clientId,
    status,
    currentDriftMs: live ? live.drift : null,
    avgDriftMs: avgDrift,
    correctionCount: stats.correctionCount,
    disconnectCount: stats.disconnectCount,
    reasons,
    recommendation,
  };
}

function generateHealthReport() {
  const liveByClientId = new Map(Array.from(displays.values()).map((d) => [d.clientId, d]));
  const allClientIds = new Set([...liveByClientId.keys(), ...statsByClientId.keys()]);

  const perDisplay = Array.from(allClientIds).map((clientId) =>
    classifyDisplay(clientId, liveByClientId.get(clientId) || null)
  );

  const needsAttention = perDisplay.filter((d) => d.status === "Needs attention");

  return {
    generatedAt: Date.now(),
    engine: "rule-based", // explicitly not an LLM call
    displays: perDisplay,
    summary:
      needsAttention.length === 0
        ? "All displays within normal parameters."
        : `${needsAttention.length} display(s) require attention: ${needsAttention.map((d) => d.clientId).join(", ")}.`,
  };
}


io.on("connection", (socket) => {
  socket.on("controller:join", () => {
    socket.join("controllers");
    socket.emit("videos:list", VIDEOS);
    socket.emit("session:state", publicSession());
    socket.emit("displays:update", publicDisplays());
  });

  socket.on("display:join", ({ clientId }) => {
    displays.set(socket.id, {
      clientId: clientId || socket.id,
      position: 0,
      isPlaying: false,
      isLoading: true,
      lastReportAt: Date.now(),
      drift: 0,
      lastCorrectionAt: 0,
    });
    socket.emit("videos:list", VIDEOS);
    socket.emit("session:state", publicSession());
    broadcastDisplays();
  });

  socket.on("controller:selectVideo", ({ videoId }) => {
    if (!VIDEOS.find((v) => v.id === videoId)) return;
    setSessionState({ videoId, isPlaying: false, positionAtLastUpdate: 0 });
    broadcastState();
  });

  socket.on("controller:play", () => {
    setSessionState({ isPlaying: true });
    broadcastState();
  });

  socket.on("controller:pause", () => {
    setSessionState({ isPlaying: false });
    broadcastState();
  });

  socket.on("controller:seek", ({ position }) => {
    setSessionState({ positionAtLastUpdate: position });
    broadcastState();
  });

  socket.on("controller:restart", () => {
    setSessionState({ positionAtLastUpdate: 0, isPlaying: true });
    broadcastState();
  });

  socket.on("display:status", ({ position, isPlaying, isLoading }) => {
    const d = displays.get(socket.id);
    if (!d) return;

    const now = Date.now();
    const expected = getExpectedPosition(now);
    const drift = Math.round((position - expected) * 1000); // ms

    d.position = position;
    d.isPlaying = isPlaying;
    d.isLoading = isLoading;
    d.drift = drift;
    d.lastReportAt = now;

    const stats = getStats(d.clientId);
    stats.driftSamples.push(drift);
    if (stats.driftSamples.length > 50) stats.driftSamples.shift(); 

    maybeCorrect(socket.id);
    broadcastDisplays();
  });

  socket.on("disconnect", () => {
    const d = displays.get(socket.id);
    if (d) {
      getStats(d.clientId).disconnectCount += 1;
      displays.delete(socket.id);
      broadcastDisplays();
    }
  });

  socket.on("controller:healthReport", () => {
    socket.emit("controller:healthReportResult", generateHealthReport());
  });
});

server.listen(PORT, () => {
  console.log(`Video sync server listening on http://localhost:${PORT}`);
});