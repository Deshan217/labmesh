/**
 * Unit tests for Binary Frame & Protocol Encoding/Decoding
 */

import assert from "node:assert";
import { encodeChunkFrame, decodeChunkFrame, Protocol } from "../../extension/engine/protocol.js";

export async function testProtocol() {
  console.log("🧪 Running: Protocol encoding and decoding tests...");

  // Test 1: Binary Chunk Frame roundtrip
  const testPayload = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const encoded = encodeChunkFrame(42, testPayload);

  const decoded = decodeChunkFrame(encoded);
  assert.ok(decoded);
  assert.strictEqual(decoded.chunkIndex, 42);
  assert.deepStrictEqual(Array.from(decoded.data), [10, 20, 30, 40, 50, 60]);

  // Test 2: Invalid/truncated frame
  const truncated = new ArrayBuffer(2); // Less than 4-byte header
  assert.strictEqual(decodeChunkFrame(truncated), null);

  // Test 3: JSON Protocol generators
  const haveMsg = JSON.parse(Protocol.have([0, 1, 2]));
  assert.strictEqual(haveMsg.type, "have");
  assert.deepStrictEqual(haveMsg.chunks, [0, 1, 2]);

  const reqMsg = JSON.parse(Protocol.request(5));
  assert.strictEqual(reqMsg.type, "request");
  assert.strictEqual(reqMsg.index, 5);

  console.log("✅ Protocol tests passed!");
}
