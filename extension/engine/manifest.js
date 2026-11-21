/**
 * LabMesh Manifest Creator & Validator
 */

import { CHUNK_SIZE, MAX_FILE_SIZE, MIN_FILE_SIZE } from "./constants.js";
import { sha256Hex, isValidSha256 } from "./crypto.js";

/**
 * Sanitizes a filename to prevent path traversal or control characters.
 * @param {string} rawName
 * @returns {string}
 */
export function sanitizeFileName(rawName) {
  if (typeof rawName !== "string" || !rawName.trim()) {
    return "shared_file.bin";
  }
  // Remove directory separators and null/control bytes
  const base = rawName.split(/[\/\\]/).pop() || "shared_file.bin";
  const cleaned = base.replace(/[\x00-\x1f\x7f]/g, "").trim();
  return (cleaned.slice(0, 120) || "shared_file.bin");
}

/**
 * Creates a manifest from a File, Blob, or Uint8Array.
 * @param {File | Blob | Uint8Array} file
 * @param {string} [nameOverride]
 * @returns {Promise<{
 *   fileName: string,
 *   fileSize: number,
 *   chunkSize: number,
 *   chunkCount: number,
 *   chunkHashes: string[],
 *   fileHash: string
 * }>}
 */
export async function createManifest(file, nameOverride) {
  let buffer;
  let fileName = nameOverride || "file.bin";

  if (typeof Blob !== "undefined" && file instanceof Blob) {
    if (file.name && !nameOverride) fileName = file.name;
    buffer = await file.arrayBuffer();
  } else if (file instanceof Uint8Array) {
    buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  } else if (file instanceof ArrayBuffer) {
    buffer = file;
  } else {
    throw new Error("Invalid file source. Expected Blob, File, ArrayBuffer, or Uint8Array.");
  }

  const fileSize = buffer.byteLength;
  if (fileSize < MIN_FILE_SIZE || fileSize > MAX_FILE_SIZE) {
    throw new Error(`File size ${fileSize} bytes outside allowed range (${MIN_FILE_SIZE} - ${MAX_FILE_SIZE} bytes).`);
  }

  const chunkCount = Math.ceil(fileSize / CHUNK_SIZE);
  const chunkHashes = [];

  for (let i = 0; i < chunkCount; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const chunkSlice = buffer.slice(start, end);
    const chunkHash = await sha256Hex(chunkSlice);
    chunkHashes.push(chunkHash);
  }

  const fileHash = await sha256Hex(buffer);

  return {
    fileName: sanitizeFileName(fileName),
    fileSize,
    chunkSize: CHUNK_SIZE,
    chunkCount,
    chunkHashes,
    fileHash,
  };
}

/**
 * Validates the schema and values of a received manifest.
 * @param {unknown} manifest
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { valid: false, error: "Manifest must be a non-null object" };
  }

  const { fileName, fileSize, chunkSize, chunkCount, chunkHashes, fileHash } = manifest;

  if (typeof fileName !== "string" || fileName.length === 0 || fileName.length > 255) {
    return { valid: false, error: "Invalid fileName" };
  }

  if (typeof fileSize !== "number" || !Number.isInteger(fileSize) || fileSize < MIN_FILE_SIZE || fileSize > MAX_FILE_SIZE) {
    return { valid: false, error: `Invalid fileSize: ${fileSize}` };
  }

  if (chunkSize !== CHUNK_SIZE) {
    return { valid: false, error: `Invalid chunkSize: ${chunkSize}. Expected ${CHUNK_SIZE}` };
  }

  const expectedChunkCount = Math.ceil(fileSize / CHUNK_SIZE);
  if (typeof chunkCount !== "number" || chunkCount !== expectedChunkCount) {
    return { valid: false, error: `Invalid chunkCount ${chunkCount}. Expected ${expectedChunkCount}` };
  }

  if (!Array.isArray(chunkHashes) || chunkHashes.length !== expectedChunkCount) {
    return { valid: false, error: `chunkHashes length mismatch. Expected ${expectedChunkCount}` };
  }

  for (let i = 0; i < chunkHashes.length; i++) {
    if (!isValidSha256(chunkHashes[i])) {
      return { valid: false, error: `Invalid chunk hash at index ${i}` };
    }
  }

  if (!isValidSha256(fileHash)) {
    return { valid: false, error: "Invalid whole fileHash" };
  }

  return { valid: true };
}
