import {connect} from "./transport.js";
import {mount as leadView} from "./lead-view.js";

const empty = () => ({phase:"empty", mode:"normal", fileName:"", fileSize:0, chunkCount:0,
  peers:[], localVerifiedBytes:0, verified:false, readyToDisconnect:false, paused:false, detail:""});
const idle = () => ({session:"idle", selfId:"", hostId:"", roomCode:"", error:null, transfer:empty()});
let state = idle(), connection, engine, version = 0, busy = false, view;
const ask = document.querySelector("#ask");
const response = document.querySelector("#response");
function render() {
  view?.render(state);
  document.querySelector("#advisor").hidden = state.session !== "inRoom";
  ask.disabled = busy;
}
function fail(err) {
  state.error = err.message || String(err);
  render();
}
function leave() {
  version++;
  connection?.close();
  engine?.close();
  connection = engine = null;
  state = idle();
  busy = false;
  response.textContent = "";
  render();
}
async function teammateModule(path) {
  const url = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL(path) : path;
  try { if (!(await fetch(url)).ok) return null; } catch { return null; }
  return import(url);
}
const engineModule = await teammateModule("engine.js");
const uiModule = await teammateModule("ui.js");
if (uiModule) {
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("styles.css") : "styles.css";
  document.head.append(style);
}

async function enter(action, options) {
  if (state.session !== "idle") return;
  leave();
  const current = version;
  state.session = "connecting";
  render();
  let initialized = false;
  const queue = [];
  function forward(event) {
    if (event.type === "error") { fail(new Error(event.message)); return; }
    if (engine) {
      Promise.resolve(engine.onPeer(event)).catch(err => { if (version === current) fail(err); });
    } else {
      const peers = state.transfer.peers;
      if (event.type === "open") peers.push({id:event.peerId, name:event.name, online:true, have:[]});
      if (event.type === "close") {
        const peer = peers.find(p => p.id === event.peerId);
        if (peer) peer.online = false;
      }
      render();
    }
  }
  try {
    const transport = await connect({...options, displayName:options.name, action, onEvent:event => {
      if (version !== current) return;
      if (initialized) forward(event); else queue.push(event);
    }});
    if (version !== current) { transport.close(); return; }
    connection = transport;
    Object.assign(state, {session:"inRoom", selfId:transport.selfId, hostId:transport.hostId, roomCode:transport.roomCode});
    state.transfer.peers = [{id:state.selfId, name:options.name, online:true, have:[]}];
    if (engineModule) engine = engineModule.createEngine({
      selfId:transport.selfId, hostId:transport.hostId, send:transport.send,
      onState:transfer => { if (version === current) { state.transfer = transfer; render(); } }
    });
    initialized = true;
    for (const event of queue) forward(event);
    render();
  } catch (err) { if (version === current) { leave(); fail(err); } }
}

const actions = {
  create:options => enter("create", options), join:options => enter("join", options), leave,
  async share(file, {mode}) {
    const current = version;
    try {
      if (!engine) throw new Error("Merge extension/engine.js to enable file sharing.");
      if (state.selfId !== state.hostId) throw new Error("Only the source can select the room file.");
      if (!file || file.size < 1 || file.size > 8 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 8 MiB.");
      await engine.share(file, {mode});
    } catch (err) { if (version === current) fail(err); }
  },
  pause:() => engine?.pause(), resume:() => engine?.resume(),
  save() {
    const blob = engine?.getVerifiedBlob();
    if (!state.transfer.verified || !blob) return fail(new Error("Wait for whole-file verification."));
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = state.transfer.fileName.replace(/[\\/:*?"<>|]/g,"_") || "workshop.bin";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
};

ask.onclick = async () => {
  if (!connection || busy) return;
  const current = version;
  const t = state.transfer;
  const online = t.peers.filter(p => p.online);
  const receiverChunks = new Set(online.filter(p => p.id !== state.hostId).flatMap(p => p.have));
  const snapshot = {phase:t.phase, role:state.selfId === state.hostId ? "source" : "receiver",
    language:document.querySelector("#language").value, online_peers:online.length, chunks:t.chunkCount,
    local_chunks:t.peers.find(p => p.id === state.selfId)?.have.length ?? 0,
    missing_from_receivers:Math.max(0,t.chunkCount - receiverChunks.size),
    ready_to_disconnect:t.readyToDisconnect, verified:t.verified};
  busy = true;
  response.textContent = "Asking Gemini about this snapshot…";
  render();
  try {
    const reply = await connection.explain(snapshot);
    if (version === current) response.textContent = reply.answer + " · " + reply.model;
  } catch (err) {
    if (version === current) response.textContent = err.message;
  } finally {
    if (version === current) { busy = false; render(); }
  }
};
view = (uiModule?.mount ?? leadView)(document.querySelector("#app"), actions);
render();
window.addEventListener("pagehide", leave, {once:true});
