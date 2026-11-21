/**
 * Unit tests for Manifest Creation and Validation
 */

import assert from "node:assert";
import { createManifest, validateManifest } from "../../extension/engine/manifest.js";
import { CHUNK_SIZE } from "../../extension/engine/constants.js";

export async function testManifest() {
  console.log("🧪 Running: Manifest creation and validation tests...");

  // Test 1: Small file (smaller than one chunk)
  const smallData = new TextEncoder().encode("Hello LabMesh!");
  const manifestSmall = await createManifest(smallData, "hello.txt");

  assert.strictEqual(manifestSmall.fileName, "hello.txt");
  assert.strictEqual(manifestSmall.fileSize, smallData.byteLength);
  assert.strictEqual(manifestSmall.chunkCount, 1);
  assert.strictEqual(manifestSmall.chunkHashes.length, 1);
  assert.ok(manifestSmall.fileHash);

  const valSmall = validateManifest(manifestSmall);
  assert.strictEqual(valSmall.valid, true);

  // Test 2: Multi-chunk file (e.g. 20 KiB -> 3 chunks)
  const multiData = new Uint8Array(20 * 1024);
  for (let i = 0; i < multiData.length; i++) multiData[i] = i % 256;

  const manifestMulti = await createManifest(multiData, "multi.bin");
  assert.strictEqual(manifestMulti.chunkCount, Math.ceil((20 * 1024) / CHUNK_SIZE));
  assert.strictEqual(manifestMulti.chunkHashes.length, 3);

  const valMulti = validateManifest(manifestMulti);
  assert.strictEqual(valMulti.valid, true);

  // Test 3: Reject tampered manifest
  const tampered = { ...manifestMulti, chunkCount: 99 };
  const valTampered = validateManifest(tampered);
  assert.strictEqual(valTampered.valid, false);

  console.log("✅ Manifest tests passed!");
}
