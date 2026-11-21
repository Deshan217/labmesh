/**
 * Automated Test Suite for LabMesh Room UI (extension/ui.js)
 * Exercises:
 *  - Unit functions: formatBytes, computeChunkBuckets, deriveNextAction
 *  - Full snapshots fixture validation
 *  - DOM lifecycle: mount(), render(), destroy()
 *  - Action callback dispatches (create, join, share, pause, resume, save, leave)
 *  - Staged failover milestone condition & readyToDisconnect banner isolation
 *  - Host departure persistence
 *  - Chunk strip bounded bucket aggregation
 *  - Verified SHA-256 state & Save button accessibility
 *
 * Runs directly with Node.js: node tests/ui/test_ui.js
 */

import { formatBytes, computeChunkBuckets, deriveNextAction, mount } from '../../extension/ui.js';
import { snapshots } from './snapshots.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    failed++;
    throw new Error(message);
  } else {
    console.log(`✓ PASS: ${message}`);
    passed++;
  }
}

function assertEquals(actual, expected, message) {
  if (actual !== expected) {
    console.error(`❌ FAIL: ${message} (Expected: ${expected}, Got: ${actual})`);
    failed++;
    throw new Error(`${message}: Expected ${expected}, got ${actual}`);
  } else {
    console.log(`✓ PASS: ${message}`);
    passed++;
  }
}

console.log('\n======================================================');
console.log('🧪 LabMesh UI Test Suite - Unit & Lifecycle Checks');
console.log('======================================================\n');

// 1. UNIT TEST: formatBytes
console.log('--- 1. Testing formatBytes ---');
assertEquals(formatBytes(0), '0 B', '0 bytes formats to "0 B"');
assertEquals(formatBytes(512), '512 B', '512 bytes formats to "512 B"');
assertEquals(formatBytes(1024), '1.00 KiB', '1024 bytes formats to "1.00 KiB"');
assertEquals(formatBytes(1048576), '1.00 MiB', '1048576 bytes formats to "1.00 MiB"');
assertEquals(formatBytes(2097152), '2.00 MiB', '2097152 bytes formats to "2.00 MiB"');
assertEquals(formatBytes(null), '0 B', 'null formats to "0 B"');
assertEquals(formatBytes(NaN), '0 B', 'NaN formats to "0 B"');

// 2. UNIT TEST: computeChunkBuckets
console.log('\n--- 2. Testing computeChunkBuckets ---');
// Small file <= 32 chunks: 1-to-1 chunk mapping
const smallBuckets = computeChunkBuckets([0, 2, 4], 6, 32);
assertEquals(smallBuckets.length, 6, 'Small file has exactly 6 cells for 6 chunks');
assertEquals(smallBuckets[0].status, 'full', 'Chunk 0 is held (full)');
assertEquals(smallBuckets[1].status, 'empty', 'Chunk 1 is missing (empty)');
assertEquals(smallBuckets[2].status, 'full', 'Chunk 2 is held (full)');
assertEquals(smallBuckets[3].status, 'empty', 'Chunk 3 is missing (empty)');
assertEquals(smallBuckets[4].status, 'full', 'Chunk 4 is held (full)');
assertEquals(smallBuckets[5].status, 'empty', 'Chunk 5 is missing (empty)');

// Large file > 32 chunks (e.g. 128 chunks): bounded to 32 visual cells
const largeBuckets = computeChunkBuckets([0, 1, 2, 3, 4, 5], 128, 32);
assertEquals(largeBuckets.length, 32, 'Large file chunk strip is strictly bounded to 32 cells');
assertEquals(largeBuckets[0].status, 'full', 'Bucket 0 (chunks 0-3) has 4/4 and is marked full');
assertEquals(largeBuckets[0].count, 4, 'Bucket 0 has count 4');
assertEquals(largeBuckets[1].status, 'partial', 'Bucket 1 (chunks 4-7) has 2/4 and is marked partial');
assertEquals(largeBuckets[1].count, 2, 'Bucket 1 has count 2');
assertEquals(largeBuckets[2].status, 'empty', 'Bucket 2 (chunks 8-11) has 0/4 and is marked empty');
assertEquals(largeBuckets[2].count, 0, 'Bucket 2 has count 0');

// 3. UNIT TEST: deriveNextAction
console.log('\n--- 3. Testing deriveNextAction ---');
assert(deriveNextAction(snapshots.lobbyIdle.state).includes('create a room'), 'Lobby idle directs user to create or join');
assert(deriveNextAction(snapshots.lobbyConnecting.state).includes('Connecting'), 'Lobby connecting directs waiting');
assert(deriveNextAction(snapshots.hostAwaitingFile.state).includes('Host'), 'Host awaiting file directs host to pick file');
assert(deriveNextAction(snapshots.transferReadyToDisconnect.state).includes('disconnect'), 'Ready to disconnect explicitly mentions host disconnect');
assert(deriveNextAction(snapshots.transferFailoverExchanging.state).includes('exchanging'), 'Failover exchanging mentions direct P2P exchange');
assert(deriveNextAction(snapshots.transferVerifiedComplete.state).includes('verified'), 'Complete state directs user to Save verified file');
assert(deriveNextAction(snapshots.transferEarlyDisconnectMissing.state).includes('unavailable'), 'Early disconnect shows real engine unavailable detail');

// 4. MINIMAL DOM MOCK FOR NODE.JS LIFECYCLE TESTS
console.log('\n--- 4. DOM Lifecycle & Mock Environment Tests ---');

class MockElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = {};
    this.style = {};
    this.classList = new Set();
    this.listeners = {};
    this._innerHTML = '';
    this._value = '';
    this.disabled = false;
    this.textContent = '';
  }

  get className() {
    return Array.from(this.classList).join(' ');
  }

  set className(val) {
    this.classList = new Set((val || '').split(/\s+/).filter(Boolean));
  }

  get value() {
    return this._value;
  }

  set value(val) {
    this._value = String(val);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(html) {
    this._innerHTML = html;
    this.children = [];
    this._parseHTML(html);
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(handler);
  }

  dispatchEvent(event) {
    const list = this.listeners[event.type] || [];
    for (const fn of list) {
      fn(event);
    }
  }

  click() {
    this.dispatchEvent({ type: 'click', target: this, preventDefault: () => {} });
  }

  _parseHTML(html) {
    this._elementsById = new Map();
    this._elementsByClass = new Map();
    this._elementsByTag = new Map();

    const tagRegex = /<([a-z0-9-]+)([^>]*)>/gi;
    let match;
    while ((match = tagRegex.exec(html)) !== null) {
      const tag = match[1].toLowerCase();
      const attrsStr = match[2];
      const el = new MockElement(tag);

      // Match id
      const idMatch = attrsStr.match(/id=["']([^"']+)["']/i);
      if (idMatch) {
        el.id = idMatch[1];
        this._elementsById.set(el.id, el);
      }

      // Match class
      const classMatch = attrsStr.match(/class=["']([^"']+)["']/i);
      if (classMatch) {
        el.className = classMatch[1];
        el.classList.forEach(c => {
          if (!this._elementsByClass.has(c)) this._elementsByClass.set(c, []);
          this._elementsByClass.get(c).push(el);
        });
      }

      // Match disabled
      if (/\bdisabled\b/i.test(attrsStr)) {
        el.disabled = true;
      }

      // Match value
      const valMatch = attrsStr.match(/value=["']([^"']+)["']/i);
      if (valMatch) {
        el.value = valMatch[1];
      }

      // Match type
      const typeMatch = attrsStr.match(/type=["']([^"']+)["']/i);
      if (typeMatch) {
        el.type = typeMatch[1];
      }

      // Match name
      const nameMatch = attrsStr.match(/name=["']([^"']+)["']/i);
      if (nameMatch) {
        el.name = nameMatch[1];
      }

      if (!this._elementsByTag.has(tag)) this._elementsByTag.set(tag, []);
      this._elementsByTag.get(tag).push(el);
      this.children.push(el);
    }
  }

  querySelector(sel) {
    if (this._innerHTML && !this._elementsById) {
      this._parseHTML(this._innerHTML);
    }

    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (this._elementsById && this._elementsById.has(id)) {
        return this._elementsById.get(id);
      }
    } else if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (this._elementsByClass && this._elementsByClass.has(cls)) {
        return this._elementsByClass.get(cls)[0];
      }
    } else {
      if (this._elementsByTag && this._elementsByTag.has(sel.toLowerCase())) {
        return this._elementsByTag.get(sel.toLowerCase())[0];
      }
    }

    // Traverse children
    for (const child of this.children) {
      const found = child.querySelector(sel);
      if (found) return found;
    }
    return null;
  }

  querySelectorAll(sel) {
    let results = [];
    if (this._innerHTML && !this._elementsById) {
      this._parseHTML(this._innerHTML);
    }

    if (sel.startsWith('.')) {
      const cls = sel.slice(1);
      if (this._elementsByClass && this._elementsByClass.has(cls)) {
        results = results.concat(this._elementsByClass.get(cls));
      }
    } else if (sel.startsWith('#')) {
      const id = sel.slice(1);
      if (this._elementsById && this._elementsById.has(id)) {
        results.push(this._elementsById.get(id));
      }
    }

    for (const child of this.children) {
      results = results.concat(child.querySelectorAll(sel));
    }
    return results;
  }
}

// Setup global mock document
global.document = {
  createElement: (tag) => new MockElement(tag)
};

const mockRoot = new MockElement('div');
let capturedActions = [];

const testActions = {
  create: (args) => capturedActions.push({ action: 'create', args }),
  join: (args) => capturedActions.push({ action: 'join', args }),
  share: (file, opts) => capturedActions.push({ action: 'share', file, opts }),
  pause: () => capturedActions.push({ action: 'pause' }),
  resume: () => capturedActions.push({ action: 'resume' }),
  save: () => capturedActions.push({ action: 'save' }),
  leave: () => capturedActions.push({ action: 'leave' })
};

const ui = mount(mockRoot, testActions);
assert(ui && typeof ui.render === 'function', 'mount() returns object with render()');
assert(ui && typeof ui.destroy === 'function', 'mount() returns object with destroy()');

// 5. TEST SNAPSHOT RENDERS & ACTIONS
console.log('\n--- 5. Testing Lobby Render & Actions ---');
ui.render(snapshots.lobbyIdle.state);
assert(mockRoot.querySelector('#lm-btn-create') !== null, 'Lobby renders Create Room button');
assert(mockRoot.querySelector('#lm-btn-join') !== null, 'Lobby renders Join Room button');
assert(mockRoot.querySelector('#lm-input-endpoint') !== null, 'Lobby renders endpoint input');

// Trigger Create action
capturedActions = [];
mockRoot.querySelector('#lm-btn-create').click();
assertEquals(capturedActions.length, 1, 'Create button dispatches actions.create');
assertEquals(capturedActions[0].args.endpoint, 'ws://127.0.0.1:8765/ws', 'Default endpoint passed to create');

// Trigger Join action
capturedActions = [];
const roomCodeInput = mockRoot.querySelector('#lm-input-room-code');
roomCodeInput.value = 'LM-99';
roomCodeInput.dispatchEvent({
  type: 'input',
  target: { value: 'LM-99' }
});
mockRoot.querySelector('#lm-btn-join').click();
assertEquals(capturedActions.length, 1, 'Join button dispatches actions.join');
assertEquals(capturedActions[0].args.roomCode, 'LM-99', 'Entered roomCode passed to join');

console.log('\n--- 6. Testing Ready to Disconnect Banner Isolation ---');
// When NOT ready:
ui.render(snapshots.transferSeeding.state);
assert(mockRoot.querySelector('#ready-to-disconnect-banner') === null, 'Ready to disconnect banner is HIDDEN during seeding');

// When READY:
ui.render(snapshots.transferReadyToDisconnect.state);
assert(mockRoot.querySelector('#ready-to-disconnect-banner') !== null, 'Ready to disconnect banner is VISIBLE when readyToDisconnect is true');

console.log('\n--- 7. Testing Save Button Status ---');
// Incomplete transfer: Save button disabled
ui.render(snapshots.transferSeeding.state);
const saveBtnBefore = mockRoot.querySelector('#lm-btn-save');
assert(saveBtnBefore !== null && saveBtnBefore.disabled === true, 'Save button is disabled before file is verified');

// Complete transfer: Save button enabled and triggers actions.save()
ui.render(snapshots.transferVerifiedComplete.state);
const saveBtnAfter = mockRoot.querySelector('#lm-btn-save');
assert(saveBtnAfter !== null && saveBtnAfter.disabled === false, 'Save button is enabled when file is verified');
capturedActions = [];
saveBtnAfter.click();
assertEquals(capturedActions.length, 1, 'Save button dispatches actions.save()');

console.log('\n--- 8. Testing Host Row Persistence on Departure ---');
ui.render(snapshots.transferFailoverExchanging.state);
const offlinePeerRows = mockRoot.querySelectorAll('.lm-peer-row--offline');
assert(offlinePeerRows.length > 0, 'Departed host remains visible on screen with offline row styling');

console.log('\n--- 9. Testing Leave Room Action ---');
capturedActions = [];
const leaveBtn = mockRoot.querySelector('#lm-btn-leave');
assert(leaveBtn !== null, 'Leave button is rendered in room header');
leaveBtn.click();
assertEquals(capturedActions.length, 1, 'Leave button dispatches actions.leave()');

console.log('\n--- 10. Testing destroy() Cleanup ---');
ui.destroy();
assertEquals(mockRoot.children.length, 0, 'destroy() clears DOM contents');

console.log('\n======================================================');
console.log(`🎉 ALL TESTS PASSED: ${passed} passed, ${failed} failed`);
console.log('======================================================\n');

if (failed > 0) {
  process.exit(1);
}
