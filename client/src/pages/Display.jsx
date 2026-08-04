import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { socket } from "../socket.js";

const REPORT_INTERVAL_MS = 500;

export default function Display() {
  const { id } = useParams();
  const videoRef = useRef(null);
  const sessionRef = useRef(null); 
  const appliedSeqRef = useRef(-1);

  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState(null);
  const [videos, setVideos] = useState([]);
  const [localPosition, setLocalPosition] = useState(0);
  const [localState, setLocalState] = useState("loading"); 
  const [drift, setDrift] = useState(0);
  const [lastCorrection, setLastCorrection] = useState(null);

  const currentVideo = videos.find((v) => v.id === session?.videoId);

  useEffect(() => {
    socket.connect();

    function onConnect() {
      setConnected(true);
      socket.emit("display:join", { clientId: id });
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onSessionState(s) {
      sessionRef.current = s;
      setSession(s);
    }
    function onCorrect({ position, isPlaying, reason }) {
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = position;
      if (isPlaying) v.play().catch(() => {});
      else v.pause();
      setLastCorrection({ at: Date.now(), reason, position });
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("videos:list", setVideos);
    socket.on("session:state", onSessionState);
    socket.on("display:correct", onCorrect);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("videos:list", setVideos);
      socket.off("session:state", onSessionState);
      socket.off("display:correct", onCorrect);
      socket.disconnect();
    };
  }, [id]);


  useEffect(() => {
    const v = videoRef.current;
    if (!v || !session) return;
    if (session.seq === appliedSeqRef.current) return;
    appliedSeqRef.current = session.seq;

    const applyPlayback = () => {
      v.currentTime = session.expectedPosition;
      if (session.isPlaying) v.play().catch(() => {});
      else v.pause();
    };

    if (v.readyState >= 1) {
      applyPlayback();
    } else {
      v.addEventListener("loadedmetadata", applyPlayback, { once: true });
    }
  }, [session]);

  useEffect(() => {
    const interval = setInterval(() => {
      const v = videoRef.current;
      const s = sessionRef.current;
      if (!v || !s) return;

      const now = Date.now();
      const expected = s.isPlaying
        ? s.expectedPosition + (now - s.serverTime) / 1000
        : s.expectedPosition;

      const position = v.currentTime;
      const driftMs = Math.round((position - expected) * 1000);
      const isPlaying = !v.paused && !v.ended;
      const isLoading = v.readyState < 3;

      setLocalPosition(position);
      setLocalState(isLoading ? "loading" : isPlaying ? "playing" : "paused");
      setDrift(driftMs);

      socket.emit("display:status", { position, isPlaying, isLoading });
    }, REPORT_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  const driftColor = Math.abs(drift) > 400 ? "#d33" : Math.abs(drift) > 150 ? "#c90" : "#2a2";

  return (
    <div style={styles.page}>
      <div style={styles.debugBar}>
        <span><strong>Client ID:</strong> {id}</span>
        <span><strong>Connection:</strong> {connected ? "connected" : "disconnected"}</span>
        <span><strong>State:</strong> {localState}</span>
        <span><strong>Position:</strong> {localPosition.toFixed(2)}s</span>
        <span style={{ color: driftColor }}><strong>Drift:</strong> {drift}ms</span>
        {lastCorrection && (
          <span style={{ color: "#888" }}>
            last correction: {new Date(lastCorrection.at).toLocaleTimeString()} ({lastCorrection.reason})
          </span>
        )}
      </div>

      <div style={styles.videoWrap}>
        {currentVideo ? (
          <video
            ref={videoRef}
            src={currentVideo.url}
            style={styles.video}
            playsInline
            muted
          />
        ) : (
          <div style={styles.placeholder}>Waiting for controller to select a video...</div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: { fontFamily: "monospace", background: "#111", color: "#eee", minHeight: "100vh" },
  debugBar: {
    display: "flex",
    gap: 20,
    flexWrap: "wrap",
    padding: "10px 16px",
    background: "#000",
    borderBottom: "1px solid #333",
    fontSize: 13,
  },
  videoWrap: { display: "flex", justifyContent: "center", alignItems: "center", padding: 16 },
  video: { maxWidth: "90vw", maxHeight: "80vh", background: "#000" },
  placeholder: { padding: 40, color: "#888" },
};
