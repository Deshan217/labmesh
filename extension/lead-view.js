// Standalone room diagnostics until the frontend teammate's ui.js is merged.
export function mount(root, actions) {
  root.innerHTML = '<section class="lead"><h2>Connect laptops</h2><p id="modules"></p><label>Display name<input id="name" maxlength="40" value="Instructor"></label><label>Room code<input id="code" maxlength="8"></label><div><button id="create">Create room</button><button id="join">Join room</button><button id="leave">Leave</button></div><p id="status" role="status"></p></section>';
  const find = id => root.querySelector("#" + id);
  for (const action of ["create","join"]) find(action).onclick = () => actions[action]({
    name:find("name").value, roomCode:find("code").value, endpoint:"ws://127.0.0.1:8765/ws"
  });
  find("leave").onclick = actions.leave;
  return {render(state) {
    find("modules").textContent = "Team-lead connection view. Merge the frontend and engine modules to enable file sharing.";
    find("create").disabled = find("join").disabled = state.session !== "idle";
    find("leave").disabled = state.session === "idle";
    const peers = state.transfer.peers.filter(p => p.online).map(p => p.name);
    find("status").textContent = [state.session, state.roomCode, peers.join(", "), state.error].filter(Boolean).join(" · ");
  },destroy(){ root.replaceChildren(); }};
}
