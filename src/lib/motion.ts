// サイト全体の動きのうち「いつ動かすか」を受け持つ。どう動くかは styles/motion.css にある。
// html.motion が付いていない（動きを減らす設定の）ときは何もしない。

// スクロールして画面に入ったら .is-in を付けるもの
const REVEAL_TARGETS = [
  '.section-head',
  '.post-entry',
  '.portfolio-item',
  '.playground__box',
  '.site-footer__inner',
  '.about-story',
  '.skill-list li',
  '.article-body > :is(h2, h3, h4, p, ul, ol, blockquote, pre, table, hr, .admonition, .katex-display, .article-poll, .mission-finder, .mermaid)',
  '.article-body img',
  '.article-body strong',
  '.reaction-panel',
  '.post-end',
].join(',');

const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

export function initMotion() {
  const root = document.documentElement;
  if (!root.classList.contains('motion')) return;
  root.dataset.motionReady = '1';
  initReveal();
  initHeaderTuck();
  initInkNav();
  if (finePointer()) {
    initMagnetic();
    initPaperLight();
  }
}

// 同時に画面へ入ったものは、上・左にあるものから順に少しずつ遅らせて出す
function initReveal() {
  const reveal = (elements: Element[]) => {
    const placed = elements.map(element => ({ element: element as HTMLElement, box: element.getBoundingClientRect() }));
    placed.sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
    placed.forEach(({ element }, index) => {
      element.style.setProperty('--rd', `${Math.min(index, 6) * 90}ms`);
      element.classList.add('is-in');
    });
  };
  const observer = new IntersectionObserver(entries => {
    // 一気に飛ばした（ページ内リンクや戻る）ときは、通り過ぎたものも出しておく
    const ready = entries.filter(entry => entry.isIntersecting || entry.boundingClientRect.top < 0).map(entry => entry.target);
    ready.forEach(element => observer.unobserve(element));
    if (ready.length) reveal(ready);
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll(REVEAL_TARGETS).forEach(element => observer.observe(element));
}

// 下へ読み進めるとヘッダーを引っ込め、上へ戻ると出す
function initHeaderTuck() {
  const header = document.querySelector<HTMLElement>('.site-header');
  if (!header) return;
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    if (Math.abs(y - lastY) < 6) return;
    header.classList.toggle('is-tucked', y > lastY && y > 160 && !header.matches(':focus-within'));
    lastY = y;
  }, { passive: true });
}

// メニューと絞り込みの下線を1本にして、カーソルのある項目へ滑らせる
function initInkNav() {
  document.querySelectorAll<HTMLElement>('.site-nav, .filters').forEach(nav => {
    const links = [...nav.querySelectorAll<HTMLElement>('a')];
    if (!links.length) return;
    const ink = document.createElement('span');
    ink.className = 'nav-ink';
    ink.setAttribute('aria-hidden', 'true');
    nav.append(ink);
    const active = nav.querySelector<HTMLElement>('a.is-active');
    const inset = nav.classList.contains('site-nav') ? 12 : 0;
    const moveTo = (link: HTMLElement | null) => {
      if (!link) { ink.style.opacity = '0'; return; }
      const width = link.offsetWidth - inset * 2;
      ink.style.width = `${width}px`;
      ink.style.transform = `translate(${link.offsetLeft + inset}px, ${link.offsetTop + link.offsetHeight - 3}px)`;
      ink.style.opacity = '1';
    };
    // 最初は今いるページの項目に、伸びながら現れる
    if (active) {
      ink.style.transition = 'none';
      ink.style.transform = `translate(${active.offsetLeft + active.offsetWidth / 2}px, ${active.offsetTop + active.offsetHeight - 3}px)`;
      void ink.offsetWidth;
      ink.style.transition = '';
      setTimeout(() => moveTo(active), 500);
    }
    links.forEach(link => {
      link.addEventListener('pointerenter', () => moveTo(link));
      link.addEventListener('focus', () => moveTo(link));
    });
    nav.addEventListener('pointerleave', () => moveTo(active));
    nav.addEventListener('focusout', () => moveTo(active));
    const settle = () => {
      ink.style.transition = 'none';
      moveTo(active);
      void ink.offsetWidth;
      ink.style.transition = '';
    };
    addEventListener('resize', settle);
    document.fonts?.ready.then(settle);
  });
}

// ボタンはカーソルのほうへ少し吸い寄せられる
function initMagnetic() {
  document.querySelectorAll<HTMLElement>('.btn, .icon-button').forEach(button => {
    button.addEventListener('pointermove', event => {
      const box = button.getBoundingClientRect();
      const x = (event.clientX - box.left - box.width / 2) / (box.width / 2);
      const y = (event.clientY - box.top - box.height / 2) / (box.height / 2);
      button.style.setProperty('--mx', `${x * 7}px`);
      button.style.setProperty('--my', `${y * 6}px`);
    });
    button.addEventListener('pointerleave', () => {
      button.style.removeProperty('--mx');
      button.style.removeProperty('--my');
    });
  });
}

// トップの方眼は、カーソルのまわりだけ青く浮かび上がる
function initPaperLight() {
  const hero = document.querySelector<HTMLElement>('.hero');
  if (!hero) return;
  hero.addEventListener('pointermove', event => {
    const box = hero.getBoundingClientRect();
    hero.style.setProperty('--px', `${event.clientX - box.left}px`);
    hero.style.setProperty('--py', `${event.clientY - box.top}px`);
    hero.classList.add('is-lit');
  });
  hero.addEventListener('pointerleave', () => hero.classList.remove('is-lit'));
}
