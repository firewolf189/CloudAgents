# -*- coding: utf-8 -*-
"""Client for calling department backends."""
import httpx


async def health_check(backend_url: str, timeout: float = 5) -> bool:
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.get(f"{backend_url}/openapi.json")
            return resp.status_code == 200
    except Exception:
        return False


async def login(backend_url: str, username: str, password: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{backend_url}/auth/login",
                json={"username": username, "password": password},
            )
            if resp.status_code == 200:
                return resp.json().get("token")
            print(f"[dept_client] login failed: {resp.status_code} {resp.text}")
    except Exception as e:
        print(f"[dept_client] login error: {e}")
    return None


async def get_agents(backend_url: str, token: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{backend_url}/agent/",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
                return data.get("agents", [])
    except Exception:
        pass
    return []


async def get_users(backend_url: str, token: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{backend_url}/users/",
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                return resp.json()
    except Exception:
        pass
    return []


async def get_sessions(backend_url: str, token: str, agent_id: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{backend_url}/sessions/",
                headers={"Authorization": f"Bearer {token}"},
                params={"agent_id": agent_id},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else data.get("sessions", [])
    except Exception:
        pass
    return []


async def get_messages(backend_url: str, token: str, session_id: str, agent_id: str) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{backend_url}/sessions/{session_id}/messages",
                headers={"Authorization": f"Bearer {token}"},
                params={"agent_id": agent_id},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data if isinstance(data, list) else data.get("messages", [])
    except Exception:
        pass
    return []


async def create_session(backend_url: str, token: str, agent_id: str) -> dict | None:
    """Create a session with model config from existing sessions."""
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            model_config = {}
            resp = await client.get(
                f"{backend_url}/sessions/",
                headers=headers,
                params={"agent_id": agent_id},
            )
            if resp.status_code == 200:
                data = resp.json()
                sessions = data if isinstance(data, list) else data.get("sessions", [])
                for s in sessions:
                    cfg = s.get("config") or s.get("session", {}).get("config", {})
                    if cfg.get("chat_model_config"):
                        model_config["chat_model_config"] = cfg["chat_model_config"]
                        if cfg.get("fallback_chat_model_config"):
                            model_config["fallback_chat_model_config"] = cfg["fallback_chat_model_config"]
                        break

            resp = await client.post(
                f"{backend_url}/sessions/",
                headers=headers,
                json={"agent_id": agent_id, **model_config},
            )
            if resp.status_code in (200, 201):
                return resp.json()
    except Exception as e:
        print(f"[dept_client] create_session error: {e}")
    return None


async def send_message(backend_url: str, token: str, agent_id: str, session_id: str, text: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{backend_url}/chat/",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "input": {
                        "name": "管理平面",
                        "role": "user",
                        "content": [{"type": "text", "text": text}],
                    },
                },
            )
            return resp.status_code == 200
    except Exception:
        return False


async def poll_reply(backend_url: str, token: str, session_id: str, agent_id: str, max_wait: int = 120) -> str:
    """Poll messages until assistant reply appears."""
    import asyncio
    headers = {"Authorization": f"Bearer {token}"}
    for _ in range(max_wait // 2):
        await asyncio.sleep(2)
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    f"{backend_url}/sessions/{session_id}/messages",
                    headers=headers,
                    params={"agent_id": agent_id},
                )
                if resp.status_code != 200:
                    continue
                messages = resp.json()
                if isinstance(messages, dict):
                    messages = messages.get("messages", [])
                for msg in reversed(messages):
                    if msg.get("role") == "assistant":
                        content = msg.get("content", [])
                        texts = []
                        for block in content:
                            if isinstance(block, dict) and block.get("type") == "text":
                                texts.append(block.get("text", ""))
                        if texts:
                            return "\n".join(texts)
                        break
        except Exception:
            continue
    return "(超时：Agent 未在回复)"
