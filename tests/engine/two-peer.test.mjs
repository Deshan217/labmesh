/**
 * Integration Test: Two-Peer Happy Path Transfer
 */

import assert from "node:assert";
import { createEngine } from "../../extension/engine.js";
import { MockMeshTransport } from "./mock-transport.mjs";
import { sha256Hex } from "../../extension/engine/crypto.js";

export async function testTwoPeer() {
  console.log("🧪 Running: Two-Peer Happy Path integration test...");

  const transport = new MockMeshTransport();
  let peerBState = null;

  // Host A
  const engineA = createEngine({
    selfId: "peerA",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerA", targetId, payload),
    onState: () => {},
  });

  // Receiver B
  const engineB = createEngine({
    selfId: "peerB",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerB", targetId, payload),
    onState: (state) => {
      peerBState = state;
    },
  });

  transport.registerPeer("peerA", engineA);
  transport.registerPeer("peerB", engineB);

  // Connect A and B
  await transport.connectPeers("peerA", "peerB");

  // Create 24 KiB fixture data (3 chunks of 8 KiB)
  const fixture = new Uint8Array(24 * 1024);
  for (let i = 0; i < fixture.length; i++) {
    fixture[i] = (i * 7 + 13) % 256;
  }
  const expectedHash = await sha256Hex(fixture);

  // Peer A shares file
  await engineA.share(fixture, { mode: "normal" });

  // Wait for transfer completion on Peer B
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timeout waiting for Peer B transfer to complete. Current state: ${JSON.stringify(peerBState)}`));
    }, 5000);

    const check = setInterval(() => {
      if (peerBState && peerBState.phase === "complete" && peerBState.verified) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 50);
  });

  assert.strictEqual(peerBState.verified, true);
  assert.strictEqual(peerBState.localVerifiedBytes, fixture.byteLength);

  engineA.close();
  engineB.close();

  console.log("✅ Two-Peer Happy Path test passed!");
}
