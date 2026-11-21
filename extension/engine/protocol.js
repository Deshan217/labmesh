/**
 * LabMesh Wire Protocol
 * Handles Binary Chunk framing and JSON Control messages.
 */

import { CHUNK_SIZE, MSG_TYPE } from "./constants.js";

const HEADER_SIZE = 4; // 4-byte UInt32 Big-Endian for chunk index

/**
 * Encodes a chunk index and binary data into a binary frame (ArrayBuffer).
 * Frame Format: [ 4-byte chunkIndex (UInt32 BE) | raw payload (1..8192 bytes) ]
 *
 * @param {number} chunkIndex
 * @param {Uint8Array | ArrayBuffer} chunkData
 * @returns {ArrayBuffer}
 */
export function encodeChunkFrame(chunkIndex, chunkData) {
  if (typeof chunkIndex !== "number" || chunkIndex < 0) {
    throw new Error(`Invalid chunkIndex for encoding: ${chunkIndex}`);
  }

  const payload = chunkData instanceof Uint8Array
    ? chunkData
    : new Uint8Array(chunkData);

  if (payload.byteLength === 0 || payload.byteLength > CHUNK_SIZE) {
    throw new Error(`Payload size ${payload.byteLength} exceeds maximum chunk size ${CHUNK_SIZE}`);
  }

  const frameBuffer = new ArrayBuffer(HEADER_SIZE + payload.byteLength);
  const view = new DataView(frameBuffer);
  view.setUint32(0, chunkIndex, false); // Big-Endian

  new Uint8Array(frameBuffer, HEADER_SIZE).set(payload);
  return frameBuffer;
}

/**
 * Decodes a binary frame.
 * @param {ArrayBuffer | Uint8Array} rawFrame
 * @returns {{ chunkIndex: number, data: Uint8Array } | null}
 */
export function decodeChunkFrame(rawFrame) {
  const buffer = rawFrame instanceof Uint8Array
    ? rawFrame.buffer.slice(rawFrame.byteOffset, rawFrame.byteOffset + rawFrame.byteLength)
    : rawFrame;

  if (!buffer || buffer.byteLength < HEADER_SIZE + 1) {
    return null;
  }

  const view = new DataView(buffer);
  const chunkIndex = view.getUint32(0, false);
  const data = new Uint8Array(buffer, HEADER_SIZE);

  return { chunkIndex, data };
}

/**
 * Creates JSON control messages.
 */
export const Protocol = {
  manifest(manifest) {
    return JSON.stringify({ type: MSG_TYPE.MANIFEST, manifest });
  },

  have(chunkIndexes) {
    return JSON.stringify({
      type: MSG_TYPE.HAVE,
      chunks: Array.isArray(chunkIndexes) ? chunkIndexes : [chunkIndexes],
    });
  },

  request(index) {
    return JSON.stringify({ type: MSG_TYPE.REQUEST, index });
  },

  demoAssign(assignments) {
    return JSON.stringify({ type: MSG_TYPE.DEMO_ASSIGN, assignments });
  },

  linkReady(from, to) {
    return JSON.stringify({ type: MSG_TYPE.LINK_READY, from, to });
  },
};
