const { io } = require("socket.io-client");

const URL = "http://localhost:4000";

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const controller = io(URL);
  const display = io(URL);

  await new Promise((resolve) => controller.on("connect", resolve));
  await new Promise((resolve) => display.on("connect", resolve));
  console.log("[ok] both sockets connected");

  controller.emit("controller:join");
  display.emit("display:join", { clientId: "display-A" });

  let latestSession = null;
  let latestDisplays = null;
  let corrected = false;

  controller.on("session:state", (s) => (latestSession = s));
  controller.on("displays:update", (d) => (latestDisplays = d));
  display.on("display:correct", () => (corrected = true));

  await wait(300);
  console.log("[check] initial session:", latestSession);

  // Select video + play
  controller.emit("controller:selectVideo", { videoId: latestSession.videoId });
  controller.emit("controller:play");
  await wait(300);
  console.log("[check] after play, isPlaying =", latestSession.isPlaying);
  if (!latestSession.isPlaying) throw new Error("FAIL: session should be playing");

  await wait(500); 
  const fakeAheadPosition = latestSession.expectedPosition + 5; 
  display.emit("display:status", { position: fakeAheadPosition, isPlaying: true, isLoading: false });
  await wait(300);

  console.log("[check] displays after drifted report:", JSON.stringify(latestDisplays));
  const reported = latestDisplays.find((d) => d.clientId === "display-A");
  if (!reported) throw new Error("FAIL: display not visible to controller");
  if (Math.abs(reported.drift) < 4000) throw new Error("FAIL: drift not computed correctly, got " + reported.drift);
  console.log("[ok] drift computed:", reported.drift, "ms");

  if (!corrected) throw new Error("FAIL: display should have received a correction for >threshold drift");
  console.log("[ok] correction event fired for excessive drift");

  // Pause and confirm position freezes
  controller.emit("controller:pause");
  await wait(200);
  const posAfterPause1 = latestSession.expectedPosition;
  await wait(500);
  const posAfterPause2 = latestSession.expectedPosition;
  if (Math.abs(posAfterPause1 - posAfterPause2) > 0.01) throw new Error("FAIL: position should not advance while paused");
  console.log("[ok] position frozen while paused");

  // Seek
  controller.emit("controller:seek", { position: 42 });
  await wait(200);
  if (Math.abs(latestSession.expectedPosition - 42) > 0.1) throw new Error("FAIL: seek did not apply, got " + latestSession.expectedPosition);
  console.log("[ok] seek applied, position =", latestSession.expectedPosition);

  // Restart
  controller.emit("controller:restart");
  await wait(200);
  if (Math.abs(latestSession.expectedPosition) > 0.2 || !latestSession.isPlaying) throw new Error("FAIL: restart should reset to 0 and play");
  console.log("[ok] restart resets to 0 and resumes playing");

  // Disconnect display, confirm controller sees it drop
  display.disconnect();
  await wait(300);
  if (latestDisplays.find((d) => d.clientId === "display-A")) throw new Error("FAIL: disconnected display still listed");
  console.log("[ok] disconnected display removed from controller view");

  controller.disconnect();
  console.log("\nALL SMOKE TESTS PASSED");
  process.exit(0);
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err.message);
  process.exit(1);
});
