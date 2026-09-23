const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const archiver = require('archiver');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_FILES = 20;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter(req, file, cb) {
    const ok =
      /^image\//.test(file.mimetype) ||
      (path.extname(file.originalname || '') && /\.(jpe?g|png|webp|gif|bmp|tiff?|avif)$/i.test(file.originalname));
    cb(ok ? null : new Error('仅支持图片文件（JPG / PNG / WebP 等）'), ok);
  },
});

const fileIndex = new Map();

function extFor(format) {
  return format === 'jpeg' ? 'jpg' : format;
}

function outputFormatFor(inputFormat) {
  if (['jpeg', 'png', 'webp'].includes(inputFormat)) return inputFormat;
  return 'webp';
}

function safeName(name) {
  const base = path.basename(name || 'image').replace(/[^\w.\-\u4e00-\u9fa5]+/g, '_');
  return base || 'image';
}

function pngOptions(quality) {
  if (quality >= 80) {
    return { compressionLevel: 9 };
  }
  if (quality >= 55) {
    return { palette: false, compressionLevel: 9 };
  }
  const colours = Math.max(8, Math.round((quality / 100) * 256));
  return { palette: true, colours, compressionLevel: 9 };
}

async function compressBuffer(buffer, format, quality) {
  const metadata = await sharp(buffer).metadata();
  const outFormat = outputFormatFor(metadata.format || format);

  const pipeline = sharp(buffer, { animated: metadata.pages > 1 })
    .rotate()
    .withMetadata(false);

  switch (outFormat) {
    case 'jpeg':
      pipeline.jpeg({ quality, mozjpeg: true });
      break;
    case 'webp':
      pipeline.webp({ quality, effort: 4, smartSubsample: true });
      break;
    case 'png':
      pipeline.png(pngOptions(quality));
      break;
    default:
      pipeline.webp({ quality, effort: 4 });
  }

  const outBuffer = await pipeline.toBuffer();

  const outMeta = await sharp(outBuffer).metadata();
  return {
    buffer: outBuffer,
    outputFormat: outFormat,
    width: outMeta.width,
    height: outMeta.height,
  };
}

app.post('/api/compress', upload.array('images', MAX_FILES), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '未接收到任何图片文件' });
    }

    const rawQuality = Number(req.body.quality);
    const quality = Number.isFinite(rawQuality)
      ? Math.min(100, Math.max(1, Math.round(rawQuality)))
      : 70;

    const results = [];

    for (const file of req.files) {
      const mimeFmt = (file.mimetype.split('/')[1] || '').toLowerCase();
      const extFmt = path.extname(file.originalname || '').replace('.', '').toLowerCase();
      const format = /^image\//.test(file.mimetype) && mimeFmt ? mimeFmt : extFmt || 'jpeg';
      const originalMeta = await sharp(file.buffer, { animated: true }).metadata();

      const { buffer: compressedBuffer, outputFormat, width, height } = await compressBuffer(
        file.buffer,
        format,
        quality
      );

      const originalSize = file.size;
      const keepOriginal = compressedBuffer.length >= originalSize;

      const storedFormat = keepOriginal
        ? (['jpeg', 'png', 'webp', 'gif'].includes(originalMeta.format) ? originalMeta.format : outputFormat)
        : outputFormat;

      const storedBuffer = keepOriginal ? file.buffer : compressedBuffer;
      const compressedSize = storedBuffer.length;

      const id = crypto.randomBytes(8).toString('hex');
      const storedName = `${id}.${extFor(storedFormat)}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, storedName), storedBuffer);

      const originalName = safeName(file.originalname);
      const parsed = path.parse(originalName);
      const compressedName = `${parsed.name}${parsed.name.endsWith('-compressed') ? '' : '-compressed'}.${extFor(storedFormat)}`;

      fileIndex.set(id, { originalName, compressedName, storedName, createdAt: Date.now() });

      const savedPercent =
        originalSize > 0 ? Math.round(((originalSize - compressedSize) / originalSize) * 100) : 0;

      results.push({
        id,
        originalName,
        compressedName,
        outputFormat: storedFormat,
        originalSize,
        compressedSize,
        keptOriginal: keepOriginal,
        savedPercent: keepOriginal ? 0 : Math.min(100, Math.max(-100, savedPercent)),
        originalWidth: originalMeta.width,
        originalHeight: originalMeta.height,
        width: keepOriginal ? originalMeta.width : width,
        height: keepOriginal ? originalMeta.height : height,
        downloadUrl: `/api/download/${id}`,
      });
    }

    res.json({ quality, results });
  } catch (err) {
    console.error('Compress error:', err);
    res.status(400).json({ error: err.message || '图片处理失败，请检查文件是否有效' });
  }
});

app.get('/api/download/:id', (req, res) => {
  const entry = fileIndex.get(req.params.id);
  if (!entry) return res.status(404).json({ error: '文件不存在或已过期' });

  const filePath = path.join(UPLOAD_DIR, entry.storedName);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '文件已被清理' });

  res.download(filePath, entry.compressedName);
});

app.post('/api/download-all', async (req, res) => {
  try {
    const names = (req.body.names || '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    if (names.length === 0) {
      return res.status(400).json({ error: '请选择要下载的文件' });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    res.attachment('compressed-images.zip');
    archive.pipe(res);

    for (const id of names) {
      const entry = fileIndex.get(id);
      if (!entry) continue;
      const filePath = path.join(UPLOAD_DIR, entry.storedName);
      if (fs.existsSync(filePath)) {
        archive.file(filePath, { name: entry.compressedName });
      }
    }

    archive.finalize();
  } catch (err) {
    console.error('download-all error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: '打包失败' });
    }
    res.end();
  }
});

setInterval(() => {
  const now = Date.now();
  const TTL = 2 * 60 * 60 * 1000;
  for (const [id, entry] of fileIndex) {
    if (now - entry.createdAt > TTL) {
      const filePath = path.join(UPLOAD_DIR, entry.storedName);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      fileIndex.delete(id);
    }
  }
}, 30 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`图片压缩工具已启动: http://localhost:${PORT}`);
});