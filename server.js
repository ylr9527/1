import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const AGNES_IMAGE_API_URL = 'https://apihub.agnes-ai.com/v1/images/generations';
const AGNES_VIDEO_API_URL = 'https://apihub.agnes-ai.com/v1/videos';
const AGNES_IMAGE_MODEL = 'agnes-image-2.1-flash';
const AGNES_VIDEO_MODEL = 'agnes-video-v2.0';

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

const getApiKey = (body = {}) => process.env.AGNES_API_KEY || body.apiKey;

const parseOptionalNumber = (value, label, { integer = false, min, max } = {}) => {
  if (value === undefined || value === null || value === '') {
    return { value: undefined };
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed))) {
    return { error: `${label} 必须是${integer ? '整数' : '数字'}。` };
  }

  if (min !== undefined && parsed < min) {
    return { error: `${label} 不能小于 ${min}。` };
  }

  if (max !== undefined && parsed > max) {
    return { error: `${label} 不能大于 ${max}。` };
  }

  return { value: parsed };
};

const collectUrls = (imageUrls = []) => imageUrls
  .map((url) => String(url).trim())
  .filter(Boolean);

const proxyAgnesJson = async (response, agnesResponse, fallbackError) => {
  const text = await agnesResponse.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!agnesResponse.ok) {
    return sendJson(response, agnesResponse.status, {
      error: data?.error?.message || data?.message || fallbackError,
      details: data,
    });
  }

  return data;
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
  } = body;

  const key = getApiKey(body);

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

  const parsedSeed = parseOptionalNumber(seed, 'Seed', { integer: true });
  if (parsedSeed.error) {
    return sendJson(response, 400, { error: parsedSeed.error });
  }
  if (parsedSeed.value !== undefined) {
    requestBody.seed = parsedSeed.value;
  }

  if (mode === 'image-to-image') {
    const urls = collectUrls(imageUrls);

    if (!urls.length) {
      return sendJson(response, 400, { error: '图生图模式至少需要 1 个参考图片 URL。' });
    }

    requestBody.tags = ['img2img'];
    requestBody.extra_body = {
      image: urls,
      response_format: 'url',
    };
  }

  const agnesResponse = await fetch(AGNES_IMAGE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = await proxyAgnesJson(response, agnesResponse, 'Agnes 图片 API 调用失败。');
  if (!agnesResponse.ok) return undefined;

  return sendJson(response, 200, {
    request: requestBody,
    response: data,
  });
};

const handleGenerateVideo = async (request, response) => {
  let body;
  try {
    body = await readJsonBody(request);
  } catch {
    return sendJson(response, 400, { error: '请求体必须是合法 JSON。' });
  }

  const {
    mode = 'text-to-video',
    prompt,
    width = 1152,
    height = 768,
    numFrames = 121,
    frameRate = 24,
    seed,
    imageUrls = [],
  } = body;

  const key = getApiKey(body);

  if (!key) {
    return sendJson(response, 400, { error: '请先配置 AGNES_API_KEY，或在页面中临时输入 API Key。' });
  }

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return sendJson(response, 400, { error: '请输入视频提示词。' });
  }

  const numberFields = [
    ['width', width, '视频宽度', { integer: true, min: 1 }],
    ['height', height, '视频高度', { integer: true, min: 1 }],
    ['num_frames', numFrames, '总帧数', { integer: true, min: 1, max: 441 }],
    ['frame_rate', frameRate, '帧率', { min: 1, max: 60 }],
  ];

  const requestBody = {
    model: AGNES_VIDEO_MODEL,
    prompt: prompt.trim(),
  };

  for (const [apiName, value, label, options] of numberFields) {
    const parsed = parseOptionalNumber(value, label, options);
    if (parsed.error) {
      return sendJson(response, 400, { error: parsed.error });
    }
    if (parsed.value !== undefined) {
      requestBody[apiName] = parsed.value;
    }
  }

  const parsedSeed = parseOptionalNumber(seed, 'Seed', { integer: true });
  if (parsedSeed.error) {
    return sendJson(response, 400, { error: parsedSeed.error });
  }
  if (parsedSeed.value !== undefined) {
    requestBody.seed = parsedSeed.value;
  }

  const urls = collectUrls(imageUrls);
  if (mode === 'image-to-video') {
    if (!urls.length) {
      return sendJson(response, 400, { error: '图生视频模式至少需要 1 个参考图片 URL。' });
    }
    requestBody.image = urls[0];
  } else if (mode === 'multi-image-video') {
    if (urls.length < 2) {
      return sendJson(response, 400, { error: '多图视频模式至少需要 2 个参考图片 URL。' });
    }
    requestBody.extra_body = { image: urls };
  }

  const agnesResponse = await fetch(AGNES_VIDEO_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const data = await proxyAgnesJson(response, agnesResponse, 'Agnes 视频 API 创建任务失败。');
  if (!agnesResponse.ok) return undefined;

  return sendJson(response, 200, {
    request: requestBody,
    response: data,
  });
};

const handleGetVideo = async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const taskId = requestUrl.searchParams.get('taskId');
  const apiKey = requestUrl.searchParams.get('apiKey');
  const key = process.env.AGNES_API_KEY || apiKey;

  if (!key) {
    return sendJson(response, 400, { error: '请先配置 AGNES_API_KEY，或在页面中临时输入 API Key。' });
  }

  if (!taskId) {
    return sendJson(response, 400, { error: '缺少 taskId。' });
  }

  const agnesResponse = await fetch(`${AGNES_VIDEO_API_URL}/${encodeURIComponent(taskId)}`, {
    headers: {
      Authorization: `Bearer ${key}`,
    },
  });

  const data = await proxyAgnesJson(response, agnesResponse, 'Agnes 视频 API 查询任务失败。');
  if (!agnesResponse.ok) return undefined;

  return sendJson(response, 200, {
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
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === 'GET' && requestUrl.pathname === '/api/config') {
      return sendJson(response, 200, {
        imageModel: AGNES_IMAGE_MODEL,
        videoModel: AGNES_VIDEO_MODEL,
        hasServerApiKey: Boolean(process.env.AGNES_API_KEY),
      });
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/generate-image') {
      return handleGenerateImage(request, response);
    }

    if (request.method === 'POST' && requestUrl.pathname === '/api/generate-video') {
      return handleGenerateVideo(request, response);
    }

    if (request.method === 'GET' && requestUrl.pathname === '/api/video-result') {
      return handleGetVideo(request, response);
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
  console.log(`Agnes Studio running at http://localhost:${PORT}`);
});
