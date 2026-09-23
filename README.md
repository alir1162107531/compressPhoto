# 图片压缩工具 (Image Compressor)

一个基于 Node.js + Express + Sharp 的在线批量图片压缩工具。图片在本地服务端处理，不会上传到任何第三方服务器。

## 功能特性

- 支持常见图片格式：JPG / JPEG、PNG、WebP、GIF、BMP、TIFF、AVIF 等
- 可选压缩质量：低（极限压缩）/ 中（推荐）/ 高（高清），或通过滑动条自定义 1%–100%
- 压缩前后对比：原始图 / 压缩后预览、尺寸、文件大小、节省百分比
- 一键下载单张压缩图，支持批量打包下载（ZIP）
- 文件在服务端内存中处理，输出文件 2 小时后自动清理
- 现代简约绿色主题，响应式布局，兼容手机与桌面端
- 拖放上传，清晰的操作提示与交互反馈

## 技术栈

| 模块     | 说明                                  |
| -------- | ------------------------------------- |
| Express  | Web 服务与静态资源                    |
| Multer   | 文件上传解析（50MB/张，最多 20 张）   |
| Sharp    | 高性能图片压缩 / 格式转换             |
| Archiver | 批量下载时打包 ZIP                    |
| 原生前端   | HTML5 + CSS3 + JavaScript（无框架） |

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 启动服务
npm start

# 3. 浏览器访问
http://localhost:3000
```

开发模式（文件变更自动重启）：

```bash
npm run dev
```

## 项目结构

```
ocdemo/
├── package.json
├── server.js              # Express 后端：压缩 / 下载 / 打包接口
├── public/                # 前端静态资源
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
└── uploads/               # 压缩输出文件（自动创建，定期清理）
```

## API 接口

| 方法 | 路径                          | 说明                           |
| ---- | ----------------------------- | ------------------------------ |
| POST | `/api/compress`               | 上传图片并压缩，返回对比信息   |
| GET  | `/api/download/:id`           | 下载单张压缩图片               |
| POST | `/api/download-all`           | 按 id 列表打包下载为 ZIP       |
| GET  | `/`                           | 前端页面                       |

### 请求示例

```bash
# 压缩，quality 范围 1-100
curl -X POST http://localhost:3000/api/compress \
  -F "quality=70" \
  -F "images=@photo.jpg"

# 批量打包下载
curl -X POST http://localhost:3000/api/download-all \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "names=<id1>,<id2>"
```

## 注意事项

- 单张图片上限 50MB，单次最多上传 20 张
- PNG 采用有损调色板压缩策略，质量低于 55% 时使用索引色以减少体积
- 已高度优化的图片（如 WebP）压缩后体积可能不减反增，页面会给出明确提示