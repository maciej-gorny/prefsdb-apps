// Minimal HTTPS static server for local testing: node serve.js [port]
// Uses the self-signed certificate in .cert/ (see README).

const https = require("https");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.argv[2]) || 8443;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const options = {
  key: fs.readFileSync(path.join(root, ".cert", "key.pem")),
  cert: fs.readFileSync(path.join(root, ".cert", "cert.pem")),
};

https.createServer(options, (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, "https://localhost").pathname);
  let file = path.normalize(path.join(root, urlPath === "/" ? "index.html" : urlPath));
  if (!file.startsWith(root) || file.includes(`${path.sep}.cert`)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, () => console.log(`Serving ${root} at https://localhost:${port}/`));
