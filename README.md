## Bonus: Rule-Based Health Report

Beyond the core requirements, the Controller includes a **Generate Analysis** button that produces a per-display health summary (status, average drift, correction count, disconnect count, and a plain-English recommendation).

Although presented as an analysis feature, the implementation is intentionally a **deterministic rule engine**, not an LLM. The generated payload and UI are explicitly labeled with `"engine": "rule-based"`.

This approach was chosen because operational recommendations should be reproducible and directly traceable to observable metrics. Every recommendation is derived from the same telemetry already visible in the Controller (drift, correction count, and disconnect count) using a small, deterministic set of thresholds, making the output fully inspectable and verifiable.

An additional benefit is that the feature works entirely offline, requiring no API keys or external network dependencies. The structured output produced by `generateHealthReport()` is also designed so that a future LLM-based summarizer could consume the same data without requiring changes to the server API or telemetry pipeline.

---

# Real-Time Multi-Display Video Synchronization System

A Controller application drives playback across multiple Display clients, with synchronization coordinated through a Socket.IO server that maintains the authoritative playback state and automatically corrects client drift.

## Architecture

```text
video-sync/
├── server/   Node.js + Express + Socket.IO (authoritative playback state)
└── client/   React + Vite
    ├── /controller
    └── /display/:id
```

### Why this architecture?

The Controller and each Display act as independent real-time clients communicating with a single authoritative server. Since there are no server-rendered pages or backend routing requirements beyond real-time communication, separating the transport layer (Socket.IO) from the React client keeps the architecture simple and focused.

While a single Next.js application could also satisfy the requirements, it would introduce additional framework complexity without providing meaningful benefits for this use case.

---

# Authoritative Playback State

The server never runs a continuously updating timer.

Instead, it stores:

```js
{
  videoId,
  isPlaying,
  positionAtLastUpdate,
  serverTimestampAtLastUpdate,
  seq
}
```

The current playback position is derived whenever needed.

```
if (isPlaying)
    expected = positionAtLastUpdate +
               (Date.now() - serverTimestampAtLastUpdate) / 1000
else
    expected = positionAtLastUpdate
```

Whenever the Controller issues a command (play, pause, seek, restart, or video change), the server first materializes the current derived playback position into `positionAtLastUpdate`, records a fresh timestamp, applies the requested change, and increments the sequence number.

Because the playback position is always computed from `(positionAtLastUpdate, serverTimestampAtLastUpdate, isPlaying)`, the server itself never accumulates timing drift.

Displays only apply authoritative playback updates when the broadcast `seq` changes, preventing unnecessary seeks or playback interruptions during normal rendering.

---

# Drift Detection and Synchronisation

Every **500 ms**, each Display:

1. Reads its local `<video>.currentTime`
2. Projects the expected playback position from the latest authoritative state
3. Sends its current playback status to the server

```text
{
  position,
  isPlaying,
  isLoading
}
```

The server calculates

```
drift = reportedPosition - expectedPosition
```

and stores the latest drift for display in the Controller dashboard.

Because expected playback is projected from the authoritative timestamp rather than copied from the latest broadcast, normal network latency only affects when updates arrive—not how the expected playback position is calculated.

---

# Drift Correction Strategy

The server uses a simple **threshold + cooldown** strategy.

### Threshold: 400 ms

Small playback differences naturally occur because of decoding latency, event-loop scheduling, and browser timing precision.

Drift below roughly 400 ms is generally not visually noticeable across displays, so no correction is applied.

### Cooldown: 3 seconds

After correcting a display, the server waits at least 3 seconds before issuing another correction to the same client.

Without this cooldown, a buffering display could be repeatedly hard-seeked every status update, resulting in worse playback rather than improved synchronization.

### Correction Method

The implementation performs a hard seek whenever drift exceeds the configured threshold.

A playback-rate adjustment strategy (temporarily nudging playback to approximately 1.02×–1.05× until synchronized) would provide smoother corrections, but a threshold-based hard seek was chosen because it is deterministic, easy to reason about, and straightforward to verify within the assignment scope.

---

# Running Locally

```bash
# Terminal 1
cd server
npm install
npm start
```

Runs the Socket.IO server at:

```
http://localhost:4000
```

```bash
# Terminal 2
cd client
npm install
npm run dev
```

Runs the React application at:

```
http://localhost:5173
```

Open:

```
http://localhost:5173/controller
```

and one or more displays:

```
http://localhost:5173/display/A
http://localhost:5173/display/B
```

Displays autoplay muted because browsers block unmuted autoplay without a user gesture.

To point the client at another server, configure:

```
VITE_SERVER_URL
```

(see `client/.env.example`).

---

# Features

### Controller

- Select video
- Play / Pause
- Seek
- Restart
- Live display table
- Per-display drift monitoring
- Generate rule-based health report

### Display

- Unique display ID
- Responds to all Controller commands
- Periodic playback status updates
- Live debug overlay
- Automatic drift correction

### Server

- Authoritative playback state
- Derived playback position
- Sequence-based synchronization
- Drift detection
- Threshold + cooldown correction
- Disconnect cleanup
- Rule-based display health analysis

---

# Verification

The repository includes a `server/smoke-test.js` script that exercises the complete synchronization flow against a running Socket.IO server.

The smoke test validates:

- Play
- Pause
- Seek
- Restart
- Drift detection
- Drift correction
- Position freezing while paused
- Disconnect handling

This verifies the synchronization logic against a live server rather than relying solely on manual testing.

---

# Future Improvements

Given the project timebox (~6–8 hours), the focus was on correctness of the synchronization loop rather than additional production features.

Potential next steps include:

- Playwright end-to-end tests covering one Controller and multiple Display clients
- Playback-rate based synchronization for smoother drift correction
- Multiple synchronization sessions using Socket.IO rooms
- Authentication and Controller authorization
- Persistent display history across reconnects
- Configurable video catalogue instead of hardcoded sample videos

---

# Deployment

Deployment was optional for the assignment and is therefore not included.

A production deployment would typically consist of:

- **Server:** Render, Railway, Fly.io, or another Node.js host
- **Client:** Vercel or Netlify
- Configure `VITE_SERVER_URL` to point to the deployed server
- Restrict the server's CORS policy to the deployed client origin instead of allowing all origins