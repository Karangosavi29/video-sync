# Real-Time Multi-Display Video Synchronization System

A Controller application that drives synchronized video playback across multiple Display clients using Socket.IO.

The server acts as the **authoritative source of playback state**, calculates expected playback position, detects client drift, and automatically corrects displays when they fall out of sync.

---

# Architecture

```
video-sync/
├── server/   Node.js + Express + Socket.IO (authoritative state)
└── client/   React + Vite
    ├── /controller
    └── /display/:id
```

## Why this architecture?

The Controller and Displays are independent real-time clients connected through a single server that owns the playback state.

A separate Node.js + Socket.IO server keeps the synchronization logic centralized and avoids relying on clients to coordinate with each other.

A single Next.js application could also work, but it would introduce additional framework complexity without providing meaningful benefits for this real-time communication use case.

---

# How Playback Synchronization Works

The server does not run a continuously updating playback timer.

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

The current playback position is calculated dynamically:

```
if playing:
    expectedPosition =
      positionAtLastUpdate +
      (currentTime - serverTimestampAtLastUpdate)

if paused:
    expectedPosition =
      positionAtLastUpdate
```

Whenever a Controller action occurs:

- Play
- Pause
- Seek
- Restart
- Video change

The server first calculates the current position, stores it, updates the requested state, and increments the sequence number.

This means the authoritative position is always derived from:

```
(positionAtLastUpdate, serverTimestampAtLastUpdate, isPlaying)
```

No server-side timer runs, so timing drift does not accumulate.

Displays only apply playback changes when the server `seq` value changes, preventing unnecessary seeks during normal rendering.

---

# Drift Detection and Correction

Every 500ms, each Display sends:

```json
{
  "position": 12.54,
  "isPlaying": true,
  "isLoading": false
}
```

The server compares:

```
display position - expected server position
```

and records the drift for the Controller dashboard.

Because expected playback is projected from the authoritative timestamp, network latency affects update timing but not the calculated playback position.

---

# Correction Strategy

The synchronization system uses a simple **threshold + cooldown** strategy.

## Drift Threshold

```
400ms
```

Small timing differences naturally occur due to:

- Browser scheduling
- Video decoding
- Event-loop timing
- Seek precision

Drift below this threshold is ignored.

## Correction Cooldown

```
3000ms
```

After correcting a Display, the server waits 3 seconds before allowing another correction for that Display.

This prevents repeated hard seeks when a client is buffering or temporarily unstable.

## Correction Method

When drift exceeds the threshold:

- The server sends a correction command.
- The Display seeks to the authoritative playback position.

A smoother future improvement would be playback-rate correction (for example temporarily adjusting to 1.02x or 0.98x), but hard seeking was chosen because it is simple, deterministic, and easy to verify.

---

# Bonus: Rule-Based Health Analysis

The Controller includes a **Generate Analysis** button that creates a health summary for each connected Display.

The report includes:

- Status
- Average drift
- Correction count
- Disconnect count
- Plain-English recommendation

Although exposed as an analysis feature, this is intentionally a **rule-based engine**, not an LLM call.

The payload and UI identify it as:

```json
{
  "engine": "rule-based"
}
```

The recommendation is generated from the same telemetry already visible in the Controller:

- Drift values
- Correction frequency
- Disconnect history

This approach provides:

- Fully traceable recommendations
- Deterministic results
- No API dependency
- Offline functionality

The structured output from `generateHealthReport()` is also suitable input for a future LLM summarization layer if needed.

---

# Running Locally

## Start Server

```bash
cd server
npm install
npm start
```

Server runs at:

```
http://localhost:4000
```

---

## Start Client

```bash
cd client
npm install
npm run dev
```

Client runs at:

```
http://localhost:5173
```

---

# Using the Application

Open the Controller:

```
http://localhost:5173/controller
```

Open Displays in separate browser tabs:

```
http://localhost:5173/display/A
http://localhost:5173/display/B
```

Any unique ID can be used:

```
/display/roomTV1
/display/screen-2
/display/lobby
```

Each ID becomes a separate Display entry in the Controller.

---

# Testing Synchronization

After opening displays:

1. The Controller should show connected Displays.
2. Select a video:
   - Big Buck Bunny
   - Elephants Dream
3. Click **Play**.
4. Verify all Displays start together.
5. Test:
   - Pause
   - Seek
   - Restart

The Controller table shows:

- Connection status
- Playback position
- Playing state
- Drift

Drift should normally remain small.

---

# Testing Drift Correction

To see correction behavior:

1. Start playback.
2. Move one Display tab into the background.
3. Leave it for around 5 seconds.
4. Return to the tab.

Background browser throttling will cause the Display to fall behind.

The Controller should show:

1. Drift increasing.
2. Correction being triggered.
3. Display returning to the correct position.

---

# Generate Health Report

Click:

```
Generate Analysis
```

The Controller will generate a rule-based health summary for all connected Displays.

---

# Features Implemented

## Controller

- Video selection
- Play / Pause controls
- Seek control
- Restart control
- Connected Display table
- Live drift monitoring
- Rule-based health analysis

## Display

- Unique Display ID
- Receives playback commands
- Sends playback telemetry
- Debug information overlay
- Automatic synchronization correction

## Server

- Authoritative playback state
- Derived playback position
- Socket.IO communication
- Drift calculation
- Correction handling
- Disconnect cleanup
- Health report generation

---

# Verification

The project includes:

```
server/smoke-test.js
```

The smoke test runs against a live Socket.IO server and verifies:

- Play
- Pause
- Seek
- Restart
- Drift detection
- Drift correction
- Position freezing while paused
- Disconnect handling

---

# Environment Configuration

For deployment, configure the client environment variable:

`client/.env`

```env
VITE_SERVER_URL=http://localhost:4000
```

For production, replace the value with the deployed server URL:

```env
VITE_SERVER_URL=https://your-server-domain.com
```

Commit only:

```
client/.env.example
```

Do not commit:

```
client/.env
```

---

# Future Improvements

Given the project time constraint, priority was placed on synchronization correctness and verification.

Possible improvements:

- Playwright end-to-end browser tests
- Playback-rate based drift correction
- Multiple sessions using Socket.IO rooms
- Authentication and authorization
- Persistent display history
- Dynamic video catalogue
- Production monitoring metrics

---

# Deployment

Deployment was optional for this assignment.

A production deployment would typically use:

### Client

- Vercel
- Netlify

### Server

- Render
- Railway
- Fly.io

The deployed client should point to the server using:

```
VITE_SERVER_URL
```

For production, restrict Socket.IO CORS settings to the deployed client domain instead of allowing all origins.
