# Agnes Image Studio

一个基于 Agnes AI 图片生成接口的本地页面，支持：

- 文生图：直接使用提示词调用 `agnes-image-2.1-flash`
- 图生图：传入参考图片 URL，并使用 `tags: ["img2img"]` 与 `extra_body.image`
- 尺寸和 Seed 参数
- 服务端环境变量保存 API Key，避免把真实 Key 写进前端代码

## 安装

```bash
npm install
```

## 配置 API Key

复制示例环境变量文件：

```bash
cp .env.example .env
```

然后在 `.env` 或启动命令中设置：

```bash
AGNES_API_KEY=你的_Agnes_API_Key
```

> 不要把真实 API Key 提交到 Git。`.env` 已经在 `.gitignore` 中忽略。

## 运行

```bash
AGNES_API_KEY=你的_Agnes_API_Key npm start
```

打开：<http://localhost:3000>

如果服务器没有设置 `AGNES_API_KEY`，也可以在页面表单中临时输入 Key；但生产环境更建议使用服务端环境变量。
