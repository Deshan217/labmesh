/**
 * LabMesh Engine Constants
 * Conforms to JIAT Hack Days 2026 LabMesh specification.
 */

export const CHUNK_SIZE = 8 * 1024; // 8 KiB = 8192 bytes
export const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MiB
export const MIN_FILE_SIZE = 1; // 1 byte

export const MAX_IN_FLIGHT_PER_PEER = 4;
export const REQUEST_TIMEOUT_MS = 2500;

export const MSG_TYPE = {
  MANIFEST: "manifest",
  HAVE: "have",
  REQUEST: "request",
  DEMO_ASSIGN: "demo_assign",
  LINK_READY: "link_ready",
};

export const PHASE = {
  EMPTY: "empty",
  SEEDING: "seeding",
  EXCHANGING: "exchanging",
  WAITING: "waiting",
  CHECKING: "checking",
  COMPLETE: "complete",
  ERROR: "error",
};

export const MODE = {
  NORMAL: "normal",
  DEMO: "demo",
};
