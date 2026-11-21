/**
 * End-to-End Calibration Test:
 * Connects extension/ui.js and extension/engine.js
 *
 * Verifies that real engine state snapshots drive the UI rendering,
 * chunk bucket indicators, progress bar, and enable the Save button
 * upon cryptographic verification!
 */

import assert from "node:assert";
import { mount } from "../../extension/ui.js";
import { createEngine } from "../../extension/engine.js";
import { MockMeshTransport } from "./mock-transport.mjs";

// Setup minimal DOM environment for Node.js
globalThis.document = {
  createElement: (tag) => new MockElement(tag),
};
class MockElement {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase();
    this.id = "";
    this.classList = new Set();
    this.children = [];
    this.listeners = {};
    this._innerHTML = "";
    this._elementsById = new Map();
    this.disabled = false;
  }

  get className() {
    return Array.from(this.classList).join(" ");
  }

  set className(val) {
    this.classList = new Set((val || "").split(/\s+/).filter(Boolean));
  }

  get innerHTML() {
    if (this._innerHTML) return this._innerHTML;
    return this.children.map((c) => c.innerHTML).join("");
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this._elementsById.clear();
    const idRegex = /id=["']([^"']+)["']/gi;
    let match;
    while ((match = idRegex.exec(html)) !== null) {
      const el = new MockElement("div");
      el.id = match[1];
      if (html.includes(`disabled`) && match[1] === "lm-btn-save") {
        el.disabled = !html.includes(`lm-btn--success`);
      }
      this._elementsById.set(match[1], el);
    }
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    if (selector.startsWith("#")) {
      const id = selector.slice(1);
      if (this._elementsById.has(id)) return this._elementsById.get(id);
      for (const child of this.children) {
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll() {
    return [];
  }

  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }

  dispatchEvent(event) {
    (this.listeners[event.type] || []).forEach((fn) => fn(event));
  }
}

export async function testUiEngineIntegration() {
  console.log("🧪 Running: UI + Engine End-to-End Calibration integration test...");

  const root = new MockElement("div");
  let savedCalled = false;

  const ui = mount(root, {
    create: () => {},
    join: () => {},
    share: () => {},
    pause: () => {},
    resume: () => {},
    save: () => {
      savedCalled = true;
    },
    leave: () => {},
  });

  const transport = new MockMeshTransport();

  // Host A
  const engineA = createEngine({
    selfId: "peerA",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerA", targetId, payload),
    onState: () => {},
  });

  // Receiver B - drives the UI
  const engineB = createEngine({
    selfId: "peerB",
    hostId: "peerA",
    send: (targetId, payload) => transport.send("peerB", targetId, payload),
    onState: (transferState) => {
      ui.render({
        session: "inRoom",
        selfId: "peerB",
        hostId: "peerA",
        roomCode: "CALIB-42",
        error: null,
        transfer: transferState,
      });
    },
  });

  transport.registerPeer("peerA", engineA);
  transport.registerPeer("peerB", engineB);

  // Connect peers
  await transport.connectPeers("peerA", "peerB");

  // Create 16 KiB fixture (2 chunks)
  const fixture = new Uint8Array(16 * 1024);
  fixture.fill(77);

  // Initial state check
  assert.ok(root.innerHTML.includes("CALIB-42"));

  // Share file
  await engineA.share(fixture, { mode: "normal" });

  // Wait for transfer and UI update
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Timeout waiting for UI to render complete transfer state"));
    }, 5000);

    const check = setInterval(() => {
      if (root.innerHTML.includes("Transfer complete and cryptographically verified")) {
        clearInterval(check);
        clearTimeout(timeout);
        resolve();
      }
    }, 50);
  });

  // Verify UI rendered completion elements
  assert.ok(root.innerHTML.includes("100%"));
  assert.ok(root.innerHTML.includes("Save Verified File"));

  // Trigger Save action
  const saveBtn = root.querySelector("#lm-btn-save");
  assert.ok(saveBtn);
  saveBtn.dispatchEvent({ type: "click" });
  assert.strictEqual(savedCalled, true);

  ui.destroy();
  engineA.close();
  engineB.close();

  console.log("✅ UI + Engine End-to-End Calibration test passed!");
}
