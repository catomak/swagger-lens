// Local-only API used to verify Swagger UI's Try it out without external calls.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(process.argv[2]), port = Number(process.argv[3] || 8788);
http.createServer(async (request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  if (request.url === '/health') {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({ status: 'ok', source: 'local-preview-test' }));
    console.log('TRY_IT_OUT_LOCAL_REQUEST_PASSED');
    return;
  }
  try {
    const relative = decodeURIComponent(new URL(request.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(root, relative);
    if (path.relative(root, file).startsWith('..')) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/json');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404).end(); }
}).listen(port, '127.0.0.1', () => console.log(`Preview test server: http://127.0.0.1:${port}`));
