/**
 * 离线地图路径规划工具 - 启动脚本
 * 启动本地 HTTP 服务器并在浏览器中打开
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 18420;
const ROOT_DIR = path.join(__dirname);

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.pbf': 'application/x-protobuf',
  '.mvt': 'application/vnd.mapbox-vector-tile',
  '.wasm': 'application/wasm'
};

const server = http.createServer((req, res) => {
  let filePath = path.join(ROOT_DIR, req.url.split('?')[0]);

  // Default to index.html
  if (filePath.endsWith('/') || filePath === ROOT_DIR) {
    filePath = path.join(ROOT_DIR, 'src', 'renderer', 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not Found: ' + req.url);
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType + '; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/src/renderer/index.html`;
  console.log('='.repeat(50));
  console.log('  🗺️  离线地图路径规划工具 v1.0');
  console.log('='.repeat(50));
  console.log(`  服务地址: ${url}`);
  console.log('  按 Ctrl+C 停止服务');
  console.log('='.repeat(50));

  // Open in default browser
  const cmd = process.platform === 'win32' ? `start ${url}`
    : process.platform === 'darwin' ? `open ${url}`
    : `xdg-open ${url}`;

  exec(cmd, (err) => {
    if (err) console.log('请手动在浏览器中打开:', url);
  });
});
