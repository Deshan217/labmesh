import json
import os
import re
from pathlib import Path
from typing import Literal

import httpx
from pydantic import BaseModel, ConfigDict, Field


def _load_env():
    for p in [Path(".env"), Path(__file__).resolve().parent.parent / ".env"]:
        if p.exists():
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip("'\"")
                    if k and not os.getenv(k):
                        os.environ[k] = v
            except Exception:
                pass


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    phase: Literal["empty", "seeding", "exchanging", "waiting", "checking", "complete", "error"]
    role: Literal["source", "receiver"]
    language: Literal["English", "Sinhala"]
    online_peers: int = Field(ge=0, le=3)
    chunks: int = Field(ge=0, le=1024)
    local_chunks: int = Field(ge=0, le=1024)
    missing_from_receivers: int = Field(ge=0, le=1024)
    ready_to_disconnect: bool
    verified: bool


async def explain(snapshot: Snapshot):
    _load_env()
    key = os.getenv("GEMINI_API_KEY")
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    if model == "gemini-3.8-flash":
        model = "gemini-2.5-flash"
    if not key:
        raise ValueError("Set GEMINI_API_KEY on the coordinator and restart it.")
    if not re.fullmatch(r"[a-zA-Z0-9.-]+", model):
        raise ValueError("Check the coordinator's GEMINI_MODEL setting.")
    if max(snapshot.local_chunks, snapshot.missing_from_receivers) > snapshot.chunks:
        raise ValueError("Inconsistent chunk counts.")
    facts = json.dumps(snapshot.model_dump())
    prompt = ("You assist a community computer workshop instructor. Explain this current transfer "
              "snapshot in the requested language in at most three short sentences. State the evidence "
              "and one useful next action. Receiver coverage uses last reported online inventories. "
              "Only recommend disconnecting the source if ready_to_disconnect is true. "
              "Only describe a local file as verified if verified is true. "
              "An empty session is waiting for a file. Do not invent rates, errors or ETA. Snapshot: " + facts)
    async with httpx.AsyncClient(timeout=18) as client:
        response = await client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            headers={"x-goog-api-key": key},
            json={"contents": [{"parts": [{"text": prompt}]}]},
        )
    if response.status_code != 200:
        raise ValueError(f"Gemini returned HTTP {response.status_code}. Check model, key and quota on the coordinator.")
    candidates = response.json().get("candidates") or []
    parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
    answer = " ".join(p["text"] for p in parts if p.get("text") and not p.get("thought")).strip()
    if not answer:
        raise ValueError("Gemini returned no explanation. Try again.")
    return {"answer": answer[:2400], "model": model}
