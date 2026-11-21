/**
 * LabMesh Distributed Transfer Engine
 * Conforms strictly to the JIAT Hack Days 2026 contract.
 *
 * Plain ES Module. Runs inside Chrome Extension (MV3) and Node.js.
 */

import {
  CHUNK_SIZE,
  PHASE,
  MODE,
  MSG_TYPE,
} from "./engine/constants.js";
import { sha256Hex } from "./engine/crypto.js";
import { createManifest, validateManifest } from "./engine/manifest.js";
import { encodeChunkFrame, decodeChunkFrame, Protocol } from "./engine/protocol.js";
import { Scheduler } from "./engine/scheduler.js";

/**
 * Creates and initializes a transfer engine instance for a peer.
 *
 * @param {Object} options
 * @param {string} options.selfId
 * @param {string} options.hostId
 * @param {Function} options.send (peerId: string, payload: string | ArrayBuffer) => Promise<void>
 * @param {Function} options.onState (state: TransferState) => void
 * @returns {EngineInstance}
 */
export function createEngine({ selfId, hostId, send, onState }) {
  let closed = false;
  let mode = MODE.NORMAL;
  let phase = PHASE.EMPTY;
  let detail = "Ready";

  // Manifest (immutable once pinned)
  let manifest = null;
  let rawSourceBuffer = null; // Stored if we are the seeder
  let verifiedBlob = null;

  // Stored verified chunks: Map<number, Uint8Array>
  const verifiedChunks = new Map();
  let localVerifiedBytes = 0;

  // Peers tracking: Map<peerId, { name: string, online: boolean, have: Set<number> }>
  const peers = new Map();

  // Self entry in peers list
  peers.set(selfId, {
    name: "Me",
    online: true,
    have: new Set(),
  });

  // Staged demo state tracking
  let demoAssignments = null; // { [peerId]: "even" | "odd" }
  let myDemoAssignment = null; // "even" | "odd" | null
  const confirmedMutualLinks = new Set(); // Set of "peerA:peerB" sorted pairs

  // Periodic scheduler timer
  let schedulerTimer = null;

  // Initialize scheduler
  const scheduler = new Scheduler({
    selfId,
    hostId,
    sendRequest: async (targetPeerId, chunkIndex) => {
      try {
        await send(targetPeerId, Protocol.request(chunkIndex));
      } catch (err) {
        scheduler.clearInFlightChunk(chunkIndex);
      }
    },
  });

  // Helper to safely trigger state updates
  function emitState() {
    if (closed) return;

    const peersArray = Array.from(peers.entries()).map(([id, p]) => ({
      id,
      name: p.name || id,
      online: p.online,
      have: Array.from(p.have).sort((a, b) => a - b),
    }));

    // Calculate readyToDisconnect condition:
    // Only in demo mode where Host is online, exactly 2 receivers exist (B and C),
    // B+C jointly hold every verified chunk, each is still missing at least one,
    // and their mutual link is confirmed open by both.
    let readyToDisconnect = false;

    if (mode === MODE.DEMO && manifest && manifest.chunkCount >= 2) {
      const isHostOnline = isPeerOnline(hostId);
      const receiverPeers = Array.from(peers.entries())
        .filter(([pId, p]) => pId !== hostId && p.online);

      if (isHostOnline && receiverPeers.length === 2) {
        const [p1, p2] = receiverPeers;
        const p1Id = p1[0];
        const p2Id = p2[0];
        const p1Have = p1[1].have;
        const p2Have = p2[1].have;

        const linkKey = [p1Id, p2Id].sort().join(":");
        const mutualLinkOpen = confirmedMutualLinks.has(linkKey);

        if (mutualLinkOpen) {
          // Check if neither receiver has all chunks
          const p1MissingAny = p1Have.size < manifest.chunkCount;
          const p2MissingAny = p2Have.size < manifest.chunkCount;

          if (p1MissingAny && p2MissingAny) {
            // Check if union of p1Have and p2Have covers all chunks
            let allCovered = true;
            for (let i = 0; i < manifest.chunkCount; i++) {
              if (!p1Have.has(i) && !p2Have.has(i)) {
                allCovered = false;
                break;
              }
            }

            if (allCovered) {
              readyToDisconnect = true;
            }
          }
        }
      }
    }

    const state = {
      phase,
      mode,
      fileName: manifest ? manifest.fileName : "",
      fileSize: manifest ? manifest.fileSize : 0,
      chunkCount: manifest ? manifest.chunkCount : 0,
      peers: peersArray,
      localVerifiedBytes,
      verified: phase === PHASE.COMPLETE,
      readyToDisconnect,
      paused: scheduler.isPaused,
      detail,
    };

    onState(state);
  }

  function isPeerOnline(peerId) {
    return peers.get(peerId)?.online === true;
  }

  function runScheduler() {
    if (closed || !manifest || phase === PHASE.COMPLETE || phase === PHASE.ERROR) return;

    scheduler.schedule({
      chunkCount: manifest.chunkCount,
      verifiedChunks: new Set(verifiedChunks.keys()),
      peers,
      hostOnline: isPeerOnline(hostId),
    });
  }

  // Start background tick to retry timed-out requests
  schedulerTimer = setInterval(() => {
    runScheduler();
  }, 1000);

  // Checks if reassembly is possible and verifies full file SHA-256
  async function checkCompletion() {
    if (!manifest || phase === PHASE.COMPLETE) return;

    if (verifiedChunks.size === manifest.chunkCount) {
      phase = PHASE.CHECKING;
      detail = "Verifying whole-file SHA-256 integrity…";
      emitState();

      try {
        const fullBuffer = new Uint8Array(manifest.fileSize);
        let offset = 0;

        for (let i = 0; i < manifest.chunkCount; i++) {
          const chunk = verifiedChunks.get(i);
          if (!chunk) throw new Error(`Missing chunk index ${i} during reassembly`);
          fullBuffer.set(chunk, offset);
          offset += chunk.byteLength;
        }

        const calculatedWholeHash = await sha256Hex(fullBuffer);

        if (calculatedWholeHash.toLowerCase() === manifest.fileHash.toLowerCase()) {
          phase = PHASE.COMPLETE;
          detail = "Transfer complete and cryptographically verified.";
          verifiedBlob = (typeof Blob !== "undefined")
            ? new Blob([fullBuffer])
            : null;
        } else {
          phase = PHASE.ERROR;
          detail = `Integrity check failed: expected ${manifest.fileHash}, got ${calculatedWholeHash}`;
        }
      } catch (err) {
        phase = PHASE.ERROR;
        detail = `Reassembly error: ${err.message}`;
      }

      emitState();
    }
  }

  // Handles incoming binary chunk frame
  async function handleChunkFrame(peerId, rawFrame) {
    if (!manifest) return;

    const decoded = decodeChunkFrame(rawFrame);
    if (!decoded) return;

    const { chunkIndex, data } = decoded;

    // Bounds check
    if (chunkIndex < 0 || chunkIndex >= manifest.chunkCount) return;

    // Already have and verified this chunk? Ignore duplicate.
    if (verifiedChunks.has(chunkIndex)) return;

    // Check expected length
    const isLastChunk = chunkIndex === manifest.chunkCount - 1;
    const expectedLength = isLastChunk
      ? manifest.fileSize - chunkIndex * CHUNK_SIZE
      : CHUNK_SIZE;

    if (data.byteLength !== expectedLength) {
      scheduler.clearInFlightChunk(chunkIndex);
      return;
    }

    // Cryptographic chunk integrity verification
    const computedHash = await sha256Hex(data);
    const expectedHash = manifest.chunkHashes[chunkIndex];

    if (computedHash.toLowerCase() !== expectedHash.toLowerCase()) {
      // Reject corrupted chunk, re-allow scheduling
      scheduler.clearInFlightChunk(chunkIndex);
      return;
    }

    // Chunk is verified! Store it.
    verifiedChunks.set(chunkIndex, data);
    localVerifiedBytes += data.byteLength;
    peers.get(selfId).have.add(chunkIndex);

    scheduler.clearInFlightChunk(chunkIndex);

    // Update phase
    if (phase !== PHASE.COMPLETE && phase !== PHASE.CHECKING) {
      phase = PHASE.EXCHANGING;
      detail = `Verified chunk ${chunkIndex + 1}/${manifest.chunkCount}`;
    }

    // Broadcast `have` to all online peers
    for (const [pId, p] of peers.entries()) {
      if (pId !== selfId && p.online) {
        send(pId, Protocol.have([chunkIndex])).catch(() => {});
      }
    }

    emitState();

    // Check if entire file is ready
    await checkCompletion();

    // Schedule next chunk
    runScheduler();
  }

  // Handles incoming JSON control message
  async function handleControlMessage(peerId, msg) {
    switch (msg.type) {
      case MSG_TYPE.MANIFEST: {
        // Accept only a manifest sent directly by the room's original host
        if (peerId !== hostId) return;

        // Pin manifest for session; reject conflicting replacements
        if (manifest) {
          if (manifest.fileHash !== msg.manifest?.fileHash) {
            detail = "Rejected conflicting manifest replacement.";
            emitState();
          }
          return;
        }

        const validation = validateManifest(msg.manifest);
        if (!validation.valid) {
          phase = PHASE.ERROR;
          detail = `Invalid manifest: ${validation.error}`;
          emitState();
          return;
        }

        manifest = msg.manifest;
        phase = PHASE.EXCHANGING;
        detail = `Received manifest for ${manifest.fileName} (${manifest.chunkCount} chunks).`;
        emitState();

        runScheduler();
        break;
      }

      case MSG_TYPE.HAVE: {
        const peer = peers.get(peerId);
        if (!peer || !Array.isArray(msg.chunks)) return;

        for (const idx of msg.chunks) {
          if (typeof idx === "number" && idx >= 0 && (!manifest || idx < manifest.chunkCount)) {
            peer.have.add(idx);
          }
        }

        emitState();
        runScheduler();
        break;
      }

      case MSG_TYPE.REQUEST: {
        if (!manifest || typeof msg.index !== "number") return;
        const chunkIndex = msg.index;

        // In demo mode: host verifies receiver is requesting its assigned parity
        if (mode === MODE.DEMO && selfId === hostId && demoAssignments) {
          const peerAssign = demoAssignments[peerId];
          const isEven = chunkIndex % 2 === 0;
          if (peerAssign === "even" && !isEven) return;
          if (peerAssign === "odd" && isEven) return;
        }

        // Get chunk data from verified chunks or source buffer
        let chunkData = verifiedChunks.get(chunkIndex);
        if (!chunkData && rawSourceBuffer) {
          const start = chunkIndex * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, rawSourceBuffer.byteLength);
          chunkData = new Uint8Array(rawSourceBuffer.slice(start, end));
        }

        if (chunkData) {
          try {
            const frame = encodeChunkFrame(chunkIndex, chunkData);
            await send(peerId, frame);
          } catch (err) {
            // Channel write error
          }
        }
        break;
      }

      case MSG_TYPE.DEMO_ASSIGN: {
        // Only accept assignments from host
        if (peerId !== hostId) return;

        demoAssignments = msg.assignments;
        if (demoAssignments && demoAssignments[selfId]) {
          myDemoAssignment = demoAssignments[selfId];
          scheduler.setDemoAssignment(myDemoAssignment);
          detail = `Demo assignment received: ${myDemoAssignment} chunks.`;
        }

        emitState();
        runScheduler();
        break;
      }

      case MSG_TYPE.LINK_READY: {
        // Record mutual link between peers
        const linkKey = [msg.from, msg.to].sort().join(":");
        confirmedMutualLinks.add(linkKey);

        emitState();
        break;
      }
    }
  }

  return {
    /**
     * Consumes transport events.
     * @param {{ type: "open" | "close" | "data" | "error", peerId?: string, name?: string, payload?: unknown, message?: string }} event
     */
    async onPeer(event) {
      if (closed) return;

      switch (event.type) {
        case "open": {
          const { peerId, name } = event;
          if (!peerId) return;

          let peer = peers.get(peerId);
          if (!peer) {
            peer = { name: name || peerId, online: true, have: new Set() };
            peers.set(peerId, peer);
          } else {
            peer.online = true;
            if (name) peer.name = name;
          }

          // If this is a receiver-to-receiver connection in demo mode, exchange link_ready
          if (selfId !== hostId && peerId !== hostId) {
            const linkKey = [selfId, peerId].sort().join(":");
            confirmedMutualLinks.add(linkKey);

            // Notify peer and host
            send(peerId, Protocol.linkReady(selfId, peerId)).catch(() => {});
            if (isPeerOnline(hostId)) {
              send(hostId, Protocol.linkReady(selfId, peerId)).catch(() => {});
            }
          }

          // If we are seeder and manifest is pinned, send manifest & our have list
          if (manifest) {
            if (selfId === hostId) {
              send(peerId, Protocol.manifest(manifest)).catch(() => {});
              if (mode === MODE.DEMO && demoAssignments) {
                send(peerId, Protocol.demoAssign(demoAssignments)).catch(() => {});
              }
            }
            if (verifiedChunks.size > 0) {
              const myHaves = Array.from(verifiedChunks.keys());
              send(peerId, Protocol.have(myHaves)).catch(() => {});
            }
          }

          emitState();
          runScheduler();
          break;
        }

        case "close": {
          const { peerId } = event;
          if (!peerId) return;

          const peer = peers.get(peerId);
          if (peer) {
            peer.online = false;
          }

          scheduler.clearInFlightForPeer(peerId);

          // If Host left in demo mode:
          // Receivers automatically release hold and pull missing chunks from each other!
          if (peerId === hostId && mode === MODE.DEMO) {
            detail = "Host disconnected. Failover active: exchanging missing chunks with peer.";
          }

          emitState();
          runScheduler();
          break;
        }

        case "data": {
          const { peerId, payload } = event;
          if (!peerId || !payload) return;

          if (typeof payload === "string") {
            try {
              const parsed = JSON.parse(payload);
              await handleControlMessage(peerId, parsed);
            } catch (err) {
              // Ignore malformed JSON
            }
          } else if (payload instanceof ArrayBuffer || payload instanceof Uint8Array) {
            await handleChunkFrame(peerId, payload);
          }
          break;
        }

        case "error": {
          detail = `Peer error: ${event.message || "Unknown error"}`;
          emitState();
          break;
        }
      }
    },

    /**
     * Shares a local file as seeder (Host A).
     * @param {File | Blob | Uint8Array} file
     * @param {{ mode?: "normal" | "demo" }} [options]
     */
    async share(file, { mode: shareMode = MODE.NORMAL } = {}) {
      if (closed) throw new Error("Engine is closed.");

      mode = shareMode;
      scheduler.setMode(mode);

      // Create and pin manifest
      manifest = await createManifest(file);

      // Cache raw buffer for serving chunks
      if (file instanceof Uint8Array) {
        rawSourceBuffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
      } else if (file instanceof ArrayBuffer) {
        rawSourceBuffer = file;
      } else if (typeof Blob !== "undefined" && file instanceof Blob) {
        rawSourceBuffer = await file.arrayBuffer();
      }

      // Mark all chunks as held by self
      const myHaveSet = peers.get(selfId).have;
      for (let i = 0; i < manifest.chunkCount; i++) {
        myHaveSet.add(i);
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, rawSourceBuffer.byteLength);
        verifiedChunks.set(i, new Uint8Array(rawSourceBuffer.slice(start, end)));
      }

      localVerifiedBytes = manifest.fileSize;
      phase = PHASE.SEEDING;
      detail = `Seeding ${manifest.fileName} (${manifest.chunkCount} chunks) in ${mode} mode.`;

      // In demo mode: calculate even/odd assignments for the other two peers
      if (mode === MODE.DEMO) {
        const receiverIds = Array.from(peers.keys())
          .filter((id) => id !== selfId)
          .sort();

        demoAssignments = {};
        if (receiverIds.length >= 2) {
          demoAssignments[receiverIds[0]] = "even";
          demoAssignments[receiverIds[1]] = "odd";
        } else if (receiverIds.length === 1) {
          demoAssignments[receiverIds[0]] = "even";
        }
      }

      // Broadcast manifest & assignment to all connected peers
      for (const [peerId, peer] of peers.entries()) {
        if (peerId !== selfId && peer.online) {
          await send(peerId, Protocol.manifest(manifest));
          if (mode === MODE.DEMO && demoAssignments) {
            await send(peerId, Protocol.demoAssign(demoAssignments));
          }
          await send(peerId, Protocol.have(Array.from(myHaveSet)));
        }
      }

      emitState();
    },

    pause() {
      scheduler.pause();
      detail = "Transfer paused.";
      emitState();
    },

    resume() {
      scheduler.resume();
      detail = "Transfer resumed.";
      emitState();
      runScheduler();
    },

    getVerifiedBlob() {
      return verifiedBlob;
    },

    close() {
      closed = true;
      if (schedulerTimer) {
        clearInterval(schedulerTimer);
        schedulerTimer = null;
      }
      verifiedChunks.clear();
      rawSourceBuffer = null;
      verifiedBlob = null;
      peers.clear();
    },
  };
}
