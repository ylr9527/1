const form = document.querySelector('#generationForm');
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const imageOptions = document.querySelector('#imageOptions');
const videoOptions = document.querySelector('#videoOptions');
const imageUrlSection = document.querySelector('#imageUrlSection');
const imageUrlHint = document.querySelector('#imageUrlHint');
const submitButton = document.querySelector('#submitButton');
const statusBox = document.querySelector('#status');
const gallery = document.querySelector('#gallery');
const rawJson = document.querySelector('#rawJson');
const copyJsonButton = document.querySelector('#copyJson');
const modelName = document.querySelector('#modelName');
const keyStatus = document.querySelector('#keyStatus');
let latestPayload = {};
let activePollController = null;

const videoModes = new Set(['text-to-video', 'image-to-video', 'multi-image-video']);
const modesRequiringImages = new Set(['image-to-image', 'image-to-video', 'multi-image-video']);

const setStatus = (message, state = 'idle') => {
  statusBox.textContent = message;
  statusBox.className = `status ${state}`;
};

const selectedMode = () => form.elements.mode.value;
const isVideoMode = () => videoModes.has(selectedMode());

const syncMode = () => {
  const mode = selectedMode();
  imageOptions.classList.toggle('hidden', videoModes.has(mode));
  videoOptions.classList.toggle('hidden', !videoModes.has(mode));
  imageUrlSection.classList.toggle('hidden', !modesRequiringImages.has(mode));

  const hints = {
    'image-to-image': 'Agnes 图片图生图参数使用 extra_body.image 传入图片 URL 数组。',
    'image-to-video': 'Agnes 视频图生视频使用 image 传入首张参考图片 URL。',
    'multi-image-video': 'Agnes 多图视频使用 extra_body.image 传入多张参考图片 URL，至少填写 2 个。',
  };
  imageUrlHint.textContent = hints[mode] || '';
};

const collectImageUrls = () => form.elements.imageUrls.value
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const updateRawJson = (payload) => {
  latestPayload = payload;
  rawJson.textContent = JSON.stringify(payload, null, 2);
  copyJsonButton.disabled = false;
};

const videoUrlFromResponse = (response) => response?.video_url
  || response?.remixed_from_video_id
  || response?.url
  || response?.data?.[0]?.url;

const renderVideo = (response) => {
  gallery.innerHTML = '';
  const videoUrl = videoUrlFromResponse(response);
  if (!videoUrl) return false;

  const card = document.createElement('article');
  card.className = 'video-card';

  const video = document.createElement('video');
  video.src = videoUrl;
  video.controls = true;
  video.playsInline = true;

  const link = document.createElement('a');
  link.href = videoUrl;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '打开视频';

  card.append(video, link);
  gallery.append(card);
  return true;
};

const renderImages = (response) => {
  gallery.innerHTML = '';
  const images = Array.isArray(response?.data) ? response.data : [];

  images.forEach((item, index) => {
    const imageUrl = item.url || item.b64_json;
    if (!imageUrl) return;

    const card = document.createElement('article');
    card.className = 'image-card';

    const img = document.createElement('img');
    img.alt = `Agnes 生成图片 ${index + 1}`;
    img.src = item.url ? imageUrl : `data:image/png;base64,${imageUrl}`;

    const link = document.createElement('a');
    link.href = img.src;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = item.url ? '打开图片' : '打开 Base64 图片';

    card.append(img, link);
    gallery.append(card);
  });

  if (!gallery.children.length) {
    setStatus('请求完成，但响应中没有找到 data[].url 或 data[].b64_json。', 'success');
  }
};

const loadConfig = async () => {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    modelName.textContent = `${config.imageModel} / ${config.videoModel}`;
    keyStatus.textContent = config.hasServerApiKey
      ? '服务器已配置 AGNES_API_KEY。'
      : '服务器未配置 Key，可在表单里临时输入。';
  } catch {
    keyStatus.textContent = '无法读取服务器配置。';
  }
};

const getTaskId = (result) => result?.response?.task_id
  || result?.response?.id
  || result?.response?.taskId;

const pollVideoResult = async (taskId, apiKey) => {
  activePollController = new AbortController();
  let lastPayload = latestPayload;

  for (;;) {
    await new Promise((resolve) => {
      setTimeout(resolve, 5000);
    });

    const params = new URLSearchParams({ taskId });
    if (apiKey) params.set('apiKey', apiKey);

    const response = await fetch(`/api/video-result?${params.toString()}`, {
      signal: activePollController.signal,
    });
    const result = await response.json();
    lastPayload = { ...lastPayload, latestPoll: result };
    updateRawJson(lastPayload);

    if (!response.ok) {
      throw new Error(result.error || '查询视频任务失败');
    }

    const videoResponse = result.response;
    const status = videoResponse?.status || 'unknown';
    const progress = videoResponse?.progress ?? 0;

    if (status === 'completed') {
      setStatus('视频生成成功！', 'success');
      if (!renderVideo(videoResponse)) {
        setStatus('视频生成完成，但响应中没有找到 video_url 或 remixed_from_video_id。', 'success');
      }
      return;
    }

    if (status === 'failed') {
      throw new Error(videoResponse?.error || '视频生成失败');
    }

    setStatus(`视频任务 ${status}，进度 ${progress}%。正在轮询结果…`, 'loading');
  }
};

modeInputs.forEach((input) => input.addEventListener('change', syncMode));
copyJsonButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(latestPayload, null, 2));
  copyJsonButton.textContent = '已复制';
  setTimeout(() => {
    copyJsonButton.textContent = '复制 JSON';
  }, 1400);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  activePollController?.abort();
  submitButton.disabled = true;
  copyJsonButton.disabled = true;
  gallery.innerHTML = '';
  rawJson.textContent = '{}';
  setStatus(isVideoMode() ? '正在创建 Agnes Video 2.0 视频任务，请稍候…' : '正在调用 Agnes Image 2.1 Flash，请稍候…', 'loading');

  const mode = selectedMode();
  const payload = {
    mode,
    apiKey: form.elements.apiKey.value.trim(),
    prompt: form.elements.prompt.value,
    imageUrls: collectImageUrls(),
  };

  let endpoint = '/api/generate-image';
  if (isVideoMode()) {
    endpoint = '/api/generate-video';
    payload.width = form.elements.width.value;
    payload.height = form.elements.height.value;
    payload.numFrames = form.elements.numFrames.value;
    payload.frameRate = form.elements.frameRate.value;
    payload.seed = form.elements.videoSeed.value;
  } else {
    payload.size = form.elements.size.value;
    payload.seed = form.elements.seed.value;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    updateRawJson(result);

    if (!response.ok) {
      throw new Error(result.error || '生成失败');
    }

    if (isVideoMode()) {
      const taskId = getTaskId(result);
      if (!taskId) {
        setStatus('视频任务已创建，但响应中没有找到 task_id。', 'success');
        return;
      }
      setStatus(`视频任务已创建（${taskId}），开始每 5 秒轮询结果…`, 'loading');
      await pollVideoResult(taskId, payload.apiKey);
      return;
    }

    setStatus('生成成功！', 'success');
    renderImages(result.response);
  } catch (error) {
    if (error.name !== 'AbortError') {
      setStatus(error.message, 'error');
    }
  } finally {
    submitButton.disabled = false;
  }
});

syncMode();
loadConfig();
