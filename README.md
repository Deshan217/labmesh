# LabMesh

LabMesh is a local-first peer-to-peer file distribution Chrome extension built for community workshops and classrooms operating on bandwidth-constrained or saturated internet connections. Instead of dozens of laptops downloading the same multi-megabyte starter kit from cloud storage over a sluggish WAN connection, LabMesh enables the instructor to distribute verified chunks directly across nearby laptops over the local Wi-Fi or hotspot via WebRTC data channels.

The project features a **Gemini room guide** that inspects live transfer metadata snapshots (peer count, chunk distribution, completion state) and provides real-time explanations and recommended next actions in **Sinhala** or **English**.

---

## Architecture & Technology Stack

- **Signaling & Room Coordination**: Python 3.11+, FastAPI, Uvicorn (`--ws auto`), WebSockets, Pydantic v2, HTTPX. Runs on laptop B (or a dedicated host). Does not relay file payloads; only negotiates SDP offers/answers and ICE candidates.
- **Peer-to-Peer Data Transport**: Pure browser-native WebRTC (`RTCDataChannel`), configured for ordered, reliable transmission (`binaryType = "arraybuffer"`), with backpressure management using `bufferedAmount` and `bufferedamountlow`.
- **Browser Extension**: Manifest V3 Chrome Extension, 100% build-free and bundler-free using native ES modules. Opens full-page tab from the toolbar icon.
- **AI Guidance**: Google Gemini API (`gemini-3.8-flash` via `generateContent`), securely called server-side from the coordinator using a sanitized transfer snapshot without exposing filenames, payloads, or user identities.
- **Loopback TCP Forwarding**: Zero-dependency Python forwarder (`server/forward.py`) allowing laptops A and C to point to `ws://127.0.0.1:8765/ws` under strict Extension Content Security Policy (`connect-src 'self' ws://127.0.0.1:8765`).

---

## Prerequisites & Installation

- **Python**: Version 3.11 or newer (Python 3.14 verified).
- **Browser**: Desktop Google Chrome (Manifest V3 support).
- **Network**: Local venue Wi-Fi or mobile hotspot permitting client-to-client LAN traffic (no STUN/TURN server required).

### 1. Set Up the Coordinator on Laptop B

Open PowerShell in the repository root on laptop B:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r server/requirements.txt
```

Set your Gemini API key (optional for local WebRTC transfer, required for the Gemini room guide):

```powershell
$secret = Read-Host "Gemini API key" -AsSecureString
$env:GEMINI_API_KEY = [Net.NetworkCredential]::new('', $secret).Password
$env:GEMINI_MODEL = 'gemini-3.8-flash'
```

Start the coordinator service (binds to `0.0.0.0:8765`):

```powershell
.\.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8765 --ws auto --ws-max-size 131072
```

> **Windows Firewall Note**: If Windows Defender Firewall prompts, permit the Python process on **Private networks**.
> Run `ipconfig` on B to determine its Wi-Fi IPv4 address (e.g. `192.168.1.42`).

### 2. Start Forwarders on Laptops A and C

On laptops A and C, open a terminal and run the lightweight standard-library forwarder pointing to laptop B's IP address:

```powershell
python server/forward.py 192.168.1.42
```

This binds local loopback `127.0.0.1:8765` and proxies traffic directly to laptop B.

### 3. Load the Chrome Extension (All Laptops)

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **Load unpacked** and select the `extension/` folder from this repository.
4. Click the **LabMesh** icon in the Chrome toolbar to open `room.html`.
5. All three laptops use the default signaling endpoint: `ws://127.0.0.1:8765/ws`.

---

## Deterministic Test Asset (Workshop Fixture)

Generate the deterministic ~1 MiB test asset with:

```powershell
python demo/fixture.py
```

This creates `demo/workshop.bin` (exactly 1,048,576 bytes) with independent SHA-256:
```
fbbab289f7f94b25736c58be46a994c441fd02552cc6022352e3d86d2fab7c83  workshop.bin
```

On Windows PowerShell, verify the hash at any time:
```powershell
Get-FileHash -Algorithm SHA256 demo\workshop.bin
```

---

## Live Demo & Headline Acceptance Test

### Headline Acceptance Test: Instructor Departure Failover
The core proof of LabMesh's distributed architecture:
1. **Laptop A (Instructor)** creates a room and shares the 8-character code.
2. **Laptop B** and **Laptop C** join the room. All three data channels (A↔B, A↔C, B↔C) open.
3. Instructor A selects `demo/workshop.bin` in **Staged mode**.
4. Instructor A distributes even chunks to Laptop B and odd chunks to Laptop C.
5. Laptops B and C exchange chunk availability (inventory), but hold mutual requests while A is active.
6. Once B and C jointly hold all verified chunks (each missing the other's half) and confirm their direct mutual link is open, the real condition `readyToDisconnect` turns true, displaying:
   `"Ready to disconnect the source"`.
7. **A closes its room tab or disconnects from the Wi-Fi.**
8. Laptops B and C detect A's departure, release the hold, request missing chunks directly from each other over WebRTC, independently reach **Verified**, and trigger **Save verified file**.
9. Both downloaded files yield the identical SHA-256 hash: `fbbab289f7f94b25736c58be46a994c441fd02552cc6022352e3d86d2fab7c83`.

---

## Gemini Room Guide

In the room view, select **Sinhala** or **English** and click **Explain this snapshot**.
The client transmits an anonymous, privacy-safe state snapshot:
```json
{
  "phase": "exchanging",
  "role": "receiver",
  "language": "Sinhala",
  "online_peers": 2,
  "chunks": 128,
  "local_chunks": 64,
  "missing_from_receivers": 0,
  "ready_to_disconnect": true,
  "verified": false
}
```
Laptop B queries Gemini via Google's `generateContent` API using server-side credentials. File contents, filenames, peer names, room codes, and WebRTC SDP/ICE data **never** leave the local network. The generated response gives the instructor a concise, grounded explanation of current swarm health and the recommended next step.

---
## Project Boundaries & Limitations

- **Room Capacity**: Judged MVP supports 3 simultaneous active participants (1 creator, 2 joiners).
- **File Size**: Designed and tested for files from 1 byte up to 8 MiB (demo uses ~1 MiB).
- **Session Memory**: Receivers assemble chunks in browser memory for the session; page refresh resets the session.
- **NAT Traversal**: Relies on LAN/hotspot direct connectivity; public internet STUN/TURN traversal is out of scope for this demo.

---

## Contributors & Work Distribution

- **Team Lead (Signaling, Peer Connections & Integration)**:
  - WebSocket room coordinator & protocol design (`server/main.py`, `server/PROTOCOL.md`).
  - WebRTC connection lifecycle, ICE handling, backpressure & send queueing (`extension/transport.js`).
  - Extension packaging & composition root (`extension/manifest.json`, `extension/worker.js`, `extension/room.html`, `extension/app.js`).
  - Local loopback TCP forwarder (`server/forward.py`).
  - Gemini backend integration & prompt grounding (`server/gemini.py`).
  - Automated integration test suite (`tests/test_lead.py`) & fixture generator (`demo/fixture.py`).
- **Backend Teammate (Distributed Transfer & Integrity)**:
  - Transfer engine module (`extension/engine.js`, `extension/engine/`).
  - Chunk reassembly, rarest-first scheduling, chunk verification and whole-file SHA-256 verification.
  - Staged demo failover state machine & engine unit tests (`tests/engine/`).
- **Frontend Teammate (Extension Room UI & Live Experience)**:
  - Full-page room user interface (`extension/ui.js`, `extension/styles.css`).
  - Interactive chunk visualizer strips, peer matrix, and status labels.
  - UI state rendering and test harness (`tests/ui/`).

---

## AI Disclosure

- **Development AI Usage**: Google Antigravity (powered by Gemini 3.8 Flash) was used during development for scaffolding the team-lead coordinator, designing the WebRTC transport state machine, writing unit tests, and structuring project documentation.
- **Product AI Integration**: The runtime product integrates the Google Gemini API (`gemini-3.8-flash`) via `generateContent` to generate natural-language room guidance grounded in real-time transfer metrics.

---

## OrganizerHQ Submission Reference

- **Project Name**: LabMesh
- **Selected Challenge Tracks**: Community Impact Track, Google Gemini Track.
- **Repository**: Public GitHub repository with MIT License.
- **Google Cloud Project Number**: (Provided in submission form from the Gemini API key project).
- **Demo Video**: 60–120 second unlisted walkthrough demonstrating 3-laptop failover and SHA-256 match.

---

## License

This project is licensed under the [MIT License](LICENSE) - see the LICENSE file for details.
Copyright (c) 2026 LabMesh contributors.
