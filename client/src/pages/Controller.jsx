import { useEffect, useMemo, useState } from "react";
import { socket } from "../socket.js";

const DRIFT_THRESHOLD_MS = 400; 

export default function Controller() {
  const [connected, setConnected] = useState(socket.connected);
  const [session, setSession] = useState(null);
  const [displays, setDisplays] = useState([]);
  const [videos, setVideos] = useState([]);
  const [seekValue, setSeekValue] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [healthReport, setHealthReport] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);

  useEffect(() => {
    socket.connect();

    function onConnect() {
      setConnected(true);
      socket.emit("controller:join");
    }
    function onDisconnect() {
      setConnected(false);
    }
    function onHealthReportResult(report) {
      setHealthReport(report);
      setHealthLoading(false);
    }

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("videos:list", setVideos);
    socket.on("session:state", setSession);
    socket.on("displays:update", setDisplays);
    socket.on("controller:healthReportResult", onHealthReportResult);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("videos:list", setVideos);
      socket.off("session:state", setSession);
      socket.off("displays:update", setDisplays);
      socket.off("controller:healthReportResult", onHealthReportResult);
      socket.disconnect();
    };
  }, []);

  // Tick every 500ms so the "expected position" readout advances visually
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);

  const expectedPosition = useMemo(() => {
    if (!session) return 0;
    if (!session.isPlaying) return session.expectedPosition;
    return session.expectedPosition + (now - session.serverTime) / 1000;
  }, [session, now]);

  const currentVideo = videos.find((v) => v.id === session?.videoId);

  const selectVideo = (videoId) => socket.emit("controller:selectVideo", { videoId });
  const play = () => socket.emit("controller:play");
  const pause = () => socket.emit("controller:pause");
  const restart = () => socket.emit("controller:restart");
  const seekTo = (position) => socket.emit("controller:seek", { position });
  const runHealthReport = () => {
    setHealthLoading(true);
    socket.emit("controller:healthReport");
  };

  return (
    <div style={styles.page}>
      <h1 style={styles.h1}>Controller</h1>
      <p style={styles.status}>
        Server connection: <strong style={{ color: connected ? "#2a2" : "#d33" }}>{connected ? "connected" : "disconnected"}</strong>
      </p>

      <section style={styles.section}>
        <h3>Video</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {videos.map((v) => (
            <button
              key={v.id}
              onClick={() => selectVideo(v.id)}
              style={{
                ...styles.button,
                background: v.id === session?.videoId ? "#2a5" : "#333",
              }}
            >
              {v.title}
            </button>
          ))}
        </div>
        {currentVideo && <p style={styles.dim}>Now selected: {currentVideo.title}</p>}
      </section>

      <section style={styles.section}>
        <h3>Transport</h3>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button style={styles.button} onClick={play} disabled={!currentVideo}>Play</button>
          <button style={styles.button} onClick={pause} disabled={!currentVideo}>Pause</button>
          <button style={styles.button} onClick={restart} disabled={!currentVideo}>Restart</button>
          <span style={styles.dim}>
            Expected position: {expectedPosition.toFixed(2)}s {session?.isPlaying ? "(playing)" : "(paused)"}
          </span>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 8, alignItems: "center" }}>
          <label>Seek to (s):</label>
          <input
            type="number"
            min="0"
            step="1"
            value={seekValue}
            onChange={(e) => setSeekValue(Number(e.target.value))}
            style={styles.input}
          />
          <button style={styles.button} onClick={() => seekTo(seekValue)} disabled={!currentVideo}>
            Seek
          </button>
        </div>
      </section>

      <section style={styles.section}>
        <h3>Displays ({displays.length}) <span style={styles.dim}>— correction threshold: {DRIFT_THRESHOLD_MS}ms</span></h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Client ID</th>
              <th style={styles.th}>Connection</th>
              <th style={styles.th}>State</th>
              <th style={styles.th}>Position (s)</th>
              <th style={styles.th}>Drift (ms)</th>
              <th style={styles.th}>Last report</th>
            </tr>
          </thead>
          <tbody>
            {displays.length === 0 && (
              <tr><td style={styles.td} colSpan={6}>No displays connected yet. Open /display/&lt;id&gt; in another tab.</td></tr>
            )}
            {displays.map((d) => {
              const driftAbs = Math.abs(d.drift);
              const driftColor = driftAbs > DRIFT_THRESHOLD_MS ? "#d33" : driftAbs > 150 ? "#c90" : "#2a2";
              return (
                <tr key={d.clientId}>
                  <td style={styles.td}>{d.clientId}</td>
                  <td style={styles.td}>connected</td>
                  <td style={styles.td}>{d.isLoading ? "loading" : d.isPlaying ? "playing" : "paused"}</td>
                  <td style={styles.td}>{d.position?.toFixed(2)}</td>
                  <td style={{ ...styles.td, color: driftColor, fontWeight: "bold" }}>{d.drift}</td>
                  <td style={styles.td}>{new Date(d.lastReportAt).toLocaleTimeString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={styles.section}>
        <h3>
          Health Report{" "}
          <span style={styles.dim}>— rule-based analysis, not an LLM call</span>
        </h3>
        <button style={styles.button} onClick={runHealthReport} disabled={healthLoading}>
          {healthLoading ? "Analyzing..." : "Generate Analysis"}
        </button>

        {healthReport && (
          <div style={styles.reportBox}>
            <p style={{ marginTop: 0 }}>
              <strong>{healthReport.summary}</strong>
            </p>
            {healthReport.displays.length === 0 && (
              <p style={styles.dim}>No display history yet.</p>
            )}
            {healthReport.displays.map((d) => (
              <div key={d.clientId} style={styles.reportRow}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <strong>{d.clientId}</strong>
                  <span
                    style={{
                      color:
                        d.status === "Needs attention"
                          ? "#d33"
                          : d.status === "Watch"
                          ? "#c90"
                          : "#2a2",
                      fontWeight: "bold",
                    }}
                  >
                    {d.status}
                  </span>
                </div>
                <p style={styles.dim}>
                  avg drift {d.avgDriftMs}ms · {d.correctionCount} corrections · {d.disconnectCount} disconnects
                </p>
                {d.reasons.length > 0 && (
                  <ul style={{ margin: "4px 0", paddingLeft: 18, fontSize: 13 }}>
                    {d.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                )}
                {d.recommendation && (
                  <p style={{ fontSize: 13 }}>
                    <strong>Recommended action:</strong> {d.recommendation}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

const styles = {
  page: { fontFamily: "sans-serif", padding: 24, maxWidth: 900, margin: "0 auto" },
  h1: { marginBottom: 4 },
  status: { color: "#555" },
  section: { marginTop: 24, paddingTop: 16, borderTop: "1px solid #ddd" },
  button: { padding: "8px 14px", borderRadius: 6, border: "none", background: "#333", color: "#fff", cursor: "pointer" },
  input: { padding: "6px 8px", width: 80 },
  dim: { color: "#888", fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", marginTop: 8 },
  th: { textAlign: "left", borderBottom: "2px solid #333", padding: "6px 8px", fontSize: 13 },
  td: { borderBottom: "1px solid #eee", padding: "6px 8px", fontSize: 13 },
  reportBox: { marginTop: 12, padding: 12, background: "#fafafa", border: "1px solid #eee", borderRadius: 6 },
  reportRow: { padding: "8px 0", borderTop: "1px solid #eee" },
};