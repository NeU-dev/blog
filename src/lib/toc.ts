// 記事の目次。大見出し（h2）を拾って、広い画面では本文の右の余白に、狭い画面では本文の前に畳んで置く。

interface Heading {
  depth: number;
  slug: string;
  text: string;
}

const OWN_TOC_TITLE = '目次';

// 記事が自分で「目次」の見出しを書いているか。書いている記事には、畳んだ目次を重ねない。
export function hasOwnToc(headings: Heading[]) {
  return headings.some(heading => heading.depth === 2 && heading.text.trim() === OWN_TOC_TITLE);
}

// 目次に載せる見出し。3つに満たない記事には目次を出さない。
export function tocItems(headings: Heading[], body = '') {
  // 投票するまで続きを隠す記事は、目次で先を見せない
  if (/:::+poll\{[^}\n]*gate="true"/.test(body)) return [];
  const items = headings.filter(heading => heading.depth === 2 && heading.text.trim() !== OWN_TOC_TITLE);
  return items.length >= 3 ? items : [];
}

// 右の余白の目次で、いま読んでいる見出しに印を付け、青い線をその項目へ滑らせる。
export function initToc() {
  const list = document.querySelector<HTMLElement>('.toc-rail ol');
  if (!list) return;
  const links = [...list.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const headings = links.map(link => document.getElementById(link.getAttribute('href')!.slice(1)));
  let current: HTMLAnchorElement | undefined;

  const update = () => {
    // 画面の上から3割の線を越えた、いちばん後ろの見出しが「いま読んでいるところ」
    const line = innerHeight * .3;
    let next: HTMLAnchorElement | undefined;
    headings.forEach((heading, index) => {
      if (heading && heading.getBoundingClientRect().top <= line) next = links[index];
    });
    if (next !== current) {
      current?.removeAttribute('aria-current');
      next?.setAttribute('aria-current', 'location');
      current = next;
    }
    list.style.setProperty('--toc-y', `${current?.offsetTop ?? 0}px`);
    list.style.setProperty('--toc-h', `${current?.offsetHeight ?? 0}px`);
  };

  update();
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
}
