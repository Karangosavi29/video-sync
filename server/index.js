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
  io.to(socketId).emit("display:correct", {
    position: target,
    isPlaying: session.isPlaying,
    reason: "drift-threshold-exceeded",
    seq: session.seq,
  });
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

    maybeCorrect(socket.id);
    broadcastDisplays();
  });

  socket.on("disconnect", () => {
    if (displays.has(socket.id)) {
      displays.delete(socket.id);
      broadcastDisplays();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Video sync server listening on http://localhost:${PORT}`);
});
