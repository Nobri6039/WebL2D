#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Tiny static server for WebL2D.

The site needs HTTP (ES modules + webcam + fetch of model assets), so
double-click start.cmd or run:  python server.py --open
"""
from __future__ import annotations

import argparse
import functools
import json
import mimetypes
import os
import socket
import sys
import threading
import urllib.parse
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from scan_models import build_manifest

ROOT = Path(__file__).resolve().parent

for suffix, mime in {
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".wasm": "application/wasm",
    ".task": "application/octet-stream",
    ".moc3": "application/octet-stream",
    ".json": "application/json",
    ".model3.json": "application/json",
    ".physics3.json": "application/json",
    ".cdi3.json": "application/json",
}.items():
    mimetypes.add_type(mime, suffix)


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".moc3": "application/octet-stream",
    }

    def end_headers(self) -> None:  # noqa: D401 - simple hook
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        super().end_headers()

    def do_GET(self) -> None:
        path = urllib.parse.urlsplit(self.path).path.rstrip("/")
        if path.endswith("/api/models"):
            prefix = path[: -len("/api/models")].strip("/")
            base = Path(self.directory) / prefix if prefix else Path(self.directory)
            try:
                models = build_manifest(base)
                body = json.dumps(models, ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            except Exception as err:  # pragma: no cover - diagnostic path
                body = json.dumps({"error": str(err)}, ensure_ascii=False).encode("utf-8")
                self.send_response(500)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[web] " + (fmt % args) + "\n")


def pick_port(preferred: int) -> int:
    for port in range(preferred, preferred + 30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise SystemExit("no free port found")


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the WebL2D site")
    parser.add_argument("--port", type=int, default=5180)
    parser.add_argument("--open", action="store_true", help="open the browser")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument(
        "--directory",
        default=str(ROOT),
        help="要托管的目录（默认本项目目录；调试 GitHub Pages 子路径时可指向父目录）",
    )
    args = parser.parse_args()

    serve_root = Path(args.directory).resolve()
    if not serve_root.is_dir():
        raise SystemExit(f"directory not found: {serve_root}")
    port = pick_port(args.port)
    url = f"http://{args.host}:{port}/"
    handler = functools.partial(Handler, directory=str(serve_root))
    httpd = ThreadingHTTPServer((args.host, port), handler)
    print("\n  WebL2D 已启动")
    print(f"  {url}\n")
    print("  按 Ctrl+C 停止服务\n")
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  已停止")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
