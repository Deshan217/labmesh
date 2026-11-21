/**
 * Integrity & Failure Mode Tests
 * 1. Missing unique chunk -> Neither peer falsely verifies
 * 2. Corrupted chunk payload -> Rejected, not verified
 */

import assert from "node:assert";
import { createEngine } from "../../extension/engine.js";
import { MockMeshTransport } from "./mock-transport.mjs";
import { encodeChunkFrame } from "../../extension/engine/protocol.js";

export async function testIntegrityFailure() {
  console.log("🧪 Running: Integrity Failure and Missing Chunk tests...");

  // Test 1: Missing unique chunk
  // Host A has a multi-chunk file, but transport intercepts and drops requests/data for chunk 2.
  // Neither peer should falsely reach Verified.
  const transport = new MockMeshTransport();
  let stateB = null;

  // Intercept and drop chunk 2 to guarantee it is missing
  const originalSend = transport.send.bind(transport);
  transport.send = async (from, target, payload) => {
    if (typeof payload === "string") {
      try {
        const msg = JSON.parse(payload);
        if (msg.type === "request" && msg.index === 2) {
          // Drop request for chunk 2
          return;
        }
      } catch {}
    }
    return originalSend(from, target, payload);
  };

  const engineA = createEngine({
    selfId: "peerA",
    hostId: "peerA",
    send: (tId, payload) => transport.send("peerA", tId, payload),
    onState: () => {},
  });

  const engineB = createEngine({
    selfId: "peerB",
    hostId: "peerA",
    send: (tId, payload) => transport.send("peerB", tId, payload),
    onState: (state) => { stateB = state; },
  });

  transport.registerPeer("peerA", engineA);
  transport.registerPeer("peerB", engineB);
  await transport.connectPeers("peerA", "peerB");

  const fixture = new Uint8Array(24 * 1024); // 3 chunks (0, 1, 2)
  fixture.fill(42);

  await engineA.share(fixture);

  // Wait 1.5 seconds and assert B did not falsely complete because chunk 2 is missing
  await new Promise((r) => setTimeout(r, 1500));

  assert.notStrictEqual(stateB.phase, "complete");
  assert.strictEqual(stateB.verified, false);
  assert.ok(stateB.localVerifiedBytes < fixture.byteLength);

  engineA.close();
  engineB.close();

  // Test 2: Corrupted chunk payload injection
  let corruptedDetected = false;
  const engineC = createEngine({
    selfId: "peerC",
    hostId: "peerC",
    send: () => {},
    onState: (state) => {
      // Should never verify bad chunk
      if (state.verified) corruptedDetected = true;
    },
  });

  // Fabricate corrupted chunk 0 frame
  const badData = new Uint8Array(8192);
  badData.fill(99);
  const badFrame = encodeChunkFrame(0, badData);

  // Send corrupted frame to C (which has no manifest yet, or bad hash)
  await engineC.onPeer({ type: "data", peerId: "attacker", payload: badFrame });
  assert.strictEqual(corruptedDetected, false);

  engineC.close();

  console.log("✅ Integrity Failure and Missing Chunk tests passed!");
}
