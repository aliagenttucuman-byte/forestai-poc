"""
ForestAI SPA Proxy — puerto 3011
Sirve el frontend estático y rutea /api/* → backend :8010
Soporta uploads grandes (sin límite de tamaño).
"""
import http.server
import urllib.request
import urllib.error
import os
import sys

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
BACKEND_URL  = "http://localhost:8010"
PORT         = 3011
MAX_BODY     = 500 * 1024 * 1024  # 500 MB


class ForestAIProxy(http.server.BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):
        print(f"[proxy] {self.address_string()} — {fmt % args}", flush=True)

    # ── API proxy ──────────────────────────────────────────────────────────
    def _proxy(self, method):
        target = f"{BACKEND_URL}{self.path}"
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length) if length else None

        # Copiar headers relevantes (sin Host)
        fwd_headers = {}
        for k, v in self.headers.items():
            if k.lower() not in ("host", "connection", "transfer-encoding"):
                fwd_headers[k] = v

        req = urllib.request.Request(target, data=body, headers=fwd_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=3600) as resp:
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() not in ("transfer-encoding", "connection"):
                        self.send_header(k, v)
                self.end_headers()
                self.wfile.write(resp.read())
        except urllib.error.HTTPError as e:
            self.send_response(e.code)
            self.end_headers()
            self.wfile.write(e.read())
        except Exception as ex:
            self.send_response(502)
            self.end_headers()
            self.wfile.write(str(ex).encode())

    # ── Static files ───────────────────────────────────────────────────────
    def _serve_static(self):
        path = self.path.split("?")[0]
        # SPA fallback: cualquier ruta que no sea un archivo conocido → index.html
        local = os.path.join(FRONTEND_DIR, path.lstrip("/"))
        if not os.path.isfile(local):
            local = os.path.join(FRONTEND_DIR, "index.html")

        ext = os.path.splitext(local)[1].lower()
        ctype = {
            ".html": "text/html", ".js": "application/javascript",
            ".css": "text/css",   ".png": "image/png",
            ".svg": "image/svg+xml", ".ico": "image/x-icon",
            ".json": "application/json", ".woff2": "font/woff2",
        }.get(ext, "application/octet-stream")

        try:
            with open(local, "rb") as f:
                data = f.read()
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except FileNotFoundError:
            self.send_response(404)
            self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self._proxy("GET")
        else:
            self._serve_static()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self._proxy("POST")
        else:
            self.send_response(405)
            self.end_headers()

    def do_PUT(self):
        if self.path.startswith("/api/"):
            self._proxy("PUT")
        else:
            self.send_response(405)
            self.end_headers()

    def do_DELETE(self):
        if self.path.startswith("/api/"):
            self._proxy("DELETE")
        else:
            self.send_response(405)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()


if __name__ == "__main__":
    if not os.path.isdir(FRONTEND_DIR):
        print(f"ERROR: frontend dist no encontrado en {FRONTEND_DIR}")
        print("Corré: cd frontend && npm run build")
        sys.exit(1)

    server = http.server.HTTPServer(("0.0.0.0", PORT), ForestAIProxy)
    print(f"ForestAI SPA Proxy escuchando en http://0.0.0.0:{PORT}", flush=True)
    print(f"  Frontend: {FRONTEND_DIR}", flush=True)
    print(f"  Backend:  {BACKEND_URL}", flush=True)
    server.serve_forever()
