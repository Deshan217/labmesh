# Room protocol

Use one WebSocket at /ws per extension tab. Client messages are JSON objects. First send {"type":"create","name":"Instructor"} or {"type":"join","name":"Receiver","roomCode":"ABCDEFGH"}. The response is welcome with selfId, immutable hostId, roomCode and peers (the previous roster with id and name). Existing members receive joined with id and name. A leaving peer causes left with id. The room persists until its last connection closes.

The newcomer opens an ordered WebRTC data channel to each existing peer and generates the SDP offer. Send {"type":"signal","to":"peer ID","data":{"sdp":{...}}} for descriptions or use data.ice for an ICE candidate. The receiving member gets type=signal, peerId identifying the sender, and data. The server routes only within the sender's room. An invalid destination returns type=error with message. The sender of file data uses the channel established by this exchange.

A member may explicitly send {"type":"leave"} or disconnect the WebSocket to leave the room. Duplicate leaves and disconnects are handled idempotently, notifying remaining peers with type=left and cleaning up empty rooms while preserving hostId for active rooms.

The room guide uses type=explain, a requestId and snapshot matching server/gemini.py. The response is type=advice with the same requestId and either answer and model, or error. The server enforces a five-second interval between accepted requests in each room. Calls run separately from the signaling loop. Set GEMINI_API_KEY only on the server machine.
