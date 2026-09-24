import json
import mimetypes
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "4173"))
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"}
# "<name>_thumb.<ext>" is the cropped twin of "<name>.<ext>"; the page derives
# that path itself, so the manifest only carries the full-size originals.
THUMBNAIL_SUFFIX = "_thumb"


def read_images(folder):
    folder_path = ROOT / "images" / folder
    return sorted(
        f"images/{folder}/{file.relative_to(folder_path).as_posix()}"
        for file in folder_path.rglob("*")
        if file.is_file()
        and file.suffix.lower() in IMAGE_EXTENSIONS
        and not file.stem.lower().endswith(THUMBNAIL_SUFFIX)
    )


def current_galleries():
    return {
        "art": read_images("Art"),
        "design": read_images("Design"),
    }


def write_galleries_file(galleries):
    (ROOT / "galleries.json").write_text(
        json.dumps(galleries, indent=2) + "\n",
        encoding="utf-8",
    )


GALLERIES = current_galleries()
write_galleries_file(GALLERIES)


class ArchiveHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        if urlparse(self.path).path == "/api/galleries":
            galleries = current_galleries()
            write_galleries_file(galleries)
            payload = json.dumps(galleries).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        self.path = unquote(self.path)
        super().do_GET()


if __name__ == "__main__":
    server = ThreadingHTTPServer(("", PORT), ArchiveHandler)
    print(f"Gerhard Oosthuizen archive running at http://localhost:{PORT}")
    print(f"Art images: {len(GALLERIES['art'])} | Design images: {len(GALLERIES['design'])}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
