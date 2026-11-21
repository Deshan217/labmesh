/**
 * LabMesh UI Representative State Snapshots
 * Used by interactive harness and automated test runners.
 * Completely isolated in tests/ui/ outside production extension bundle.
 */

export const snapshots = {
  // 1. Lobby Idle: Initial fresh state
  lobbyIdle: {
    name: '1. Lobby (Idle)',
    description: 'Initial participant setup with prefilled WebSocket endpoint',
    state: {
      session: 'idle',
      selfId: null,
      hostId: null,
      roomCode: null,
      error: null,
      transfer: null
    }
  },

  // 2. Lobby Connecting: Waiting for WebSocket handshake
  lobbyConnecting: {
    name: '2. Lobby (Connecting)',
    description: 'Connection in progress to FastAPI signaling relay',
    state: {
      session: 'connecting',
      selfId: null,
      hostId: null,
      roomCode: null,
      error: null,
      transfer: null
    }
  },

  // 3. Lobby Error: Recoverable failure (e.g. relay server unreachable)
  lobbyError: {
    name: '3. Lobby (Recoverable Error)',
    description: 'Signaling relay failure banner with preserved input values',
    state: {
      session: 'idle',
      selfId: null,
      hostId: null,
      roomCode: 'LM-FAIL',
      error: 'WebSocket connection to ws://127.0.0.1:8765/ws failed: Connection refused. Ensure relay is running on B or team hotspot.',
      transfer: null
    }
  },

  // 4. Host View: Room created, awaiting file selection
  hostAwaitingFile: {
    name: '4. Host In Room (Awaiting File Selection)',
    description: 'Instructor A view showing starter kit file picker and Staged/Normal mode selector',
    state: {
      session: 'inRoom',
      selfId: 'peer-alice-01',
      hostId: 'peer-alice-01',
      roomCode: 'LM-42',
      error: null,
      transfer: {
        phase: 'empty',
        mode: 'demo',
        fileName: '',
        fileSize: 0,
        chunkCount: 0,
        peers: [
          { id: 'peer-alice-01', name: 'Alice (Instructor)', online: true, have: [] },
          { id: 'peer-bob-02', name: 'Bob (Student B)', online: true, have: [] },
          { id: 'peer-charlie-03', name: 'Charlie (Student C)', online: true, have: [] }
        ],
        localVerifiedBytes: 0,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Room open. Host selects starter kit file.'
      }
    }
  },

  // 5. Transfer Seeding: Host A distributing initial chunks in demo mode
  transferSeeding: {
    name: '5. Transfer Seeding (Staged Demo Mode)',
    description: 'Host A seeding even chunks to B and odd chunks to C',
    state: {
      session: 'inRoom',
      selfId: 'peer-bob-02',
      hostId: 'peer-alice-01',
      roomCode: 'LM-42',
      error: null,
      transfer: {
        phase: 'seeding',
        mode: 'demo',
        fileName: 'workshop-starter-kit.tar.gz',
        fileSize: 1048576, // 1 MiB
        chunkCount: 16,
        peers: [
          { id: 'peer-alice-01', name: 'Alice (Instructor)', online: true, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
          { id: 'peer-bob-02', name: 'Bob (Student B)', online: true, have: [0,2,4] },
          { id: 'peer-charlie-03', name: 'Charlie (Student C)', online: true, have: [1,3] }
        ],
        localVerifiedBytes: 196608,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Seeding even chunks to B and odd chunks to C over WebRTC data channels.'
      }
    }
  },

  // 6. Ready to Disconnect: Complementary sets reached, B-C link confirmed open
  transferReadyToDisconnect: {
    name: '6. READY TO DISCONNECT SOURCE (Key Milestone)',
    description: 'B holds even chunks, C holds odd chunks, mutual direct link open. Disconnect banner visible.',
    state: {
      session: 'inRoom',
      selfId: 'peer-bob-02',
      hostId: 'peer-alice-01',
      roomCode: 'LM-42',
      error: null,
      transfer: {
        phase: 'waiting',
        mode: 'demo',
        fileName: 'workshop-starter-kit.tar.gz',
        fileSize: 1048576,
        chunkCount: 16,
        peers: [
          { id: 'peer-alice-01', name: 'Alice (Instructor)', online: true, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
          { id: 'peer-bob-02', name: 'Bob (Student B)', online: true, have: [0,2,4,6,8,10,12,14] },
          { id: 'peer-charlie-03', name: 'Charlie (Student C)', online: true, have: [1,3,5,7,9,11,13,15] }
        ],
        localVerifiedBytes: 524288,
        verified: false,
        readyToDisconnect: true,
        paused: false,
        detail: 'All chunks jointly held by B and C. Mutual WebRTC channel open. Host can disconnect.'
      }
    }
  },

  // 7. Failover Exchanging: Host A departed, B and C completing download directly
  transferFailoverExchanging: {
    name: '7. Failover In Progress (Host Offline)',
    description: 'Host row persists as Offline. B and C actively trade missing halves over direct P2P link.',
    state: {
      session: 'inRoom',
      selfId: 'peer-bob-02',
      hostId: 'peer-alice-01',
      roomCode: 'LM-42',
      error: null,
      transfer: {
        phase: 'exchanging',
        mode: 'demo',
        fileName: 'workshop-starter-kit.tar.gz',
        fileSize: 1048576,
        chunkCount: 16,
        peers: [
          { id: 'peer-alice-01', name: 'Alice (Instructor)', online: false, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
          { id: 'peer-bob-02', name: 'Bob (Student B)', online: true, have: [0,1,2,3,4,6,8,10,12,14] },
          { id: 'peer-charlie-03', name: 'Charlie (Student C)', online: true, have: [0,1,2,3,5,7,9,11,13,15] }
        ],
        localVerifiedBytes: 655360,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Host A departed. Peers B and C exchanging remaining complementary chunks directly.'
      }
    }
  },

  // 8. Verified & Complete: Both peers have all chunks and SHA-256 is verified
  transferVerifiedComplete: {
    name: '8. Verified & Complete (Save File Ready)',
    description: '100% verified locally with whole-file SHA-256 match. Save button enabled.',
    state: {
      session: 'inRoom',
      selfId: 'peer-bob-02',
      hostId: 'peer-alice-01',
      roomCode: 'LM-42',
      error: null,
      transfer: {
        phase: 'complete',
        mode: 'demo',
        fileName: 'workshop-starter-kit.tar.gz',
        fileSize: 1048576,
        chunkCount: 16,
        peers: [
          { id: 'peer-alice-01', name: 'Alice (Instructor)', online: false, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
          { id: 'peer-bob-02', name: 'Bob (Student B)', online: true, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
          { id: 'peer-charlie-03', name: 'Charlie (Student C)', online: true, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] }
        ],
        localVerifiedBytes: 1048576,
        verified: true,
        readyToDisconnect: false,
        paused: false,
        detail: 'SHA-256 verified: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
      }
    }
  },

  // 9. Early Disconnect & Missing Chunks: Unrecoverable missing piece error detail
  transferEarlyDisconnectMissing: {
    name: '9. Early Disconnect (Missing Chunk 14 & 15)',
    description: 'Host disconnected prematurely before seeding all chunks. Real engine detail shown.',
    state: {
      session: 'inRoom',
      selfId: 'peer-bob-02',
      hostId: 'peer-alice-01',
      roomCode: 'LM-42',
      error: null,
      transfer: {
        phase: 'waiting',
        mode: 'demo',
        fileName: 'workshop-starter-kit.tar.gz',
        fileSize: 1048576,
        chunkCount: 16,
        peers: [
          { id: 'peer-alice-01', name: 'Alice (Instructor)', online: false, have: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15] },
          { id: 'peer-bob-02', name: 'Bob (Student B)', online: true, have: [0,2,4,6,8,10,12] },
          { id: 'peer-charlie-03', name: 'Charlie (Student C)', online: true, have: [1,3,5,7,9,11,13] }
        ],
        localVerifiedBytes: 458752,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Chunks 14 and 15 unavailable: host disconnected early and no online peer has these chunks. Waiting for seeder to rejoin.'
      }
    }
  },

  // 10. Large File (128 Chunks): Demonstrates bounded cell bucket grouping (32 cells)
  transferLargeFileManyChunks: {
    name: '10. Large File (128 Chunks Bounded Grouping)',
    description: 'Tests chunk strip visual aggregation into 32 cells (empty, partial, full)',
    state: {
      session: 'inRoom',
      selfId: 'peer-bob-02',
      hostId: 'peer-alice-01',
      roomCode: 'LM-99',
      error: null,
      transfer: {
        phase: 'exchanging',
        mode: 'normal',
        fileName: 'large-dataset-archive.zip',
        fileSize: 8388608, // 8 MiB max
        chunkCount: 128,
        peers: [
          { 
            id: 'peer-alice-01', 
            name: 'Alice (Host)', 
            online: true, 
            have: Array.from({ length: 128 }, (_, i) => i) 
          },
          { 
            id: 'peer-bob-02', 
            name: 'Bob (You)', 
            online: true, 
            // First 32 chunks full, next 32 partial (evens only), last 64 empty
            have: [
              ...Array.from({ length: 32 }, (_, i) => i),
              ...Array.from({ length: 16 }, (_, i) => 32 + i * 2)
            ] 
          },
          { 
            id: 'peer-charlie-03', 
            name: 'Charlie (Peer C)', 
            online: true, 
            have: Array.from({ length: 48 }, (_, i) => 16 + i) 
          }
        ],
        localVerifiedBytes: 3145728,
        verified: false,
        readyToDisconnect: false,
        paused: false,
        detail: 'Normal swarm transfer active across 3 peers.'
      }
    }
  }
};
