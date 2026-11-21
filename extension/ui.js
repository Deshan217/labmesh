/**
 * LabMesh Extension Room UI
 * Native ES Module implementing mount(root, actions) -> { render(state), destroy() }
 * Designed for classroom projector visibility and accessible P2P live demonstration.
 */

/**
 * Format bytes into human readable format (e.g., 1.45 MiB, 512 KiB)
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (typeof bytes !== 'number' || isNaN(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

/**
 * Group chunk indices into visual bucket cells.
 * For totalChunks <= maxBuckets: 1 cell = 1 chunk.
 * For totalChunks > maxBuckets: contiguous indices grouped into maxBuckets cells.
 * @param {number[]} haveArray - Array of zero-based chunk indexes held by peer
 * @param {number} totalChunks - Total number of chunks in file
 * @param {number} [maxBuckets=32] - Max visual cells to display
 * @returns {Array<{index: number, range: string, count: number, total: number, status: 'empty'|'partial'|'full'}>}
 */
export function computeChunkBuckets(haveArray, totalChunks, maxBuckets = 32) {
  if (!totalChunks || totalChunks <= 0) return [];
  const haveSet = new Set(Array.isArray(haveArray) ? haveArray : []);

  if (totalChunks <= maxBuckets) {
    const cells = [];
    for (let i = 0; i < totalChunks; i++) {
      const held = haveSet.has(i);
      cells.push({
        index: i,
        range: `Chunk ${i}`,
        count: held ? 1 : 0,
        total: 1,
        status: held ? 'full' : 'empty'
      });
    }
    return cells;
  }

  const bucketCount = maxBuckets;
  const buckets = [];
  for (let b = 0; b < bucketCount; b++) {
    const start = Math.floor((b * totalChunks) / bucketCount);
    const end = Math.floor(((b + 1) * totalChunks) / bucketCount) - 1;
    const bucketTotal = end - start + 1;
    let count = 0;
    for (let c = start; c <= end; c++) {
      if (haveSet.has(c)) count++;
    }

    let status = 'empty';
    if (count === bucketTotal && bucketTotal > 0) {
      status = 'full';
    } else if (count > 0) {
      status = 'partial';
    }

    buckets.push({
      index: b,
      range: start === end ? `Chunk ${start}` : `Chunks ${start}–${end}`,
      count,
      total: bucketTotal,
      status
    });
  }
  return buckets;
}

/**
 * Derive the precise human-readable next action from snapshot state.
 * @param {object} state
 * @returns {string}
 */
export function deriveNextAction(state) {
  if (!state) return 'Initializing...';
  if (state.session === 'idle') {
    return 'Enter your name and create a room (as host) or join an existing room with code.';
  }
  if (state.session === 'connecting') {
    return 'Connecting to signaling server. Please wait...';
  }

  const transfer = state.transfer;
  if (!transfer || transfer.phase === 'empty') {
    if (state.selfId === state.hostId) {
      return 'You are Host. Select a starter kit file and choose transfer mode to begin seeding.';
    }
    return 'Waiting for host to share a file. Keep this room tab open.';
  }

  if (transfer.phase === 'error') {
    return transfer.detail || 'Transfer encountered an error. Check network and peers.';
  }

  if (transfer.verified || transfer.phase === 'complete') {
    return 'File received and verified with SHA-256! Click "Save verified file" to store locally.';
  }

  if (transfer.readyToDisconnect) {
    return '⚡ Staged failover milestone reached! Host A can safely disconnect. Peers B & C will complete the file independently.';
  }

  const isHost = state.selfId === state.hostId;
  const hostPeer = (transfer.peers || []).find(p => p.id === state.hostId);
  const hostOffline = hostPeer && !hostPeer.online;

  if (hostOffline) {
    if (transfer.detail && transfer.detail.toLowerCase().includes('unavailable')) {
      return transfer.detail;
    }
    return 'Host is offline. Peers B & C are exchanging missing chunks directly over WebRTC data channels.';
  }

  if (transfer.mode === 'demo') {
    return 'Seeding complementary chunk sets (even chunks to one peer, odd chunks to the other) and verifying direct B↔C link...';
  }

  if (transfer.paused) {
    return 'Transfer is paused locally. Click "Resume" to continue receiving chunks.';
  }

  return 'Exchanging verified chunks with active peers over reliable WebRTC data channels.';
}

/**
 * Mount the LabMesh UI into root element.
 * @param {HTMLElement} root - Container DOM node
 * @param {object} actions - Application callbacks { create, join, share, pause, resume, save, leave }
 * @returns {{ render: (state: object) => void, destroy: () => void }}
 */
export function mount(root, actions = {}) {
  if (!root) throw new Error('mount requires a valid DOM root node');

  // Local UI-only state to prevent wiping inputs while user types
  let localLobbyForm = {
    name: 'Participant',
    endpoint: 'ws://127.0.0.1:8765/ws',
    roomCode: ''
  };
  let localFile = null;
  let localShareMode = 'demo'; // default to staged demo mode for hackathon judges
  let copyFeedbackTimeout = null;
  let lastState = null;

  // Track persistent peers so departing host remains visible on screen
  const persistentPeersMap = new Map();

  // Root container setup
  root.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'labmesh-app';
  root.appendChild(container);

  /**
   * Safe HTML escape
   */
  function esc(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Render lobby view
   */
  function renderLobby(state) {
    const isConnecting = state.session === 'connecting';
    const hasError = !!state.error;

    return `
      <div class="lm-lobby" role="region" aria-label="Lobby and Room Setup">
        <header class="lm-header">
          <div class="lm-logo-group">
            <span class="lm-badge lm-badge--primary">P2P Classroom Mesh</span>
            <h1 class="lm-title">LabMesh</h1>
            <p class="lm-subtitle">Decentralized workshop file distribution for bandwidth-constrained classrooms.</p>
          </div>
        </header>

        ${hasError ? `
          <div class="lm-alert lm-alert--error" role="alert" aria-live="assertive">
            <div class="lm-alert-icon" aria-hidden="true">⚠️</div>
            <div class="lm-alert-content">
              <strong>Connection Failure:</strong> ${esc(state.error)}
              <div class="lm-alert-hint">Your settings were kept. Check the signaling server or code and try again.</div>
            </div>
          </div>
        ` : ''}

        <div class="lm-card lm-lobby-card">
          <h2 class="lm-card-title">Setup Participant</h2>
          
          <div class="lm-form-group">
            <label for="lm-input-name" class="lm-label">Display Name</label>
            <input 
              type="text" 
              id="lm-input-name" 
              class="lm-input" 
              placeholder="e.g. Instructor A, Student B" 
              value="${esc(localLobbyForm.name)}"
              ${isConnecting ? 'disabled' : ''}
              required
            />
          </div>

          <div class="lm-form-group">
            <label for="lm-input-endpoint" class="lm-label">Signaling Service WebSocket</label>
            <input 
              type="text" 
              id="lm-input-endpoint" 
              class="lm-input lm-input--code" 
              placeholder="ws://127.0.0.1:8765/ws" 
              value="${esc(localLobbyForm.endpoint)}"
              ${isConnecting ? 'disabled' : ''}
              required
            />
            <span class="lm-form-hint">FastAPI relay runs on a team device on LAN/hotspot.</span>
          </div>

          ${isConnecting ? `
            <div class="lm-connecting-banner" role="status" aria-live="polite">
              <span class="lm-spinner" aria-hidden="true"></span>
              <span>Connecting to signaling relay at <code>${esc(localLobbyForm.endpoint)}</code>...</span>
            </div>
          ` : ''}

          <div class="lm-lobby-actions">
            <div class="lm-action-box">
              <h3>Create Room</h3>
              <p>Become the room host to select and seed the starter kit file.</p>
              <button 
                type="button" 
                id="lm-btn-create" 
                class="lm-btn lm-btn--primary lm-btn--large"
                ${isConnecting ? 'disabled' : ''}
              >
                Create New Room
              </button>
            </div>

            <div class="lm-divider" aria-hidden="true"><span>OR</span></div>

            <div class="lm-action-box">
              <h3>Join Existing Room</h3>
              <p>Enter the 4-6 character room code displayed on the host screen.</p>
              <div class="lm-join-row">
                <input 
                  type="text" 
                  id="lm-input-room-code" 
                  class="lm-input lm-input--code" 
                  placeholder="ROOM CODE" 
                  maxlength="16"
                  value="${esc(localLobbyForm.roomCode)}"
                  ${isConnecting ? 'disabled' : ''}
                />
                <button 
                  type="button" 
                  id="lm-btn-join" 
                  class="lm-btn lm-btn--secondary lm-btn--large"
                  ${isConnecting ? 'disabled' : ''}
                >
                  Join Room
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer class="lm-lobby-footer">
          <span>✓ Manifest V3 Clean Architecture</span>
          <span>✓ Pure WebRTC DataChannels</span>
          <span>✓ Verified SHA-256 Chunks</span>
        </footer>
      </div>
    `;
  }

  /**
   * Render in-room view
   */
  function renderRoom(state) {
    const isHost = state.selfId === state.hostId;
    const transfer = state.transfer || {
      phase: 'empty',
      mode: 'demo',
      fileName: '',
      fileSize: 0,
      chunkCount: 0,
      peers: [],
      localVerifiedBytes: 0,
      verified: false,
      readyToDisconnect: false,
      paused: false,
      detail: ''
    };

    // Update persistent peer cache so departing host remains visible on screen
    if (Array.isArray(transfer.peers)) {
      transfer.peers.forEach(p => {
        persistentPeersMap.set(p.id, { ...p });
      });
    }

    // Convert persistent peers map to list, prioritizing self first, then host, then others
    const peersList = Array.from(persistentPeersMap.values()).sort((a, b) => {
      if (a.id === state.selfId) return -1;
      if (b.id === state.selfId) return 1;
      if (a.id === state.hostId) return -1;
      if (b.id === state.hostId) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    const totalChunks = transfer.chunkCount || 0;
    const fileSize = transfer.fileSize || 0;
    const verifiedBytes = transfer.localVerifiedBytes || 0;
    const progressPercent = fileSize > 0 ? Math.min(100, Math.round((verifiedBytes / fileSize) * 100)) : 0;
    const nextActionText = deriveNextAction(state);

    // Find self peer to calculate missing chunks
    const selfPeer = persistentPeersMap.get(state.selfId) || { have: [] };
    const selfHaveSet = new Set(selfPeer.have || []);

    return `
      <div class="lm-room" role="region" aria-label="LabMesh Room View">
        <!-- Top App Bar -->
        <header class="lm-room-header">
          <div class="lm-room-header-left">
            <span class="lm-badge lm-badge--primary">LabMesh</span>
            <div class="lm-room-code-badge" title="Click to copy room code" id="lm-room-code-trigger" role="button" tabindex="0" aria-label="Room code ${esc(state.roomCode)}. Click to copy.">
              <span class="lm-room-code-label">ROOM CODE:</span>
              <span class="lm-room-code-value" id="lm-room-code-text">${esc(state.roomCode || '---')}</span>
              <span class="lm-copy-icon" aria-hidden="true">📋</span>
              <span class="lm-copy-feedback" id="lm-copy-feedback" aria-live="polite"></span>
            </div>
          </div>

          <div class="lm-room-header-right">
            <div class="lm-self-tag">
              <span class="lm-status-dot lm-status-dot--online" aria-hidden="true"></span>
              <span class="lm-self-name">${esc(selfPeer.name || 'You')}</span>
              <span class="lm-badge ${isHost ? 'lm-badge--host' : 'lm-badge--receiver'}">
                ${isHost ? 'Host / Instructor' : 'Receiver / Peer'}
              </span>
            </div>
            <button type="button" id="lm-btn-leave" class="lm-btn lm-btn--danger lm-btn--sm" title="Leave room and close WebRTC channels">
              Leave Room
            </button>
          </div>
        </header>

        ${state.error ? `
          <div class="lm-alert lm-alert--error" role="alert">
            <div class="lm-alert-icon" aria-hidden="true">⚠️</div>
            <div class="lm-alert-content">
              <strong>Error:</strong> ${esc(state.error)}
            </div>
          </div>
        ` : ''}

        <!-- Failover Ready Banner (Only shown when readyToDisconnect is true) -->
        ${transfer.readyToDisconnect ? `
          <div class="lm-disconnect-banner" role="alert" aria-live="polite" id="ready-to-disconnect-banner">
            <div class="lm-disconnect-icon" aria-hidden="true">⚡</div>
            <div class="lm-disconnect-text">
              <h2 class="lm-disconnect-title">READY TO DISCONNECT THE SOURCE</h2>
              <p class="lm-disconnect-desc">
                Host A can now safely close this tab or disconnect Wi-Fi! Receivers B and C jointly hold all verified chunks, and their mutual direct channel is confirmed open. The class will complete the transfer peer-to-peer.
              </p>
            </div>
          </div>
        ` : ''}

        <!-- Next Action / Guidance Bar -->
        <div class="lm-next-action-bar" role="status" aria-live="polite">
          <span class="lm-next-action-label">NEXT STEP:</span>
          <span class="lm-next-action-content">${esc(nextActionText)}</span>
        </div>

        <div class="lm-room-main-layout">
          <!-- Left Column: File & Transfer Metrics -->
          <section class="lm-panel lm-transfer-panel" aria-label="Transfer Overview">
            <h2 class="lm-panel-title">Transfer Overview</h2>

            <!-- Host File Sharing Controls (Visible only in room; only Host selects file/mode) -->
            ${isHost ? `
              <div class="lm-card lm-sharing-card">
                <h3 class="lm-card-subheading">Instructor Starter Kit Selection</h3>
                <div class="lm-form-group">
                  <label for="lm-file-input" class="lm-label">Select Starter Kit File (1 B to 8 MiB)</label>
                  <input 
                    type="file" 
                    id="lm-file-input" 
                    class="lm-file-input" 
                    aria-describedby="lm-file-hint"
                  />
                  <span id="lm-file-hint" class="lm-form-hint">
                    Choose a small workshop file the team has the right to share (e.g. starter archive or PDF).
                  </span>
                </div>

                <div class="lm-form-group">
                  <label class="lm-label">Distribution Mode</label>
                  <div class="lm-mode-selector" role="radiogroup" aria-label="Distribution Mode">
                    <label class="lm-radio-card ${localShareMode === 'demo' ? 'lm-radio-card--selected' : ''}">
                      <input 
                        type="radio" 
                        name="lm-share-mode" 
                        value="demo" 
                        ${localShareMode === 'demo' ? 'checked' : ''}
                      />
                      <div class="lm-radio-body">
                        <strong>Staged Failover (Demo Mode)</strong>
                        <p>Assigns even chunks to receiver B and odd chunks to receiver C. Tests offline classroom continuity.</p>
                      </div>
                    </label>

                    <label class="lm-radio-card ${localShareMode === 'normal' ? 'lm-radio-card--selected' : ''}">
                      <input 
                        type="radio" 
                        name="lm-share-mode" 
                        value="normal" 
                        ${localShareMode === 'normal' ? 'checked' : ''}
                      />
                      <div class="lm-radio-body">
                        <strong>Normal Swarm Mode</strong>
                        <p>Standard P2P chunk exchange without artificial hold.</p>
                      </div>
                    </label>
                  </div>
                </div>

                <button 
                  type="button" 
                  id="lm-btn-share" 
                  class="lm-btn lm-btn--primary lm-btn--full"
                  ${!localFile ? 'disabled' : ''}
                >
                  ${localFile ? `Share "${esc(localFile.name)}" (${formatBytes(localFile.size)})` : 'Choose a file to Share'}
                </button>
              </div>
            ` : ''}

            <!-- Active File & Status Card -->
            <div class="lm-card lm-status-card">
              <div class="lm-file-meta-row">
                <div class="lm-file-icon" aria-hidden="true">📦</div>
                <div class="lm-file-info">
                  <span class="lm-file-name" title="${esc(transfer.fileName || 'No file selected yet')}">
                    ${esc(transfer.fileName || 'Awaiting starter kit file...')}
                  </span>
                  <span class="lm-file-stats">
                    ${fileSize > 0 ? `${formatBytes(fileSize)} • ${totalChunks} chunks • ${transfer.mode === 'demo' ? 'Staged Demo' : 'Normal Swarm'}` : '0 B • 0 chunks'}
                  </span>
                </div>
                <div class="lm-phase-badge lm-phase-badge--${esc(transfer.phase)}" aria-label="Transfer phase: ${esc(transfer.phase)}">
                  ${esc(transfer.phase.toUpperCase())}
                </div>
              </div>

              <!-- Progress bar & Verified Status -->
              <div class="lm-progress-section">
                <div class="lm-progress-labels">
                  <span>Local Verified: <strong>${formatBytes(verifiedBytes)}</strong> / ${formatBytes(fileSize)}</span>
                  <span class="lm-progress-percent">${progressPercent}%</span>
                </div>
                <div class="lm-progress-bar" role="progressbar" aria-valuenow="${progressPercent}" aria-valuemin="0" aria-valuemax="100">
                  <div class="lm-progress-fill" style="width: ${progressPercent}%;"></div>
                </div>
              </div>

              ${transfer.verified || transfer.phase === 'complete' ? `
                <div class="lm-verified-badge" role="status" aria-live="polite">
                  <span class="lm-check-icon" aria-hidden="true">✓</span>
                  <span><strong>Whole-file SHA-256 Verified!</strong> Payload intact.</span>
                </div>
              ` : ''}

              ${transfer.detail ? `
                <div class="lm-detail-callout" role="note">
                  <span class="lm-detail-label">Status Detail:</span>
                  <span class="lm-detail-text">${esc(transfer.detail)}</span>
                </div>
              ` : ''}

              <!-- Receiver Transfer Controls -->
              <div class="lm-transfer-controls">
                <button 
                  type="button" 
                  id="lm-btn-save" 
                  class="lm-btn lm-btn--success lm-btn--large"
                  ${!(transfer.verified || transfer.phase === 'complete') ? 'disabled' : ''}
                  title="${(transfer.verified || transfer.phase === 'complete') ? 'Save verified file to disk' : 'Available when whole-file SHA-256 is verified'}"
                >
                  💾 Save Verified File
                </button>

                ${!isHost && transfer.phase !== 'empty' && !transfer.verified ? `
                  <button 
                    type="button" 
                    id="lm-btn-pause-toggle" 
                    class="lm-btn ${transfer.paused ? 'lm-btn--primary' : 'lm-btn--outline'}"
                  >
                    ${transfer.paused ? '▶ Resume Transfer' : '⏸ Pause Transfer'}
                  </button>
                ` : ''}
              </div>
            </div>
          </section>

          <!-- Right Column: Focus on Three Peer Rows -->
          <section class="lm-panel lm-peers-panel" aria-label="Peer Mesh Inventory">
            <div class="lm-panel-header-row">
              <h2 class="lm-panel-title">Classroom Mesh Peers (${peersList.length} of 3)</h2>
              <div class="lm-legend" aria-label="Chunk Strip Legend">
                <span class="lm-legend-item"><span class="lm-cell-sample lm-cell-sample--full"></span> Held / Verified</span>
                <span class="lm-legend-item"><span class="lm-cell-sample lm-cell-sample--partial"></span> Partial Bucket</span>
                <span class="lm-legend-item"><span class="lm-cell-sample lm-cell-sample--empty"></span> Missing</span>
              </div>
            </div>

            <div class="lm-peer-list" role="list">
              ${peersList.length === 0 ? `
                <div class="lm-empty-peers">Waiting for peers to join room <code>${esc(state.roomCode)}</code>...</div>
              ` : peersList.map(peer => {
                const isPeerHost = peer.id === state.hostId;
                const isPeerSelf = peer.id === state.selfId;
                const haveCount = (peer.have || []).length;
                const peerPercent = totalChunks > 0 ? Math.min(100, Math.round((haveCount / totalChunks) * 100)) : 0;
                const buckets = computeChunkBuckets(peer.have || [], totalChunks, 32);

                // Analyze complementary chunks between self and peer
                let compNote = '';
                if (!isPeerSelf && totalChunks > 0) {
                  const peerHaveSet = new Set(peer.have || []);
                  let theyHaveThatINeed = 0;
                  peerHaveSet.forEach(idx => {
                    if (!selfHaveSet.has(idx)) theyHaveThatINeed++;
                  });
                  if (theyHaveThatINeed > 0) {
                    compNote = `Holds ${theyHaveThatINeed} missing chunk${theyHaveThatINeed > 1 ? 's' : ''} you need`;
                  } else if (haveCount === totalChunks) {
                    compNote = 'Complete set available';
                  } else {
                    compNote = 'Synchronized with your inventory';
                  }
                }

                return `
                  <article class="lm-peer-row ${!peer.online ? 'lm-peer-row--offline' : ''} ${isPeerSelf ? 'lm-peer-row--self' : ''}" role="listitem" aria-label="Peer ${esc(peer.name)}">
                    <div class="lm-peer-header">
                      <div class="lm-peer-info">
                        <span class="lm-peer-name">${esc(peer.name || 'Anonymous')}</span>
                        <span class="lm-peer-id" title="Peer ID: ${esc(peer.id)}">#${esc((peer.id || '').substring(0, 6))}</span>
                        ${isPeerHost ? '<span class="lm-badge lm-badge--host">HOST</span>' : ''}
                        ${isPeerSelf ? '<span class="lm-badge lm-badge--you">YOU</span>' : ''}
                      </div>

                      <div class="lm-peer-status-group">
                        <span class="lm-status-pill ${peer.online ? 'lm-status-pill--online' : 'lm-status-pill--offline'}" aria-label="${peer.online ? 'Peer is Online' : 'Peer is Disconnected/Offline'}">
                          <span class="lm-status-dot ${peer.online ? 'lm-status-dot--online' : 'lm-status-dot--offline'}" aria-hidden="true"></span>
                          ${peer.online ? 'ONLINE' : 'OFFLINE'}
                        </span>
                        <span class="lm-peer-chunk-counter" aria-label="${haveCount} of ${totalChunks} chunks received">
                          <strong>${haveCount}</strong>/${totalChunks} chunks (${peerPercent}%)
                        </span>
                      </div>
                    </div>

                    ${compNote ? `
                      <div class="lm-peer-comp-note">
                        <span class="lm-comp-icon" aria-hidden="true">⇄</span>
                        <span>${esc(compNote)}</span>
                      </div>
                    ` : ''}

                    <!-- Visual Chunk Strip -->
                    <div class="lm-chunk-strip-container">
                      <div class="lm-chunk-strip" role="group" aria-label="Chunks held by ${esc(peer.name)}">
                        ${buckets.length === 0 ? `
                          <div class="lm-chunk-strip-placeholder">No chunks to display until file is shared.</div>
                        ` : buckets.map(b => `
                          <div 
                            class="lm-chunk-cell lm-chunk-cell--${b.status}" 
                            tabindex="0"
                            role="img"
                            aria-label="${esc(b.range)}: ${b.count}/${b.total} held (${b.status})"
                            title="${esc(b.range)}: ${b.count}/${b.total} held (${b.status})"
                          ></div>
                        `).join('')}
                      </div>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          </section>
        </div>
      </div>
    `;
  }

  /**
   * Bind event handlers in Lobby view
   */
  function bindLobbyEvents(state) {
    const inputName = container.querySelector('#lm-input-name');
    if (inputName) {
      inputName.addEventListener('input', (e) => {
        localLobbyForm.name = e.target.value;
      });
    }

    const inputEndpoint = container.querySelector('#lm-input-endpoint');
    if (inputEndpoint) {
      inputEndpoint.addEventListener('input', (e) => {
        localLobbyForm.endpoint = e.target.value;
      });
    }

    const inputRoomCode = container.querySelector('#lm-input-room-code');
    if (inputRoomCode) {
      inputRoomCode.addEventListener('input', (e) => {
        localLobbyForm.roomCode = e.target.value.trim().toUpperCase();
        e.target.value = localLobbyForm.roomCode;
      });
      inputRoomCode.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const btnJoin = container.querySelector('#lm-btn-join');
          if (btnJoin && !btnJoin.disabled) btnJoin.click();
        }
      });
    }

    const btnCreate = container.querySelector('#lm-btn-create');
    if (btnCreate) {
      btnCreate.addEventListener('click', () => {
        const name = (localLobbyForm.name || 'Host').trim();
        const endpoint = (localLobbyForm.endpoint || 'ws://127.0.0.1:8765/ws').trim();
        if (typeof actions.create === 'function') {
          actions.create({ endpoint, name });
        }
      });
    }

    const btnJoin = container.querySelector('#lm-btn-join');
    if (btnJoin) {
      btnJoin.addEventListener('click', () => {
        const name = (localLobbyForm.name || 'Participant').trim();
        const endpoint = (localLobbyForm.endpoint || 'ws://127.0.0.1:8765/ws').trim();
        const roomCode = (localLobbyForm.roomCode || '').trim().toUpperCase();
        if (!roomCode) {
          if (inputRoomCode) inputRoomCode.focus();
          return;
        }
        if (typeof actions.join === 'function') {
          actions.join({ endpoint, roomCode, name });
        }
      });
    }
  }

  /**
   * Bind event handlers in Room view
   */
  function bindRoomEvents(state) {
    // Copy room code to clipboard
    const roomCodeTrigger = container.querySelector('#lm-room-code-trigger');
    const copyFeedback = container.querySelector('#lm-copy-feedback');
    if (roomCodeTrigger && state.roomCode) {
      const copyCode = () => {
        navigator.clipboard?.writeText(state.roomCode).catch(() => {});
        if (copyFeedback) {
          copyFeedback.textContent = 'COPIED!';
          clearTimeout(copyFeedbackTimeout);
          copyFeedbackTimeout = setTimeout(() => {
            if (copyFeedback) copyFeedback.textContent = '';
          }, 2000);
        }
      };
      roomCodeTrigger.addEventListener('click', copyCode);
      roomCodeTrigger.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          copyCode();
        }
      });
    }

    // Leave room
    const btnLeave = container.querySelector('#lm-btn-leave');
    if (btnLeave) {
      btnLeave.addEventListener('click', () => {
        if (typeof actions.leave === 'function') {
          actions.leave();
        }
      });
    }

    // Host file input
    const fileInput = container.querySelector('#lm-file-input');
    const btnShare = container.querySelector('#lm-btn-share');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        localFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
        if (btnShare) {
          if (localFile) {
            btnShare.disabled = false;
            btnShare.textContent = `Share "${localFile.name}" (${formatBytes(localFile.size)})`;
          } else {
            btnShare.disabled = true;
            btnShare.textContent = 'Choose a file to Share';
          }
        }
      });
    }

    // Mode selector radio buttons
    const modeRadios = container.querySelectorAll('input[name="lm-share-mode"]');
    modeRadios.forEach(radio => {
      radio.addEventListener('change', (e) => {
        localShareMode = e.target.value;
        const allCards = container.querySelectorAll('.lm-radio-card');
        allCards.forEach(c => c.classList.remove('lm-radio-card--selected'));
        const parentCard = e.target.closest('.lm-radio-card');
        if (parentCard) parentCard.classList.add('lm-radio-card--selected');
      });
    });

    // Share button
    if (btnShare) {
      btnShare.addEventListener('click', () => {
        if (localFile && typeof actions.share === 'function') {
          actions.share(localFile, { mode: localShareMode });
        }
      });
    }

    // Save verified file button
    const btnSave = container.querySelector('#lm-btn-save');
    if (btnSave) {
      btnSave.addEventListener('click', () => {
        if (typeof actions.save === 'function') {
          actions.save();
        }
      });
    }

    // Pause / Resume toggle
    const btnPauseToggle = container.querySelector('#lm-btn-pause-toggle');
    if (btnPauseToggle) {
      btnPauseToggle.addEventListener('click', () => {
        const isPaused = state.transfer && state.transfer.paused;
        if (isPaused) {
          if (typeof actions.resume === 'function') actions.resume();
        } else {
          if (typeof actions.pause === 'function') actions.pause();
        }
      });
    }
  }

  /**
   * Main render method receiving full state snapshots
   * @param {object} state
   */
  function render(state) {
    if (!state) return;
    lastState = state;

    // Preserve room code if given in state
    if (state.roomCode && state.session === 'inRoom') {
      localLobbyForm.roomCode = state.roomCode;
    }

    if (state.session === 'inRoom') {
      container.innerHTML = renderRoom(state);
      bindRoomEvents(state);
    } else {
      container.innerHTML = renderLobby(state);
      bindLobbyEvents(state);
    }
  }

  /**
   * Cleanup and teardown
   */
  function destroy() {
    clearTimeout(copyFeedbackTimeout);
    persistentPeersMap.clear();
    root.innerHTML = '';
  }

  return {
    render,
    destroy
  };
}
