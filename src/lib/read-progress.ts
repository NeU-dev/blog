// 記事ページ上端の細い線で、どこまで読んだかを示す。
export function initReadProgress() {
  const bar = document.querySelector<HTMLElement>('.read-progress');
  const article = document.querySelector<HTMLElement>('.article-body');
  if (!bar || !article) return;
  const update = () => {
    const box = article.getBoundingClientRect();
    const total = box.height - innerHeight * .6;
    const progress = Math.min(1, Math.max(0, -box.top / Math.max(total, 1)));
    bar.style.setProperty('--p', progress.toFixed(4));
  };
  update();
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
}
