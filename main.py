"""
CheapGPT: serve the ChatGPT-like UI and proxy chat to local Ollama.
Run from repo root: uvicorn main:app --reload --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"

load_dotenv(ROOT / ".env")

OLLAMA_BASE = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
DEFAULT_MODEL = os.environ.get("CHEAPGPT_MODEL", "llama3.2")


def infer_thinking_capable(model_name: str, item: dict) -> bool:
    """
    Heuristic detection for reasoning-capable models.
    Ollama tags do not currently expose a universal "thinking" flag.
    """
    n = model_name.lower()
    keywords = (
        "r1",
        "reason",
        "think",
        "qwq",
        "o1",
        "o3",
    )
    if any(k in n for k in keywords):
        return True

    details = item.get("details")
    if isinstance(details, dict):
        families = details.get("families")
        if isinstance(families, list):
            fam_text = " ".join(str(f).lower() for f in families)
            if "qwq" in fam_text or "r1" in fam_text:
                return True
    return False


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)


app = FastAPI(title="CheapGPT")


@app.get("/api/health")
async def health():
    ok = False
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            ok = r.is_success
    except httpx.HTTPError:
        pass
    return {"ollama_reachable": ok, "ollama_base": OLLAMA_BASE, "default_model": DEFAULT_MODEL}


@app.get("/api/models")
async def list_models():
    """Proxy Ollama /api/tags for the UI model picker."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{OLLAMA_BASE}/api/tags")
            r.raise_for_status()
            payload = r.json()
    except httpx.ConnectError as e:
        raise HTTPException(
            status_code=502,
            detail=f"Cannot connect to Ollama at {OLLAMA_BASE}: {e}",
        ) from e
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=str(e)) from e

    raw = payload.get("models") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        raw = []

    models: list[dict] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        if not name or not isinstance(name, str):
            continue
        entry: dict = {"name": name, "supports_thinking": infer_thinking_capable(name, item)}
        if "size" in item:
            entry["size"] = item["size"]
        if "modified_at" in item:
            entry["modified_at"] = item["modified_at"]
        models.append(entry)

    models.sort(key=lambda m: m["name"].lower())

    suggested = DEFAULT_MODEL
    if models and not any(m["name"] == suggested for m in models):
        suggested = models[0]["name"]

    return {
        "models": models,
        "default_model": suggested,
        "ollama_base": OLLAMA_BASE,
    }


@app.post("/api/chat")
async def chat(req: ChatRequest):
    if not req.messages:
        raise HTTPException(status_code=400, detail="messages required")

    model = req.model or DEFAULT_MODEL
    payload = {
        "model": model,
        "messages": [m.model_dump() for m in req.messages],
        "stream": True,
    }

    async def ollama_bytes():
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=10.0)) as client:
                async with client.stream(
                    "POST",
                    f"{OLLAMA_BASE}/api/chat",
                    json=payload,
                ) as resp:
                    if resp.status_code >= 400:
                        body = await resp.aread()
                        detail = body.decode(errors="replace")[:2000]
                        yield f"[error] Ollama HTTP {resp.status_code}: {detail}".encode()
                        return
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            data = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if err := data.get("error"):
                            yield f"[error] {err}".encode()
                            return
                        msg = data.get("message") or {}
                        piece = msg.get("content") or ""
                        if piece:
                            yield piece.encode("utf-8")
        except httpx.ConnectError as e:
            yield f"[error] Cannot reach Ollama at {OLLAMA_BASE}: {e}".encode()
        except httpx.HTTPError as e:
            yield f"[error] {e}".encode()

    return StreamingResponse(
        ollama_bytes(),
        media_type="text/plain; charset=utf-8",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")
