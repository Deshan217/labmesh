/**
 * LabMesh Receiver-Pull Scheduler
 * Implements rarest-first scheduling, deterministic tie-breaking, bounded in-flight requests,
 * retry deadlines, and demo-mode request gating.
 */

import { MAX_IN_FLIGHT_PER_PEER, REQUEST_TIMEOUT_MS, MODE } from "./constants.js";

export class Scheduler {
  /**
   * @param {Object} options
   * @param {string} options.selfId
   * @param {string} options.hostId
   * @param {Function} options.sendRequest (peerId, chunkIndex) => Promise<void>
   */
  constructor({ selfId, hostId, sendRequest }) {
    this.selfId = selfId;
    this.hostId = hostId;
    this.sendRequest = sendRequest;

    this.mode = MODE.NORMAL;
    this.demoAssignment = null; // "even" | "odd" | null
    this.isPaused = false;

    // chunkIndex -> { peerId, timestamp }
    this.inFlight = new Map();
  }

  setMode(mode) {
    this.mode = mode;
  }

  setDemoAssignment(assignment) {
    this.demoAssignment = assignment;
  }

  pause() {
    this.isPaused = true;
    this.inFlight.clear();
  }

  resume() {
    this.isPaused = false;
  }

  clearInFlightForPeer(peerId) {
    for (const [chunkIndex, req] of this.inFlight.entries()) {
      if (req.peerId === peerId) {
        this.inFlight.delete(chunkIndex);
      }
    }
  }

  clearInFlightChunk(chunkIndex) {
    this.inFlight.delete(chunkIndex);
  }

  /**
   * Evaluates pending chunks and dispatches requests.
   *
   * @param {Object} ctx
   * @param {number} ctx.chunkCount
   * @param {Set<number>} ctx.verifiedChunks Set of chunk indexes we already have and verified
   * @param {Map<string, { online: boolean, have: Set<number>, activeRequests: number }>} ctx.peers
   * @param {boolean} ctx.hostOnline Is the original host currently connected?
   */
  schedule(ctx) {
    if (this.isPaused || !ctx.chunkCount) return;

    const now = Date.now();

    // Expire timed-out in-flight requests
    for (const [chunkIndex, req] of this.inFlight.entries()) {
      if (now - req.timestamp > REQUEST_TIMEOUT_MS) {
        this.inFlight.delete(chunkIndex);
      }
    }

    // Find missing chunks
    const missing = [];
    for (let i = 0; i < ctx.chunkCount; i++) {
      if (!ctx.verifiedChunks.has(i)) {
        missing.push(i);
      }
    }

    if (missing.length === 0) return;

    // For each missing chunk, determine which online peers have it
    const chunkCandidates = [];

    for (const chunkIndex of missing) {
      if (this.inFlight.has(chunkIndex)) continue;

      // Filter by demo mode gating if host is still online
      if (this.mode === MODE.DEMO && ctx.hostOnline) {
        if (this.selfId !== this.hostId) {
          // As a receiver in demo mode with Host online:
          // Only request assigned parity from Host!
          const isEven = (chunkIndex % 2 === 0);
          const matchesParity = (this.demoAssignment === "even" && isEven) ||
                                (this.demoAssignment === "odd" && !isEven);

          if (!matchesParity) {
            // Wait until host leaves to request from other receiver
            continue;
          }
        }
      }

      // Find available online peers for this chunk
      const availablePeers = [];
      for (const [peerId, peer] of ctx.peers.entries()) {
        if (peerId === this.selfId || !peer.online) continue;

        // In demo mode with Host online, receiver only requests from host
        if (this.mode === MODE.DEMO && ctx.hostOnline && this.selfId !== this.hostId) {
          if (peerId !== this.hostId) continue;
        }

        if (peer.have.has(chunkIndex)) {
          availablePeers.push(peerId);
        }
      }

      if (availablePeers.length > 0) {
        chunkCandidates.push({
          chunkIndex,
          availablePeers,
          rarity: availablePeers.length,
        });
      }
    }

    // Sort by:
    // 1. Rarest first (lowest rarity)
    // 2. Deterministic tie-breaker (lowest chunkIndex)
    chunkCandidates.sort((a, b) => {
      if (a.rarity !== b.rarity) return a.rarity - b.rarity;
      return a.chunkIndex - b.chunkIndex;
    });

    // Count in-flight per peer
    const peerInFlightCount = new Map();
    for (const req of this.inFlight.values()) {
      peerInFlightCount.set(req.peerId, (peerInFlightCount.get(req.peerId) || 0) + 1);
    }

    // Dispatch requests
    for (const item of chunkCandidates) {
      // Pick peer with lowest current active requests
      const eligiblePeers = item.availablePeers.filter(
        (pId) => (peerInFlightCount.get(pId) || 0) < MAX_IN_FLIGHT_PER_PEER
      );

      if (eligiblePeers.length === 0) continue;

      // Deterministic peer selection: sort by inFlight asc, then lexicographically by peerId
      eligiblePeers.sort((pA, pB) => {
        const countA = peerInFlightCount.get(pA) || 0;
        const countB = peerInFlightCount.get(pB) || 0;
        if (countA !== countB) return countA - countB;
        return pA.localeCompare(pB);
      });

      const targetPeerId = eligiblePeers[0];

      // Mark in-flight
      this.inFlight.set(item.chunkIndex, {
        peerId: targetPeerId,
        timestamp: Date.now(),
      });
      peerInFlightCount.set(targetPeerId, (peerInFlightCount.get(targetPeerId) || 0) + 1);

      // Send request
      this.sendRequest(targetPeerId, item.chunkIndex);
    }
  }
}
