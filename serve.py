"""WSGI adapter for Devin Apps; GitHub Pages serves the same static assets."""
import mimetypes
import os
import re
from pathlib import Path

WEB = Path(__file__).resolve().parent / "web"
DATA = Path(os.environ.get("ATLAS_SNAPSHOT", WEB / "data" / "atlas.json.gz"))
ROUTES = {"/": WEB / "index.html", "/index.html": WEB / "index.html",
          "/style.css": WEB / "style.css", "/app.js": WEB / "app.js",
          "/indicators.mjs": WEB / "indicators.mjs",
          "/inter-latin.woff2": WEB / "inter-latin.woff2",
          "/OFL-Inter.txt": WEB / "OFL-Inter.txt",
          "/icon.svg": WEB / "icon.svg", "/data/atlas.json.gz": DATA}
HEADERS = [
    ("Cache-Control", "no-cache"), ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "strict-origin-when-cross-origin"),
    ("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'"),
]


def application(environ, start_response):
    method = environ["REQUEST_METHOD"]
    url = environ["PATH_INFO"]
    path = ROUTES.get(url)
    history = re.fullmatch(r"/data/(history-\d+-\d{8}T\d{4}\.bin\.gz)", url)
    if history:
        path = DATA.with_name(history[1])
    if method not in {"GET", "HEAD"}:
        start_response("405 Method Not Allowed", [*HEADERS, ("Allow", "GET, HEAD")])
        return [b""]
    if path is None:
        start_response("404 Not Found", [*HEADERS, ("Content-Type", "text/plain; charset=utf-8")])
        return [b"" if method == "HEAD" else b"Pagina non trovata"]
    try:
        file = path.open("rb")
    except FileNotFoundError:
        start_response("503 Service Unavailable", [*HEADERS, ("Content-Type", "text/plain; charset=utf-8")])
        return [b"" if method == "HEAD" else b"Dati non disponibili"]
    content_type = "application/gzip" if url.endswith(".gz") else mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    etag = '"' + hex(os.fstat(file.fileno()).st_mtime_ns)[2:] + '"'
    headers = [*HEADERS, ("Content-Type", content_type), ("ETag", etag)]
    if environ.get("HTTP_IF_NONE_MATCH") == etag:
        file.close()
        start_response("304 Not Modified", headers)
        return [b""]
    start_response("200 OK", [*headers, ("Content-Length", str(os.fstat(file.fileno()).st_size))])
    if method == "HEAD":
        file.close()
        return [b""]
    wrapper = environ.get("wsgi.file_wrapper")
    if wrapper:
        return wrapper(file, 64 * 1024)
    with file:
        return [file.read()]
