const form = document.querySelector('#imageForm');
const modeInputs = [...document.querySelectorAll('input[name="mode"]')];
const imageUrlSection = document.querySelector('#imageUrlSection');
const customSizeSection = document.querySelector('#customSizeSection');
const submitButton = document.querySelector('#submitButton');
const statusBox = document.querySelector('#status');
const gallery = document.querySelector('#gallery');
const rawJson = document.querySelector('#rawJson');
const copyJsonButton = document.querySelector('#copyJson');
const modelName = document.querySelector('#modelName');
const keyStatus = document.querySelector('#keyStatus');
let latestPayload = {};

const setStatus = (message, state = 'idle') => {
  statusBox.textContent = message;
  statusBox.className = `status ${state}`;
};

const selectedMode = () => form.elements.mode.value;

const isCustomSize = () => form.elements.size.value === 'custom';

const syncSizeControls = () => {
  const custom = isCustomSize();
  customSizeSection.classList.toggle('hidden', !custom);
  form.elements.customWidth.required = custom;
  form.elements.customHeight.required = custom;
};

const resolveSize = () => {
  if (!isCustomSize()) return form.elements.size.value;

  const width = form.elements.customWidth.value.trim();
  const height = form.elements.customHeight.value.trim();
  return `${width}x${height}`;
};

const syncMode = () => {
  imageUrlSection.classList.toggle('hidden', selectedMode() !== 'image-to-image');
};

const collectImageUrls = () => form.elements.imageUrls.value
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

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
    modelName.textContent = config.model;
    keyStatus.textContent = config.hasServerApiKey
      ? '服务器已配置 AGNES_API_KEY。'
      : '服务器未配置 Key，可在表单里临时输入。';
  } catch {
    keyStatus.textContent = '无法读取服务器配置。';
  }
};

modeInputs.forEach((input) => input.addEventListener('change', syncMode));
form.elements.size.addEventListener('change', syncSizeControls);
copyJsonButton.addEventListener('click', async () => {
  await navigator.clipboard.writeText(JSON.stringify(latestPayload, null, 2));
  copyJsonButton.textContent = '已复制';
  setTimeout(() => {
    copyJsonButton.textContent = '复制 JSON';
  }, 1400);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  submitButton.disabled = true;
  copyJsonButton.disabled = true;
  gallery.innerHTML = '';
  rawJson.textContent = '{}';
  setStatus('正在调用 Agnes Image 2.1 Flash，请稍候…', 'loading');

  const payload = {
    mode: selectedMode(),
    apiKey: form.elements.apiKey.value.trim(),
    prompt: form.elements.prompt.value,
    size: resolveSize(),
    seed: form.elements.seed.value,
    imageUrls: collectImageUrls(),
  };

  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    latestPayload = result;
    rawJson.textContent = JSON.stringify(result, null, 2);
    copyJsonButton.disabled = false;

    if (!response.ok) {
      throw new Error(result.error || '生成失败');
    }

    setStatus('生成成功！', 'success');
    renderImages(result.response);
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
});

syncMode();
syncSizeControls();
loadConfig();
