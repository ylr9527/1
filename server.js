import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const AGNES_API_URL = 'https://apihub.agnes-ai.com/v1/images/generations';
const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const sendJson = (response, statusCode, body) => {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

const readJsonBody = async (request) => {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
};

const handleGenerateImage = async (request, response) => {
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return sendJson(response, 400, { error: '请求体必须是合法 JSON。' });
  }

  const {
    mode = 'text-to-image',
    prompt,
    size = '1024x1024',
    seed,
    imageUrls = [],
    apiKey,
  } = body;

  const key = process.env.AGNES_API_KEY || apiKey;

  if (!key) {
    return sendJson(response, 400, { error: '请先配置 AGNES_API_KEY，或在页面中临时输入 API Key。' });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return sendJson(response, 400, { error: '请输入图片提示词。' });
  }

  const requestBody = {
    model: AGNES_IMAGE_MODEL,
    prompt: prompt.trim(),
    size,
  };

  if (seed !== undefined && seed !== null && seed !== '') {
    const parsedSeed = Number(seed);
    if (!Number.isFinite(parsedSeed)) {
      return sendJson(response, 400, { error: 'Seed 必须是数字。' });
    }
    requestBody.seed = parsedSeed;
  }

  if (mode === 'image-to-image') {
    const urls = imageUrls
      .map((url) => String(url).trim())
      .filter(Boolean);

    if (!urls.length) {
      return sendJson(response, 400, { error: '图生图模式至少需要 1 个参考图片 URL。' });
    }

    requestBody.tags = ['img2img'];
    requestBody.extra_body = {
      image: urls,
      response_format: 'url',
    };
  }

  const agnesResponse = await fetch(AGNES_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const text = await agnesResponse.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!agnesResponse.ok) {
    return sendJson(response, agnesResponse.status, {
      error: data?.error?.message || data?.message || 'Agnes API 调用失败。',
      details: data,
    });
  }

  return sendJson(response, 200, {
    request: requestBody,
    response: data,
  });
};

const serveStatic = async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const pathname = decodedPath === '/' ? '/index.html' : decodedPath;
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    response.writeHead(403);
    return response.end('Forbidden');
  }

  try {
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    return response.end(content);
  } catch {
    const index = await readFile(path.join(PUBLIC_DIR, 'index.html'));
    response.writeHead(200, { 'Content-Type': mimeTypes['.html'] });
    return response.end(index);
  }
};

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/api/config') {
      return sendJson(response, 200, {
        model: AGNES_IMAGE_MODEL,
        hasServerApiKey: Boolean(process.env.AGNES_API_KEY),
      });
    }

    if (request.method === 'POST' && request.url === '/api/generate-image') {
      return handleGenerateImage(request, response);
    }

    if (request.method === 'GET') {
      return serveStatic(request, response);
    }

    return sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return sendJson(response, 500, { error: '服务器内部错误。' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Agnes Image Studio running at http://localhost:${PORT}`);
});
