// 青インクのカーソル。点はマウスにぴったり付き、輪はバネで遅れてついてくる。
// 速く動かすと輪が進む向きに伸びる。リンクでは輪が広がり、data-cursor のある場所では文字を出す。
// マウスのある端末で、動きを減らす設定がオフのときだけ使う。

export function initCursor() {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  if (!document.documentElement.classList.contains('motion')) return;

  const cursor = document.createElement('div');
  cursor.className = 'cursor is-hidden';
  cursor.setAttribute('aria-hidden', 'true');
  cursor.innerHTML = '<span class="cursor__ring"><b class="cursor__label"></b></span><span class="cursor__dot"></span>';
  document.body.append(cursor);
  document.documentElement.classList.add('has-cursor');
  const ring = cursor.querySelector<HTMLElement>('.cursor__ring')!;
  const dot = cursor.querySelector<HTMLElement>('.cursor__dot')!;
  const label = cursor.querySelector<HTMLElement>('.cursor__label')!;

  let x = -100, y = -100;
  let ringX = x, ringY = y, velX = 0, velY = 0;
  let frame = 0;

  const loop = () => {
    // バネ：行き過ぎてから落ち着く
    velX = (velX + (x - ringX) * .2) * .62;
    velY = (velY + (y - ringY) * .2) * .62;
    ringX += velX;
    ringY += velY;
    const speed = Math.min(Math.hypot(velX, velY), 60);
    const isText = cursor.classList.contains('is-text');
    // 文字を出しているときは読めるよう伸びを弱め、本文の縦棒は傾けない
    const stretch = isText ? 0 : speed / (cursor.classList.contains('is-label') ? 400 : 120);
    const angle = isText ? 0 : Math.atan2(velY, velX);
    dot.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0) translate(-50%, -50%) rotate(${angle}rad) scale(${1 + stretch}, ${1 - stretch * .6})`;
    label.style.transform = `rotate(${-angle}rad)`;
    const settled = Math.abs(x - ringX) + Math.abs(y - ringY) + Math.abs(velX) + Math.abs(velY) < .1;
    frame = settled ? 0 : requestAnimationFrame(loop);
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(loop); };

  const setMode = (target: Element | null) => {
    const labelled = target?.closest<HTMLElement>('[data-cursor]');
    const text = labelled?.dataset.cursor ?? '';
    cursor.classList.toggle('is-label', Boolean(text));
    if (text) label.textContent = text;
    cursor.classList.toggle('is-link', !text && Boolean(target?.closest('a, button, [role="button"], label, summary')));
    cursor.classList.toggle('is-text', !text && Boolean(target?.closest('.article-body :is(p, li, td, th, blockquote, h2, h3, h4)')) && !target?.closest('a, button'));
  };

  addEventListener('pointermove', event => {
    if (event.pointerType !== 'mouse') return;
    if (cursor.classList.contains('is-hidden')) {
      // 画面に入ってきたときは、輪を点の位置から始める
      ringX = event.clientX;
      ringY = event.clientY;
    }
    x = event.clientX;
    y = event.clientY;
    cursor.classList.remove('is-hidden');
    setMode(event.target as Element | null);
    wake();
  }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => cursor.classList.add('is-hidden'));
  addEventListener('blur', () => cursor.classList.add('is-hidden'));
  addEventListener('pointerdown', () => cursor.classList.add('is-down'));
  addEventListener('pointerup', () => cursor.classList.remove('is-down'));
  // スクロールでカーソルの下にあるものが変わったら、見た目も合わせる
  addEventListener('scroll', () => setMode(document.elementFromPoint(x, y)), { passive: true });
}
