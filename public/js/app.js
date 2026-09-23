(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const dropZone = $('#dropZone');
  const fileInput = $('#fileInput');
  const fileList = $('#fileList');
  const fileBar = $('#fileBar');
  const clearBtn = $('#clearFiles');
  const compressBtn = $('#compressBtn');
  const downloadAllBtn = $('#downloadAllBtn');
  const qualityRange = $('#qualityRange');
  const qualityValue = $('#qualityValue');
  const qualityPresets = $('#qualityPresets');
  const results = $('#results');
  const busy = $('#busy');
  const toast = $('#toast');

  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  const acceptedExt = /\.(jpe?g|png|webp|gif|bmp|tiff?|avif)$/i;

  let selectedFiles = [];
  let quality = 70;
  let lastResults = [];

  /* ---------------- Quality ---------------- */

  function setQuality(val) {
    quality = Math.min(100, Math.max(1, Math.round(val)));
    qualityValue.textContent = quality + '%';
    qualityRange.value = quality;
    qualityPresets.querySelectorAll('.q-btn').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.dataset.quality) === quality);
    });
  }

  qualityRange.addEventListener('input', () => {
    qualityPresets.querySelectorAll('.q-btn').forEach((b) => b.classList.remove('is-active'));
    qualityValue.textContent = qualityRange.value + '%';
    quality = Number(qualityRange.value);
  });

  qualityPresets.addEventListener('click', (e) => {
    const btn = e.target.closest('.q-btn');
    if (!btn) return;
    setQuality(Number(btn.dataset.quality));
  });

  setQuality(70);

  /* ---------------- File selection ---------------- */

  function humanSize(bytes) {
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return bytes + ' B';
  }

  function renderFileBar() {
    fileBar.hidden = selectedFiles.length === 0;
    compressBtn.disabled = selectedFiles.length === 0;

    fileList.innerHTML = '';
    selectedFiles.forEach((file, idx) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const span = document.createElement('span');
      span.textContent = file.name + ' · ';
      const b = document.createElement('b');
      b.textContent = humanSize(file.size);
      span.appendChild(b);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', '移除 ' + file.name);
      rm.addEventListener('click', () => {
        selectedFiles.splice(idx, 1);
        renderFileBar();
      });
      chip.appendChild(span);
      chip.appendChild(rm);
      fileList.appendChild(chip);
    });
  }

  function addFiles(files) {
    const arr = Array.prototype.slice.call(files);
    let added = 0;

    for (const file of arr) {
      if (!file.type.startsWith('image/') && !acceptedExt.test(file.name)) {
        showToast('已跳过不支持的格式：' + file.name, true);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        showToast('文件过大（>50MB）：' + file.name, true);
        continue;
      }
      if (selectedFiles.some((f) => f.name === file.name && f.size === file.size)) continue;
      if (selectedFiles.length >= 20) {
        showToast('最多支持 20 张图片', true);
        break;
      }
      selectedFiles.push(file);
      added++;
    }

    if (added > 0) {
      showToast('已添加 ' + added + ' 张图片');
      renderFileBar();
      results.innerHTML = '';
      lastResults = [];
    }
  }

  clearBtn.addEventListener('click', () => {
    selectedFiles = [];
    lastResults = [];
    renderFileBar();
    results.innerHTML = '';
  });

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    addFiles(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    dropZone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    })
  );
  dropZone.addEventListener('drop', (e) => {
    addFiles(e.dataTransfer.files);
  });

  /* ---------------- Compression ---------------- */

  compressBtn.addEventListener('click', async () => {
    if (selectedFiles.length === 0) return;

    const fd = new FormData();
    fd.append('quality', quality);
    selectedFiles.forEach((f) => fd.append('images', f, f.name));

    busy.hidden = false;
    compressBtn.disabled = true;

    try {
      const res = await fetch('/api/compress', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || '压缩失败，请重试');

      lastResults = data.results;
      renderResults(lastResults);
      showToast('成功压缩 ' + lastResults.length + ' 张图片');
    } catch (err) {
      console.error(err);
      showToast(err.message, true);
    } finally {
      busy.hidden = true;
      compressBtn.disabled = selectedFiles.length === 0;
    }
  });

  function renderResults(items) {
    const totalOrig = items.reduce((s, r) => s + r.originalSize, 0);
    const totalComp = items.reduce((s, r) => s + r.compressedSize, 0);
    const totalSaved =
      totalOrig > 0 ? Math.round(((totalOrig - totalComp) / totalOrig) * 100) : 0;

    results.innerHTML = '';

    const title = document.createElement('div');
    title.className = 'section-title';
    title.innerHTML =
      '压缩结果' +
      '<small>共 ' + items.length + ' 张 · 原图 ' + humanSize(totalOrig) +
      ' → 压缩后 ' + humanSize(totalComp) +
      '（节省 ' + totalSaved + '%）</small>';
    results.appendChild(title);

    items.forEach((r) => {
      const card = document.createElement('article');
      card.className = 'result-card';

      const savedClass = r.savedPercent > 0 ? 'good' : r.keptOriginal ? 'neutral' : 'bad';
      const savedText = r.keptOriginal
        ? '已是最优，保留原图'
        : r.savedPercent > 0
          ? '体积减小 ' + r.savedPercent + '%'
          : '体积增大 ' + Math.abs(r.savedPercent) + '%';

      card.innerHTML =
        '<div class="result-head">' +
        '<div class="result-name">' + escapeHtml(r.originalName) + '</div>' +
        '<span class="saved-badge ' + savedClass + '">' + savedText + '</span>' +
        '</div>' +
        '<div class="compare">' +
        '<div class="compare-col">' +
        '<h4><span class="dot orig"></span>原图</h4>' +
        '<div class="pic orig-pic"></div>' +
        '<div class="meta"><b>' + r.originalWidth + '×' + r.originalHeight + '</b><span class="sep">·</span>' +
        humanSize(r.originalSize) + '</div>' +
        '</div>' +
        '<div class="compare-arrow" aria-hidden="true">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></svg>' +
        '</div>' +
        '<div class="compare-col">' +
        '<h4><span class="dot comp"></span>压缩后</h4>' +
        '<div class="pic comp-pic"></div>' +
        '<div class="meta"><b>' + r.width + '×' + r.height + '</b><span class="sep">·</span>' +
        humanSize(r.compressedSize) + '<span class="sep">·</span>' + r.outputFormat.toUpperCase() +
        (r.keptOriginal ? '<span class="sep">·</span>原图' : '') + '</div>' +
        '</div>' +
        '</div>' +
        '<div class="result-foot">' +
        '<button type="button" class="btn btn-sm btn-download" data-id="' + r.id + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></svg>' +
        (r.keptOriginal ? '下载原图' : '下载' + r.outputFormat.toUpperCase()) +
        '</button>' +
        '</div>';

      const origPic = card.querySelector('.orig-pic');
      const compPic = card.querySelector('.comp-pic');

      const origFile = selectedFiles.find((f) => f.name === r.originalName);
      if (origFile) {
        const img = document.createElement('img');
        img.alt = '原始图片预览';
        img.loading = 'lazy';
        img.src = URL.createObjectURL(origFile);
        origPic.appendChild(img);
      }

      const img2 = document.createElement('img');
      img2.alt = '压缩后预览';
      img2.loading = 'lazy';
      img2.src = r.downloadUrl;
      compPic.appendChild(img2);

      card.querySelector('.btn-download').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = r.downloadUrl;
        a.download = r.compressedName;
        document.body.appendChild(a);
        a.click();
        a.remove();
      });

      results.appendChild(card);
    });

    downloadAllBtn.disabled = items.length === 0;
  }

  downloadAllBtn.addEventListener('click', async () => {
    if (lastResults.length === 0) return;
    try {
      const fd = new URLSearchParams();
      fd.append('names', lastResults.map((r) => r.id).join(','));
      const res = await fetch('/api/download-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: fd.toString(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '打包下载失败');
      }
      showToast('正在下载压缩包…');
    } catch (err) {
      console.error(err);
      showToast(err.message, true);
    }
  });

  /* ---------------- Utils ---------------- */

  let toastTimer;

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle('error', !!isError);
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();