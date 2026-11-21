import asyncio
import re
import secrets
import time
from dataclasses import dataclass, field

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from .gemini import Snapshot, explain

app = FastAPI()
rooms = {}
gemini_slots = asyncio.Semaphore(2)


@dataclass
class Room:
    host: str
    members: dict = field(default_factory=dict)
    next_advice: float = 0


async def deliver(socket, message):
    try:
        await socket.send_json(message)
    except (RuntimeError, WebSocketDisconnect, OSError):
        pass


async def advice(socket, snapshot, request_id):
    try:
        async with gemini_slots:
            result = await explain(snapshot)
        await deliver(socket, {"type": "advice", "requestId":request_id, **result})
    except (ValueError, httpx.HTTPError) as exc:
        message = str(exc) if isinstance(exc, ValueError) else "Gemini connection failed. Check coordinator internet."
        await deliver(socket, {"type": "advice", "requestId":request_id, "error": message})


@app.websocket("/ws")
async def signaling(ws: WebSocket):
    origin = ws.headers.get("origin")
    if origin and not (
        re.fullmatch(r"chrome-extension://[a-p]{32}", origin)
        or re.fullmatch(r"https?://(127\.0\.0\.1|localhost)(:\d+)?", origin)
    ):
        await ws.close(code=1008)
        return
    await ws.accept()
    peer = secrets.token_hex(8)
    room = task = None
    code = ""
    try:
        hello = await asyncio.wait_for(ws.receive_json(), 15)
        name = hello.get("name", "")
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40:
            raise ValueError("Enter a display name of 1 to 40 characters.")
        name = name.strip()
        if hello.get("type") == "create":
            code = secrets.token_hex(4).upper()
            while code in rooms:
                code = secrets.token_hex(4).upper()
            room = rooms[code] = Room(peer)
        elif hello.get("type") == "join":
            code = str(hello.get("roomCode", "")).strip().upper()
            room = rooms.get(code)
            if not room or len(room.members) >= 3:
                raise ValueError("Room is unavailable or full.")
        else:
            raise ValueError("Create or join a room first.")
        roster = [{"id": key, "name": entry[0]} for key, entry in room.members.items()]
        previous = list(room.members.values())
        room.members[peer] = (name, ws)
        await ws.send_json(dict(type="welcome", selfId=peer, hostId=room.host, roomCode=code, peers=roster))
        for _, other in previous:
            await deliver(other, dict(type="joined", id=peer, name=name))
        while True:
            msg = await ws.receive_json()
            kind = msg.get("type")
            if kind == "signal":
                target = room.members.get(msg.get("to"))
                data = msg.get("data")
                if target and target[1] is not ws and isinstance(data, dict) and set(data) in ({"sdp"}, {"ice"}):
                    await deliver(target[1], dict(type="signal", peerId=peer, data=data))
                else:
                    await deliver(ws, dict(type="error", message="Peer or negotiation message unavailable."))
            elif kind == "leave":
                break
            elif kind == "explain":
                request_id = str(msg.get("requestId", ""))[:64]
                if (task and not task.done()) or time.monotonic() < room.next_advice:
                    await deliver(ws, dict(type="advice", requestId=request_id, error="Wait a few seconds before asking again."))
                    continue
                try:
                    snapshot = Snapshot.model_validate(msg.get("snapshot"))
                except ValidationError:
                    await deliver(ws, dict(type="advice", requestId=request_id, error="Invalid transfer snapshot."))
                    continue
                room.next_advice = time.monotonic() + 5
                task = asyncio.create_task(advice(ws, snapshot, request_id))
            else:
                raise ValueError("Unknown room command.")
    except (WebSocketDisconnect, OSError):
        pass
    except (ValueError, TypeError, AttributeError, asyncio.TimeoutError) as exc:
        await deliver(ws, dict(type="error", message=str(exc)[:150] or "Invalid room request."))
        await ws.close(code=1008)
    finally:
        if task:
            task.cancel()
        if room and room.members.pop(peer, None):
            for _, other in list(room.members.values()):
                await deliver(other, dict(type="left", id=peer))
            if not room.members:
                rooms.pop(code, None)
