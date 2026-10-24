/**
 * 题目图片点击放大。
 * 打开后默认按窗口等比例缩放，保证整张图完整可见；
 * 点击图片或用底部按钮继续放大，超出窗口的部分可以拖动 / 滚动查看，随时一键回到“适应窗口”。
 * 图片一律禁止浏览器原生拖拽：否则在放大图上拖动查看时，浏览器会把图片拖出去并跳转到图片地址，
 * 表现就是“看着看着跳回选题页、答题被中断”。
 */
const IMAGE_SELECTOR = ".q-image img, .formula-image";
const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];
const DRAG_THRESHOLD = 4;

export function initImageLightbox() {
  const view = document.getElementById("imageLightbox");
  const stage = document.getElementById("lightboxStage");
  const image = document.getElementById("lightboxImage");
  const caption = document.getElementById("lightboxCaption");
  const closeButton = document.getElementById("lightboxClose");
  const zoomOut = document.getElementById("lightboxZoomOut");
  const zoomIn = document.getElementById("lightboxZoomIn");
  const zoomLabel = document.getElementById("lightboxZoom");
  const fitButton = document.getElementById("lightboxFit");
  if (!view || !stage || !image || !caption || !closeButton) return { close: () => {} };

  let level = 0; // ZOOM_LEVELS 的下标，0 = 适应窗口
  let fitWidth = 0; // 适应窗口时图片的显示宽度，放大倍数都以它为基准
  let drag = null;
  let bodyOverflow = "";

  /** 量出“适应窗口”时的显示宽度：先还原成自适应状态再读一次布局 */
  function measureFit() {
    const inlineWidth = image.style.width;
    image.classList.remove("zoomed");
    image.style.width = "";
    fitWidth = image.clientWidth || image.naturalWidth || 0;
    image.style.width = inlineWidth;
  }

  function centerScroll() {
    stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2;
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2;
  }

  function applyZoom() {
    const scale = ZOOM_LEVELS[level];
    if (scale <= 1) {
      image.classList.remove("zoomed");
      image.style.width = "";
      image.style.height = "";
    } else {
      image.classList.add("zoomed");
      image.style.height = "auto";
      image.style.width = `${Math.max(1, Math.round((fitWidth || image.naturalWidth || 0) * scale))}px`;
      centerScroll();
    }
    if (zoomLabel) zoomLabel.textContent = scale <= 1 ? "适应窗口" : `${Math.round(scale * 100)}%`;
    if (zoomOut) zoomOut.disabled = level === 0;
    if (zoomIn) zoomIn.disabled = level === ZOOM_LEVELS.length - 1;
    if (fitButton) fitButton.disabled = level === 0;
    caption.textContent = scale <= 1
      ? `${image.alt || "题目图片"} · 点击图片或按「放大」看细节`
      : `${image.alt || "题目图片"} · 可拖动查看，点「适应窗口」看整张图`;
  }

  function stepZoom(delta) {
    const next = Math.min(Math.max(level + delta, 0), ZOOM_LEVELS.length - 1);
    if (next === level) return;
    level = next;
    applyZoom();
  }

  function toggleZoom() {
    level = level >= ZOOM_LEVELS.length - 1 ? 0 : level + 1;
    applyZoom();
  }

  function close() {
    view.hidden = true;
    image.classList.remove("zoomed", "dragging");
    image.style.width = "";
    image.style.height = "";
    image.removeAttribute("src");
    level = 0;
    fitWidth = 0;
    drag = null;
    document.body.style.overflow = bodyOverflow;
  }

  function open(target) {
    const src = target.currentSrc || target.getAttribute("src");
    if (!src) return;
    level = 0;
    drag = null;
    image.classList.remove("zoomed", "dragging");
    image.style.width = "";
    image.style.height = "";
    image.alt = target.alt || "";
    image.onload = () => {
      measureFit();
      applyZoom();
    };
    image.onerror = () => {
      caption.textContent = "图片加载失败，请检查题库图片是否完整";
    };
    bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // 放大时锁住背景滚动，避免误滚到别的题目
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
    view.hidden = false;
    caption.textContent = `${image.alt || "题目图片"} · 点击图片或按「放大」看细节`;
    // src 最后赋值：元素可见后再加载，onload 里才量得到“适应窗口”的真实显示宽度
    image.src = src;
  }

  // 用事件委托，题目重新渲染后依然生效
  document.addEventListener(
    "click",
    (event) => {
      if (!view.hidden) return;
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      const match = target.closest(IMAGE_SELECTOR);
      if (!match) return;
      // 选项里的图片在 <label> 内，阻止默认的选中行为，避免“想放大却选了答案”
      event.preventDefault();
      event.stopPropagation();
      open(match);
    },
    true,
  );

  image.addEventListener("click", () => {
    if (drag?.moved) return; // 拖动查看时不要误触发缩放
    toggleZoom();
  });

  // 放大后按住图片拖动查看（触屏交给浏览器原生滚动，效果一致）
  image.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || ZOOM_LEVELS[level] <= 1) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
    image.setPointerCapture?.(event.pointerId);
  });
  image.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
    if (!drag.moved) return;
    image.classList.add("dragging");
    stage.scrollLeft = drag.left - dx;
    stage.scrollTop = drag.top - dy;
  });
  const endDrag = () => {
    if (drag) image.releasePointerCapture?.(drag.id);
    image.classList.remove("dragging");
    // 让 click 事件先读到 moved，再清空
    setTimeout(() => {
      drag = null;
    }, 0);
  };
  image.addEventListener("pointerup", endDrag);
  image.addEventListener("pointercancel", endDrag);

  // 彻底掐掉原生拖放，防止把图片拖出页面导致跳转
  ["dragstart", "dragover", "drop"].forEach((type) => {
    view.addEventListener(type, (event) => event.preventDefault());
  });
  image.draggable = false;

  closeButton.addEventListener("click", close);
  zoomOut?.addEventListener("click", () => stepZoom(-1));
  zoomIn?.addEventListener("click", () => stepZoom(1));
  fitButton?.addEventListener("click", () => {
    level = 0;
    applyZoom();
  });
  // 点击图片以外的空白处关闭
  view.addEventListener("click", (event) => {
    if (event.target === image) return;
    close();
  });
  document.addEventListener("keydown", (event) => {
    if (view.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  window.addEventListener("resize", () => {
    if (view.hidden || !image.naturalWidth) return;
    level = 0;
    measureFit();
    applyZoom();
  });

  return { close };
}
