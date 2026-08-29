/**
 * 背景图裁剪对话框。
 *
 * 裁剪框的长宽比锁定为主窗口卡片的实际尺寸（380 × 当前高度），
 * 所以裁出来的图放进窗口是刚好铺满、不变形的。
 *
 * 交互：图片可拖动、可缩放（滑块 / 滚轮），裁剪框固定居中，
 * 画布实时重绘 —— 所见即所得。
 */

// 预览画布做成接近正方形：主窗口是竖长条，裁剪框才有足够高度好操作
const VIEW_W = 420;
const VIEW_H = 430;

export function openCropDialog({ dataUri, cardSize, onConfirm }) {
  return new Promise((resolve) => {
    const mask = document.createElement('div');
    mask.className = 'cropmask';
    mask.innerHTML = `
      <div class="crop">
        <div class="crop__head">
          <span class="crop__title">裁剪背景图</span>
          <span class="crop__hint"></span>
        </div>
        <div class="crop__stage">
          <canvas class="crop__canvas"></canvas>
        </div>
        <div class="crop__row">
          <span class="crop__label">缩放</span>
          <input class="crop__zoom" type="range" min="1" max="400" value="100" />
          <button class="btn crop__fit" type="button">铺满</button>
        </div>
        <div class="crop__actions">
          <button class="btn crop__cancel" type="button">取消</button>
          <button class="btn btn--primary crop__ok" type="button">应用为背景</button>
        </div>
      </div>
    `;

    const $canvas = mask.querySelector('.crop__canvas');
    const $zoom = mask.querySelector('.crop__zoom');
    const $hint = mask.querySelector('.crop__hint');
    const ctx = $canvas.getContext('2d');

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    $canvas.width = VIEW_W * dpr;
    $canvas.height = VIEW_H * dpr;
    $canvas.style.width = `${VIEW_W}px`;
    $canvas.style.height = `${VIEW_H}px`;

    const img = new Image();
    /** 裁剪框在预览画布中的矩形，长宽比 = 卡片长宽比 */
    let frame = { x: 0, y: 0, w: 0, h: 0 };
    /** 图片变换：以裁剪框中心为锚点 */
    let scale = 1;
    let minScale = 1;
    let offset = { x: 0, y: 0 };
    let dragging = null;

    function layoutFrame() {
      const ratio = cardSize.width / cardSize.height;
      // 裁剪框在 VIEW 内留 12px 边距，按卡片比例取最大内接矩形
      const maxW = VIEW_W - 24;
      const maxH = VIEW_H - 24;
      let w = maxH * ratio;
      let h = maxH;
      if (w > maxW) {
        w = maxW;
        h = maxW / ratio;
      }
      frame = { x: (VIEW_W - w) / 2, y: (VIEW_H - h) / 2, w, h };
    }

    /** 让图片至少铺满裁剪框的最小缩放 */
    function computeMinScale() {
      return Math.max(frame.w / img.naturalWidth, frame.h / img.naturalHeight);
    }

    function clampOffset() {
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;
      // 图片边缘不能露出裁剪框
      const maxX = Math.max(0, (w - frame.w) / 2);
      const maxY = Math.max(0, (h - frame.h) / 2);
      offset.x = Math.min(maxX, Math.max(-maxX, offset.x));
      offset.y = Math.min(maxY, Math.max(-maxY, offset.y));
    }

    function draw() {
      clampOffset();
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);

      const cx = frame.x + frame.w / 2 + offset.x;
      const cy = frame.y + frame.h / 2 + offset.y;
      const w = img.naturalWidth * scale;
      const h = img.naturalHeight * scale;

      // 框外的部分压暗，框内正常
      ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, VIEW_W, frame.y);
      ctx.fillRect(0, frame.y + frame.h, VIEW_W, VIEW_H - frame.y - frame.h);
      ctx.fillRect(0, frame.y, frame.x, frame.h);
      ctx.fillRect(frame.x + frame.w, frame.y, VIEW_W - frame.x - frame.w, frame.h);

      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(frame.x + 0.75, frame.y + 0.75, frame.w - 1.5, frame.h - 1.5);
      ctx.restore();
    }

    function setScale(next, anchor) {
      const prev = scale;
      scale = Math.max(minScale, Math.min(minScale * 8, next));
      if (anchor) {
        // 以鼠标位置为锚点缩放，手感更自然
        const k = scale / prev;
        offset.x = anchor.x - (anchor.x - offset.x) * k;
        offset.y = anchor.y - (anchor.y - offset.y) * k;
      }
      $zoom.value = String(Math.round((scale / minScale) * 100));
      draw();
    }

    /* ---------------- 交互 ---------------- */

    $canvas.addEventListener('pointerdown', (e) => {
      dragging = { x: e.clientX - offset.x, y: e.clientY - offset.y };
      $canvas.setPointerCapture(e.pointerId);
    });
    $canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      offset.x = e.clientX - dragging.x;
      offset.y = e.clientY - dragging.y;
      draw();
    });
    const endDrag = () => (dragging = null);
    $canvas.addEventListener('pointerup', endDrag);
    $canvas.addEventListener('pointercancel', endDrag);

    $canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = $canvas.getBoundingClientRect();
        const anchor = {
          x: e.clientX - rect.left - (frame.x + frame.w / 2),
          y: e.clientY - rect.top - (frame.y + frame.h / 2)
        };
        setScale(scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12), anchor);
      },
      { passive: false }
    );

    $zoom.addEventListener('input', () => {
      setScale(minScale * (Number($zoom.value) / 100));
    });

    mask.querySelector('.crop__fit').addEventListener('click', () => {
      offset = { x: 0, y: 0 };
      setScale(minScale);
    });

    function close(result) {
      mask.remove();
      resolve(result);
    }

    mask.querySelector('.crop__cancel').addEventListener('click', () => close(null));
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) close(null);
    });
    document.addEventListener('keydown', function esc(e) {
      if (e.key === 'Escape' && document.body.contains(mask)) {
        document.removeEventListener('keydown', esc);
        close(null);
      }
    });

    mask.querySelector('.crop__ok').addEventListener('click', async () => {
      // 按卡片实际像素（×2 保证高分屏清晰）导出裁剪结果
      const out = document.createElement('canvas');
      const outScale = 2;
      out.width = Math.round(cardSize.width * outScale);
      out.height = Math.round(cardSize.height * outScale);
      const octx = out.getContext('2d');

      // 预览里 1 单位 = 输出里 out.width / frame.w 个像素
      const k = out.width / frame.w;
      const cx = out.width / 2 + offset.x * k;
      const cy = out.height / 2 + offset.y * k;
      const w = img.naturalWidth * scale * k;
      const h = img.naturalHeight * scale * k;
      octx.drawImage(img, cx - w / 2, cy - h / 2, w, h);

      close(out.toDataURL('image/png'));
    });

    /* ---------------- 启动 ---------------- */

    img.onload = () => {
      layoutFrame();
      minScale = computeMinScale();
      scale = minScale;
      offset = { x: 0, y: 0 };
      $zoom.value = '100';
      $hint.textContent = `原图 ${img.naturalWidth}×${img.naturalHeight}，窗口 ${cardSize.width}×${cardSize.height}`;
      draw();
    };
    img.onerror = () => {
      $hint.textContent = '图片解码失败';
    };
    img.src = dataUri;

    document.body.appendChild(mask);
  }).then((dataUri) => {
    if (dataUri) return onConfirm(dataUri);
    return null;
  });
}
