"""Verify project MCP discovery and browser launch without paid tool calls."""

import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import tomllib
import urllib.request
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
CONFIG = tomllib.loads((ROOT / ".codex/config.toml").read_text())
INIT = {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": {"name": "creator-tooling-check", "version": "1.0.0"},
}


def request(request_id, method, params=None):
    message = {"jsonrpc": "2.0", "method": method}
    if request_id is not None:
        message["id"] = request_id
    if params is not None:
        message["params"] = params
    return message


def result(message):
    if "error" in message:
        raise RuntimeError(message["error"])
    value = message["result"]
    if value.get("isError"):
        raise RuntimeError(value)
    return value


def playwright():
    config = CONFIG["mcp_servers"]["creator_playwright"]
    messages = queue.Queue()
    process = subprocess.Popen(
        [config["command"], *config["args"]],
        cwd=config["cwd"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL, text=True, encoding="utf-8",
        creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
    )

    def read():
        for line in process.stdout:
            try:
                messages.put(json.loads(line))
            except json.JSONDecodeError:
                continue
        messages.put({"closed": True})

    threading.Thread(target=read, daemon=True).start()

    def send(message):
        process.stdin.write(json.dumps(message) + "\n")
        process.stdin.flush()
        if "id" not in message:
            return None
        while True:
            response = messages.get(timeout=60)
            if response.get("closed"):
                raise RuntimeError("MCP process closed before responding")
            if response.get("id") == message["id"]:
                return result(response)

    try:
        initialized = send(request(1, "initialize", INIT))
        send(request(None, "notifications/initialized"))
        listing = send(request(2, "tools/list", {}))
        names = sorted(tool["name"] for tool in listing["tools"])
        assert {"browser_navigate", "browser_snapshot", "browser_close"} <= set(names)
        navigation = send(request(3, "tools/call", {
            "name": "browser_navigate", "arguments": {"url": "about:blank"},
        }))
        assert "about:blank" in json.dumps(navigation), navigation
        send(request(4, "tools/call", {"name": "browser_close", "arguments": {}}))
        return {
            "server": initialized["serverInfo"], "tools": names,
            "browser": "msedge, headless, isolated; about:blank navigated and closed",
            "status": "verified",
        }
    finally:
        process.stdin.close()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               capture_output=True, check=False)
            else:
                process.kill()
            process.wait(timeout=10)


def firecrawl():
    url = CONFIG["mcp_servers"]["creator_firecrawl"]["url"]
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}

    def send(message):
        req = urllib.request.Request(url, data=json.dumps(message).encode(), headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            session_id = response.headers.get("Mcp-Session-Id")
            if session_id:
                headers["Mcp-Session-Id"] = session_id
            if response.status == 202:
                return None
            if "text/event-stream" in response.headers.get("Content-Type", ""):
                for line in response:
                    if line.startswith(b"data:"):
                        return result(json.loads(line[5:]))
                raise RuntimeError("No MCP response in stream")
            return result(json.load(response))

    initialized = send(request(1, "initialize", INIT))
    headers["MCP-Protocol-Version"] = initialized["protocolVersion"]
    send(request(None, "notifications/initialized"))
    listing = send(request(2, "tools/list", {}))
    names = sorted(tool["name"] for tool in listing["tools"])
    assert {"firecrawl_scrape", "firecrawl_search"} <= set(names), names
    return {
        "url": url, "server": initialized["serverInfo"], "tools": names,
        "status": "handshake_and_discovery_verified", "authentication": "keyless",
        "data_tool_calls": 0, "paid_or_account_tools_verified": False,
    }


if __name__ == "__main__":
    evidence = {"observed_at": datetime.now(timezone.utc).isoformat(), "checks": {}}
    failed = False
    for name, check in [("playwright", playwright), ("firecrawl", firecrawl)]:
        try:
            evidence["checks"][name] = check()
        except Exception as error:
            failed = True
            evidence["checks"][name] = {"status": "failed", "error": str(error)}
        print(json.dumps({name: evidence["checks"][name]}, indent=2))
    output = ROOT / "tracking/evidence/development-tools/mcp-verification.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    raise SystemExit(1 if failed else 0)
