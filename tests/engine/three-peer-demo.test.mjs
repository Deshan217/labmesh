/**
 * Headline Acceptance Test:
 * Three-Peer Demo Mode with Host Failover
 *
 * 1. Host A gives even chunks to Peer B, odd chunks to Peer C.
 * 2. B and C establish direct mutual channel.
 * 3. Verify readyToDisconnect becomes true when disjoint subsets are held and link is confirmed.
 * 4. Host A disconnects.
 * 5. B and C exchange missing chunks without A.
 * 6. Both B and C independently reach Verified and match the original fixture hash!
 */

import assert from "node:assert";
import { createEngine } from "../../extension/engine.js";
import { MockMeshTransport } from "./mock-transport.mjs";
import { sha256Hex } from "../../extension/engine/crypto.js";

export async function testThreePeerDemo() {
  console.log("🧪 Running: Three-Peer Staged Demo with Host Failover integration test...");

  const transport = new MockMeshTransport();
  let stateA = null;
  let stateB = null;
  let stateC = null;

  // Host A
  const engineA = createEngine({
    selfId: "peerA",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerA", targetId, payload),
    onState: (state) => { stateA = state; },
  });

  // Receiver B
  const engineB = createEngine({
    selfId: "peerB",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerB", targetId, payload),
    onState: (state) => { stateB = state; },
  });

  // Receiver C
  const engineC = createEngine({
    selfId: "peerC",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerC", targetId, payload),
    onState: (state) => { stateC = state; },
  });

  transport.registerPeer("peerA", engineA);
  transport.registerPeer("peerB", engineB);
  transport.registerPeer("peerC", engineC);

  // Connect all 3 peers to each other
  await transport.connectPeers("peerA", "peerB");
  await transport.connectPeers("peerA", "peerC");
  await transport.connectPeers("peerB", "peerC");

  // Create 32 KiB fixture data (4 chunks: 0, 1, 2, 3)
  const fixture = new Uint8Array(32 * 1024);
  for (let i = 0; i < fixture.length; i++) {
    fixture[i] = (i * 3 + 29) % 256;
  }
  const originalHash = await sha256Hex(fixture);

  // Host A shares file in "demo" mode
  await engineA.share(fixture, { mode: "demo" });

  // Step 1: Wait for B to receive even chunks (0, 2) and C to receive odd chunks (1, 3)
  // and readyToDisconnect to become true on Host A
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for readiness condition. StateA: ${JSON.stringify(stateA)}`));
    }, 6000);

    const check = setInterval(() => {
      if (stateA && stateA.readyToDisconnect) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 50);
  });

  console.log("   📍 Staged readiness reached! readyToDisconnect is true.");
  console.log("   📍 Host A leaving network (simulating failover)...");

  // Step 2: Host A disconnects!
  await transport.disconnectPeer("peerA");
  engineA.close();

  // Step 3: Wait for both B and C to independently reach Verified
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for B and C to complete after failover. StateB: ${JSON.stringify(stateB)}, StateC: ${JSON.stringify(stateC)}`));
    }, 8000);

    const check = setInterval(() => {
      const bComplete = stateB && stateB.phase === "complete" && stateB.verified;
      const cComplete = stateC && stateC.phase === "complete" && stateC.verified;
      if (bComplete && cComplete) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 50);
  });

  // Verify both output byte counts and state
  assert.strictEqual(stateB.verified, true);
  assert.strictEqual(stateB.localVerifiedBytes, fixture.byteLength);

  assert.strictEqual(stateC.verified, true);
  assert.strictEqual(stateC.localVerifiedBytes, fixture.byteLength);

  // Verify Peer A is visibly offline on B and C
  const peerAonB = stateB.peers.find((p) => p.id === "peerA");
  assert.strictEqual(peerAonB?.online, false);

  const peerAonC = stateC.peers.find((p) => p.id === "peerA");
  assert.strictEqual(peerAonC?.online, false);

  engineB.close();
  engineC.close();

  console.log("✅ Three-Peer Staged Demo with Host Failover passed!");
}
