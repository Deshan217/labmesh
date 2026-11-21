const LOCAL = "ws://127.0.0.1:8765/ws";

function writable(channel) {
  if (channel.readyState !== "open") return Promise.reject(new Error("Peer disconnected."));
  if (channel.bufferedAmount <= 256 * 1024) return Promise.resolve();
  return new Promise((resolve, reject) => {
    function finish(error) {
      clearTimeout(timer);
      channel.removeEventListener("bufferedamountlow", drained);
      channel.removeEventListener("close", closed);
      error ? reject(error) : resolve();
    }
    const drained = () => finish();
    const closed = () => finish(new Error("Peer disconnected during send."));
    const timer = setTimeout(() => finish(new Error("Peer send queue timed out.")), 12000);
    channel.addEventListener("bufferedamountlow", drained);
    channel.addEventListener("close", closed);
  });
}

export async function connect({endpoint = LOCAL, roomCode, displayName, action, onEvent}) {
  const target = (endpoint || LOCAL).trim().replace(/\/+$/, "");
  const normalized = target.endsWith("/ws") ? target : target + "/ws";
  if (normalized !== LOCAL) {
    throw new Error(`Use the local endpoint ${LOCAL} and run the coordinator on B or forwarder on A/C.`);
  }
  const socket = new WebSocket(LOCAL);
  const peers = new Map();
  let closed = false;
  let welcomed = false;
  let pendingAdvice;
  let resolveJoin, rejectJoin;
  const welcome = new Promise((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; });
  const timer = setTimeout(() => rejectJoin(new Error("Coordinator did not respond.")), 12000);
  const report = message => { if (!closed) onEvent({type:"error", message}); };
  const transmit = message => socket.send(JSON.stringify(message));

  function drop(id) {
    const link = peers.get(id);
    if (!link) return;
    peers.delete(id);
    clearTimeout(link.disconnectTimer);
    try { link.pc.close(); } catch (_) {}
    if (!closed) onEvent({type:"close", peerId:id});
  }

  function register(id, name) {
    if (peers.has(id)) return peers.get(id);
    let pc;
    try {
      pc = new RTCPeerConnection({iceServers:[]});
    } catch (err) {
      report("Failed to create WebRTC peer connection: " + err.message);
      return null;
    }
    const link = {pc, channel:null, pendingIce:[], queue:Promise.resolve()};
    peers.set(id, link);
    pc.onicecandidate = ({candidate}) => {
      if (candidate && socket.readyState === WebSocket.OPEN)
        transmit({type:"signal", to:id, data:{ice:candidate.toJSON()}});
    };
    pc.onconnectionstatechange = () => {
      clearTimeout(link.disconnectTimer);
      if (pc.connectionState === "failed") drop(id);
      if (pc.connectionState === "disconnected")
        link.disconnectTimer = setTimeout(() => drop(id), 8000);
    };
    link.attach = channel => {
      link.channel = channel;
      channel.binaryType = "arraybuffer";
      channel.bufferedAmountLowThreshold = 64 * 1024;
      channel.onopen = () => onEvent({type:"open", peerId:id, name});
      channel.onmessage = event => onEvent({type:"data", peerId:id, payload:event.data});
      channel.onclose = () => drop(id);
      channel.onerror = () => report("Peer data channel failed. Check the LAN connection.");
    };
    pc.ondatachannel = ({channel}) => link.attach(channel);
    return link;
  }

  async function handle(message) {
    if (closed) return;
    if (message.type === "welcome") {
      welcomed = true;
      resolveJoin(message);
      // Only the arriving member offers to the existing roster.
      for (const peer of message.peers) {
        const link = register(peer.id, peer.name);
        if (!link) continue;
        try {
          link.attach(link.pc.createDataChannel("labmesh", {ordered:true}));
          const offer = await link.pc.createOffer();
          await link.pc.setLocalDescription(offer);
          transmit({type:"signal", to:peer.id, data:{sdp:link.pc.localDescription}});
        } catch (err) {
          report("Failed to negotiate peer connection to " + peer.name + ": " + err.message);
        }
      }
    } else if (message.type === "joined") {
      register(message.id, message.name);
    } else if (message.type === "left") {
      drop(message.id);
    } else if (message.type === "signal") {
      const link = peers.get(message.peerId);
      if (!link) return;
      const {sdp, ice} = message.data;
      if (sdp) {
        try {
          await link.pc.setRemoteDescription(sdp);
          for (const candidate of link.pendingIce.splice(0)) {
            try { await link.pc.addIceCandidate(candidate); } catch (_) {}
          }
          if (sdp.type === "offer") {
            const answer = await link.pc.createAnswer();
            await link.pc.setLocalDescription(answer);
            transmit({type:"signal", to:message.peerId, data:{sdp:link.pc.localDescription}});
          }
        } catch (err) {
          report("Peer negotiation failed: " + err.message);
        }
      } else if (ice) {
        if (link.pc.remoteDescription) {
          try { await link.pc.addIceCandidate(ice); } catch (_) {}
        } else {
          link.pendingIce.push(ice);
        }
      }
    } else if (message.type === "advice") {
      pendingAdvice?.(message);
    } else if (message.type === "error") {
      if (!welcomed) rejectJoin(new Error(message.message));
      else report(message.message);
    }
  }

  let inbox = Promise.resolve();
  socket.onopen = () => transmit({type:action, name:displayName, roomCode});
  socket.onmessage = event => {
    inbox = inbox.then(() => handle(JSON.parse(event.data))).catch(err => report(err.message));
  };
  socket.onclose = () => {
    const message = "Coordinator disconnected. Check the server or local forwarder.";
    rejectJoin(new Error(message));
    pendingAdvice?.({error:message});
    if (welcomed) report(message);
  };
  socket.onerror = () => rejectJoin(new Error("Coordinator unreachable at " + LOCAL + ". On laptop B run uvicorn; on laptops A and C run 'python server/forward.py <B_LAN_IP>'."));

  function close() {
    closed = true;
    pendingAdvice?.({error:"Room closed."});
    for (const id of [...peers.keys()]) drop(id);
    try {
      if (socket.readyState === WebSocket.OPEN) {
        transmit({type:"leave"});
      }
    } catch (_) {}
    socket.close();
  }
  try {
    const {selfId, hostId, roomCode:code} = await welcome;
    return {selfId, hostId, roomCode:code, close,
      send(id, payload) {
        const link = peers.get(id);
        if (!link?.channel) return Promise.reject(new Error("Peer channel unavailable."));
        const channel = link.channel;
        const next = link.queue.then(async () => { await writable(channel); channel.send(payload); });
        link.queue = next.catch(() => {});
        return next;
      },
      explain(snapshot) {
        if (pendingAdvice || socket.readyState !== WebSocket.OPEN)
          return Promise.reject(new Error("Coordinator busy or disconnected."));
        return new Promise((resolve, reject) => {
          const requestId = crypto.randomUUID();
          const timeout = setTimeout(() => pendingAdvice?.({error:"Gemini request timed out."}), 25000);
          pendingAdvice = reply => {
            if (reply.requestId !== undefined && reply.requestId !== requestId) return;
            clearTimeout(timeout);
            pendingAdvice = null;
            reply.error ? reject(new Error(reply.error)) : resolve(reply);
          };
          try { transmit({type:"explain", requestId, snapshot}); } catch (err) { pendingAdvice({error:err.message}); }
        });
      }
    };
  } catch (err) {
    close();
    throw err;
  } finally { clearTimeout(timer); }
}
