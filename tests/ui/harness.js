/**
 * LabMesh Dev-Only UI Test Harness Script
 * Connects snapshots, live state mutation, viewport modes, and action event inspection.
 */

import { mount } from '../../extension/ui.js';
import { snapshots } from './snapshots.js';

let currentSnapshotKey = 'lobbyIdle';
let activeState = JSON.parse(JSON.stringify(snapshots.lobbyIdle.state));
let uiInstance = null;
const actionLogs = [];

const appRoot = document.getElementById('app-root');
const snapshotSelect = document.getElementById('snapshot-select');
const snapshotDesc = document.getElementById('snapshot-desc');
const actionLogsTable = document.getElementById('action-logs-body');
const viewportContainer = document.getElementById('viewport-container');

// Setup Action Mock Callbacks
function recordAction(actionName, payload = {}) {
  const timestamp = new Date().toLocaleTimeString();
  const entry = {
    time: timestamp,
    action: actionName,
    payload: JSON.stringify(payload)
  };
  actionLogs.unshift(entry);
  if (actionLogs.length > 50) actionLogs.pop();
  renderLogs();
}

const mockActions = {
  create: (args) => {
    recordAction('create', args);
    // Simulate transitioning into room as host
    activeState = {
      session: 'inRoom',
      selfId: 'peer-host-user',
      hostId: 'peer-host-user',
      roomCode: 'LM-HOST',
      error: null,
      transfer: {
        phase: 'empty',
        mode: 'demo',
        fileName: '',
        fileSize: 0,
        chunkCount: 0,
        peers: [
          { id: 'peer-host-user', name: args.name || 'Instructor', online: true, have: [] }
        ],
        localVerifiedBytes: 0,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Room created. Awaiting peer connections and file selection.'
      }
    };
    uiInstance.render(activeState);
  },
  join: (args) => {
    recordAction('join', args);
    // Simulate transitioning into room as receiver
    activeState = {
      session: 'inRoom',
      selfId: 'peer-receiver-user',
      hostId: 'peer-instructor-01',
      roomCode: args.roomCode,
      error: null,
      transfer: {
        phase: 'empty',
        mode: 'demo',
        fileName: '',
        fileSize: 0,
        chunkCount: 0,
        peers: [
          { id: 'peer-instructor-01', name: 'Alice (Instructor)', online: true, have: [] },
          { id: 'peer-receiver-user', name: args.name || 'Receiver', online: true, have: [] }
        ],
        localVerifiedBytes: 0,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Joined room. Waiting for host to share file.'
      }
    };
    uiInstance.render(activeState);
  },
  share: (file, options) => {
    recordAction('share', { fileName: file?.name, fileSize: file?.size, mode: options?.mode });
    if (activeState.transfer) {
      activeState.transfer.fileName = file.name;
      activeState.transfer.fileSize = file.size;
      activeState.transfer.chunkCount = Math.max(2, Math.ceil(file.size / (64 * 1024)));
      activeState.transfer.mode = options.mode;
      activeState.transfer.phase = 'seeding';
      activeState.transfer.detail = `Seeding ${file.name} to connected peers in ${options.mode} mode.`;
      // Host has 100% of chunks
      const hostPeer = activeState.transfer.peers.find(p => p.id === activeState.hostId);
      if (hostPeer) {
        hostPeer.have = Array.from({ length: activeState.transfer.chunkCount }, (_, i) => i);
      }
      uiInstance.render(activeState);
    }
  },
  pause: () => {
    recordAction('pause', {});
    if (activeState.transfer) {
      activeState.transfer.paused = true;
      activeState.transfer.detail = 'Transfer paused by local user.';
      uiInstance.render(activeState);
    }
  },
  resume: () => {
    recordAction('resume', {});
    if (activeState.transfer) {
      activeState.transfer.paused = false;
      activeState.transfer.detail = 'Transfer resumed.';
      uiInstance.render(activeState);
    }
  },
  save: () => {
    recordAction('save', { verified: activeState.transfer?.verified });
    alert('Simulated Save: File blob passed to chrome.downloads / disk.');
  },
  leave: () => {
    recordAction('leave', {});
    activeState = JSON.parse(JSON.stringify(snapshots.lobbyIdle.state));
    uiInstance.render(activeState);
  }
};

function renderLogs() {
  if (!actionLogsTable) return;
  actionLogsTable.innerHTML = actionLogs.map(log => `
    <tr>
      <td class="log-time">${log.time}</td>
      <td class="log-action"><code>${log.action}()</code></td>
      <td class="log-payload"><code>${log.payload}</code></td>
    </tr>
  `).join('');
}

// Populate Snapshot Dropdown
Object.keys(snapshots).forEach(key => {
  const opt = document.createElement('option');
  opt.value = key;
  opt.textContent = snapshots[key].name;
  snapshotSelect.appendChild(opt);
});

function loadSnapshot(key) {
  currentSnapshotKey = key;
  activeState = JSON.parse(JSON.stringify(snapshots[key].state));
  snapshotDesc.textContent = snapshots[key].description;
  if (uiInstance) {
    uiInstance.render(activeState);
  }
}

snapshotSelect.addEventListener('change', (e) => {
  loadSnapshot(e.target.value);
});

// Viewport width switchers
document.querySelectorAll('[data-viewport]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('[data-viewport]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const mode = btn.getAttribute('data-viewport');
    viewportContainer.className = `viewport-wrapper viewport--${mode}`;
  });
});

// Live State Toggles
document.getElementById('toggle-ready')?.addEventListener('click', () => {
  if (activeState.transfer) {
    activeState.transfer.readyToDisconnect = !activeState.transfer.readyToDisconnect;
    uiInstance.render(activeState);
  }
});

document.getElementById('toggle-host-online')?.addEventListener('click', () => {
  if (activeState.transfer && activeState.hostId) {
    const hostPeer = activeState.transfer.peers.find(p => p.id === activeState.hostId);
    if (hostPeer) {
      hostPeer.online = !hostPeer.online;
      uiInstance.render(activeState);
    }
  }
});

document.getElementById('toggle-verified')?.addEventListener('click', () => {
  if (activeState.transfer) {
    activeState.transfer.verified = !activeState.transfer.verified;
    activeState.transfer.phase = activeState.transfer.verified ? 'complete' : 'exchanging';
    if (activeState.transfer.verified) {
      activeState.transfer.localVerifiedBytes = activeState.transfer.fileSize;
    }
    uiInstance.render(activeState);
  }
});

document.getElementById('toggle-pause')?.addEventListener('click', () => {
  if (activeState.transfer) {
    activeState.transfer.paused = !activeState.transfer.paused;
    uiInstance.render(activeState);
  }
});

document.getElementById('clear-logs')?.addEventListener('click', () => {
  actionLogs.length = 0;
  renderLogs();
});

// Mount the UI
uiInstance = mount(appRoot, mockActions);
loadSnapshot('lobbyIdle');
