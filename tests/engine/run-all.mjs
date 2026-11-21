/**
 * LabMesh Engine Test Suite Runner
 * Runs using native Node.js: node tests/engine/run-all.mjs
 */

import { testManifest } from "./manifest.test.mjs";
import { testProtocol } from "./protocol.test.mjs";
import { testTwoPeer } from "./two-peer.test.mjs";
import { testThreePeerDemo } from "./three-peer-demo.test.mjs";
import { testIntegrityFailure } from "./integrity-failure.test.mjs";

async function runAll() {
  console.log("==========================================");
  console.log("🚀 LabMesh Backend Engine Automated Tests");
  console.log("==========================================\n");

  const start = Date.now();

  try {
    await testManifest();
    await testProtocol();
    await testTwoPeer();
    await testThreePeerDemo();
    await testIntegrityFailure();

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log("\n==========================================");
    console.log(`🎉 ALL TESTS PASSED SUCCESSFULLY! (${duration}s)`);
    console.log("==========================================");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ TEST SUITE FAILED:");
    console.error(err);
    process.exit(1);
  }
}

runAll();
