/**
 * In-Memory Mock Transport for automated testing without signaling server.
 */

export class MockMeshTransport {
  constructor() {
    // peerId -> { engine, online: boolean }
    this.peers = new Map();
  }

  registerPeer(peerId, engine) {
    this.peers.set(peerId, { engine, online: true });
  }

  async connectPeers(peerA, peerB) {
    const pA = this.peers.get(peerA);
    const pB = this.peers.get(peerB);

    if (!pA || !pB) throw new Error("Peers must be registered before connecting.");

    await pA.engine.onPeer({ type: "open", peerId: peerB, name: peerB });
    await pB.engine.onPeer({ type: "open", peerId: peerA, name: peerA });
  }

  async send(fromPeerId, targetPeerId, payload) {
    const sender = this.peers.get(fromPeerId);
    const recipient = this.peers.get(targetPeerId);

    if (!sender || !sender.online) return;
    if (!recipient || !recipient.online) return;

    // Asynchronous dispatch mimicking network tick
    queueMicrotask(async () => {
      try {
        await recipient.engine.onPeer({
          type: "data",
          peerId: fromPeerId,
          payload,
        });
      } catch (err) {
        // Ignored in transport mock
      }
    });
  }

  async disconnectPeer(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    peer.online = false;

    for (const [otherId, other] of this.peers.entries()) {
      if (otherId !== peerId && other.online) {
        queueMicrotask(async () => {
          await other.engine.onPeer({ type: "close", peerId });
        });
      }
    }
  }
}
