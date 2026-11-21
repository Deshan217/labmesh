/**
 * Cryptographic helpers using standard Web Crypto API (SHA-256).
 * Compatible with Browser and Node.js 18+.
 */

const subtle = (typeof globalThis !== "undefined" && globalThis.crypto?.subtle)
  ? globalThis.crypto.subtle
  : null;

/**
 * Computes SHA-256 hash of a buffer/typed array.
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Promise<string>} Hex-encoded lowercase SHA-256 string
 */
export async function sha256Hex(data) {
  if (!subtle) {
    throw new Error("Web Crypto API (crypto.subtle) is not available.");
  }

  // Ensure ArrayBufferView or ArrayBuffer
  const buffer = data instanceof ArrayBuffer
    ? data
    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  const hashBuffer = await subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates whether a given string is a valid 64-char lowercase hex SHA-256 hash.
 * @param {string} hash
 * @returns {boolean}
 */
export function isValidSha256(hash) {
  return typeof hash === "string" && /^[0-9a-f]{64}$/i.test(hash);
}
