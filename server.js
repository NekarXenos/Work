const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 4173;
const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
// "<name>_thumb.<ext>" is the cropped twin of "<name>.<ext>"; the page derives
// that path itself, so the manifest only carries the full-size originals.
const thumbnailPattern = /_thumb$/i;

function readImages(folder) {
  const folderPath = path.join(root, "images", folder);
  const result = [];

  function visit(currentPath) {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (imageExtensions.has(extension) && !thumbnailPattern.test(path.basename(entry.name, extension))) {
        result.push(`images/${folder}/${path.relative(folderPath, entryPath).split(path.sep).join("/")}`);
      }
    }
  }

  visit(folderPath);
  return result.sort((first, second) => first.localeCompare(second));
}

function currentGalleries() {
  return {
    art: readImages("Art"),
    design: readImages("Design")
  };
}

function writeGalleriesFile(galleries) {
  fs.writeFileSync(
    path.join(root, "galleries.json"),
    `${JSON.stringify(galleries, null, 2)}\n`,
    "utf8"
  );
}

const galleries = currentGalleries();
writeGalleriesFile(galleries);

function contentType(filePath) {
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif"
  }[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/galleries") {
    const freshGalleries = currentGalleries();
    writeGalleriesFile(freshGalleries);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(freshGalleries));
    return;
  }

  const requestedPath = decodeURIComponent(requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname);
  const filePath = path.resolve(root, `.${requestedPath}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    response.end(file);
  });
});

server.listen(port, () => {
  console.log(`Gerhard Oosthuizen archive running at http://localhost:${port}`);
  console.log(`Art images: ${galleries.art.length} | Design images: ${galleries.design.length}`);
});
