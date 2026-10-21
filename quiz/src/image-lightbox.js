/**
 * 题目图片点击放大。
 * 题干图、选项公式图、解析图在页面上尺寸受限，点开后铺满窗口查看，
 * 再点一次切到 1:1 原始大小（超出窗口可拖动滚动）。
 */
const IMAGE_SELECTOR = ".q-image img, .formula-image";

export function initImageLightbox() {
  const view = document.getElementById("imageLightbox");
  const stage = document.getElementById("lightboxStage");
  const image = document.getElementById("lightboxImage");
  const caption = document.getElementById("lightboxCaption");
  const closeButton = document.getElementById("lightboxClose");
  if (!view || !stage || !image || !caption || !closeButton) return { close: () => {} };

  function close() {
    view.hidden = true;
    stage.classList.remove("scrolled");
    image.classList.remove("actual");
    image.removeAttribute("src");
  }

  function open(target) {
    const src = target.currentSrc || target.getAttribute("src");
    if (!src) return;
    image.src = src;
    image.alt = target.alt || "";
    image.classList.remove("actual");
    stage.classList.remove("scrolled");
    stage.scrollTop = 0;
    stage.scrollLeft = 0;
    caption.textContent = `${target.alt || "题目图片"} · 点击图片切换适应窗口 / 原始大小`;
    view.hidden = false;
  }

  function toggleZoom() {
    const actual = image.classList.toggle("actual");
    stage.classList.toggle("scrolled", actual);
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

  image.addEventListener("click", toggleZoom);
  closeButton.addEventListener("click", close);
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

  return { close };
}
