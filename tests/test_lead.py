import os
import json
import socket
import threading
import time
import unittest
from contextlib import contextmanager
from unittest.mock import AsyncMock, patch

import httpx
import uvicorn
from websockets.sync.client import connect

from server.main import app


def join(socket, code=None):
    socket.send_json({"type": "join" if code else "create", "name": "Tester", "roomCode": code})
    return socket.receive_json()


class TestCoordinator:
    def __init__(self):
        self.listener = socket.socket()
        self.listener.bind(("127.0.0.1", 0))
        self.port = self.listener.getsockname()[1]
        config = uvicorn.Config(app, log_level="error", ws="auto")
        self.server = uvicorn.Server(config)
        self.thread = threading.Thread(target=self.server.run, kwargs={"sockets":[self.listener]}, daemon=True)
        self.thread.start()
        for _ in range(100):
            if self.server.started:
                break
            time.sleep(.02)

    @contextmanager
    def websocket_connect(self, path, origin=None, port=None):
        target_port = port or self.port
        headers = [("Origin", origin)] if origin else []
        with connect(f"ws://127.0.0.1:{target_port}{path}", additional_headers=headers, proxy=None) as ws:
            class Session:
                def send_json(self, message):
                    ws.send(json.dumps(message))

                def receive_json(self):
                    return json.loads(ws.recv(timeout=4))
            yield Session()

    def close(self):
        self.server.should_exit = True
        self.thread.join(5)
        self.listener.close()


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.client = TestCoordinator()
        self.addCleanup(self.client.close)

    def test_invalid_room(self):
        with self.client.websocket_connect("/ws") as ws:
            self.assertEqual(join(ws, "BADCODE")["type"], "error")

    def test_capacity_isolation_and_departure(self):
        with self.client.websocket_connect("/ws") as outsider, self.client.websocket_connect("/ws") as b:
            foreign = join(outsider)
            with self.client.websocket_connect("/ws") as a:
                host = join(a)
                member = join(b, host["roomCode"])
                self.assertEqual(a.receive_json()["id"], member["selfId"])
                with self.client.websocket_connect("/ws") as c:
                    join(c, host["roomCode"])
                    b.receive_json()
                    with self.client.websocket_connect("/ws") as d:
                        self.assertEqual(join(d, host["roomCode"])["type"], "error")
                    b.send_json({"type":"signal","to":foreign["selfId"],"data":{"ice":{}}})
                    self.assertEqual(b.receive_json()["type"], "error")
                b.receive_json()
            self.assertEqual(b.receive_json(), {"type":"left", "id":host["selfId"]})
            with self.client.websocket_connect("/ws") as replacement:
                self.assertEqual(join(replacement, host["roomCode"])["hostId"], host["selfId"])

    def test_gemini_round_trip(self):
        facts = dict(phase="empty", role="source", language="Sinhala", online_peers=1, chunks=0,
                     local_chunks=0, missing_from_receivers=0, ready_to_disconnect=False, verified=False)
        api = httpx.Response(200, json={"candidates":[{"content":{"parts":[{"text":"Select a file."}]}}]})
        with patch.dict(os.environ, {"GEMINI_API_KEY":"unit-test", "GEMINI_MODEL":"test-model"}):
            with patch("server.gemini.httpx.AsyncClient.post", new_callable=AsyncMock, return_value=api) as request:
                with self.client.websocket_connect("/ws") as ws:
                    join(ws)
                    ws.send_json({"type":"explain","snapshot":dict(facts, fileName="private")})
                    self.assertIn("error", ws.receive_json())
                    ws.send_json({"type":"explain","snapshot":facts})
                    reply = ws.receive_json()
                    self.assertEqual(reply["answer"], "Select a file.")
                    self.assertEqual(reply["model"], "test-model")
                    self.assertTrue(request.await_args.args[0].endswith("/test-model:generateContent"))
                    self.assertEqual(request.await_args.kwargs["headers"]["x-goog-api-key"], "unit-test")
                    prompt = request.await_args.kwargs["json"]["contents"][0]["parts"][0]["text"]
                    self.assertIn("Sinhala", prompt)
                    self.assertNotIn("fileName", prompt)

    def test_explicit_leave_and_duplicate(self):
        with self.client.websocket_connect("/ws") as a, self.client.websocket_connect("/ws") as b:
            host = join(a)
            member = join(b, host["roomCode"])
            a.receive_json()  # joined event
            # Member sends explicit leave
            b.send_json({"type": "leave"})
            left_event = a.receive_json()
            self.assertEqual(left_event, {"type": "left", "id": member["selfId"]})

    def test_invalid_display_names(self):
        # Empty name
        with self.client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "create", "name": "", "roomCode": None})
            err = ws.receive_json()
            self.assertEqual(err["type"], "error")
            self.assertIn("display name", err["message"])

        # Whitespace only
        with self.client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "create", "name": "   ", "roomCode": None})
            err = ws.receive_json()
            self.assertEqual(err["type"], "error")

        # Exceeding 40 characters
        with self.client.websocket_connect("/ws") as ws:
            ws.send_json({"type": "create", "name": "A" * 41, "roomCode": None})
            err = ws.receive_json()
            self.assertEqual(err["type"], "error")

    def test_origin_validation(self):
        from websockets.exceptions import ConnectionClosed, InvalidStatus

        # Valid extension origin
        valid_origin = "chrome-extension://" + "a" * 32
        with self.client.websocket_connect("/ws", origin=valid_origin) as ws:
            res = join(ws)
            self.assertEqual(res["type"], "welcome")

        # Valid local origin
        with self.client.websocket_connect("/ws", origin="http://localhost:8765") as ws:
            res = join(ws)
            self.assertEqual(res["type"], "welcome")

        # Disallowed untrusted web origin should be rejected
        with self.assertRaises((ConnectionClosed, InvalidStatus)):
            with self.client.websocket_connect("/ws", origin="https://untrusted-web-app.com"):
                pass

    def test_forwarder_loopback(self):
        import asyncio
        from server.forward import create_forwarder

        async def run_forwarder():
            server = await create_forwarder("127.0.0.1", self.client.port, "127.0.0.1", 0)
            port = server.sockets[0].getsockname()[1]
            return server, port

        loop = asyncio.new_event_loop()
        server, forwarder_port = loop.run_until_complete(run_forwarder())
        thread = threading.Thread(target=loop.run_forever, daemon=True)
        thread.start()

        try:
            with self.client.websocket_connect("/ws", port=forwarder_port) as ws:
                res = join(ws)
                self.assertEqual(res["type"], "welcome")
                self.assertEqual(len(res["roomCode"]), 8)
                self.assertEqual(len(res["selfId"]), 16)
        finally:
            async def shutdown():
                server.close()
                await server.wait_closed()
            future = asyncio.run_coroutine_threadsafe(shutdown(), loop)
            future.result(timeout=2)
            loop.call_soon_threadsafe(loop.stop)
            thread.join(2)
            loop.close()
