import type { HeroBreakout } from './hero-breakout';

// トップの題名を書いているペン先。書き終えると弧を描いて跳び、ブロック崩しのパドルに着いて球になる。
// 「いつ・どこまで書けたか」は motion.css のアニメーションが決めていて、ここはその縁を追いかけるだけ。
// 動きを減らす設定や、スクリプトが遅れて題名がもう書き終わっているときは、ペン先を出さずにすぐゲームを始める。

const LEAP_MS = 720;
// 跳んだ跡の点を打つ間隔（px）
const DOT_GAP = 15;

type Point = { x: number; y: number };

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeInOut = (p: number) => p < .5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;

// 書いている縁が、行の幅のどこまで来たか（0〜1）。clip-path: inset(0 43% 0 0) の右の値から読む。
function written(line: HTMLElement) {
  const inset = getComputedStyle(line).clipPath.match(/inset\(([^)]*)\)/)?.[1].trim().split(/\s+/);
  const right = inset?.[1] ?? inset?.[0];
  return right?.endsWith('%') ? clamp01(1 - parseFloat(right) / 100) : 1;
}

/** 題名を書くペン先を出す。パドルに着いたら game.launch() を呼ぶ。 */
export function mountHeroPen(hero: HTMLElement, game: HeroBreakout) {
  const lines = [...hero.querySelectorAll<HTMLElement>('.ink-line')];
  const writes = lines.map(line => line.getAnimations().find(animation => (animation as CSSAnimation).animationName === 'ink-write'));
  const clock = writes.at(-1);
  const onScreen = hero.getBoundingClientRect().bottom > 120;
  if (!document.documentElement.classList.contains('motion') || !clock || writes.includes(undefined) || clock.playState === 'finished' || !onScreen) {
    game.launch();
    return;
  }
  // 各行を書き始める時刻と書き終える時刻（ms）。行は同時に動き始めるので、最後の行の時計を全体の時計にする。
  const spans = writes.map(write => {
    const timing = write!.effect!.getComputedTiming();
    return { start: Number(timing.delay), end: Number(timing.delay) + Number(timing.duration) };
  });
  const chars = lines.map(line => line.textContent?.length ?? 1);
  // ペン先が行のどこで書き終えるか（行の幅・高さに対する割合）。
  // 句読点で終わる行は、全角の左下に打たれるその点の上で止める。
  const ends = lines.map((line, index) => /[。、]$/.test(line.textContent ?? '') ? { x: 1 - .78 / chars[index], y: .75 } : { x: 1, y: .58 });

  const pen = document.createElement('span');
  pen.className = 'hero-pen';
  pen.setAttribute('aria-hidden', 'true');
  hero.append(pen);

  // 行のどこにペン先があるか。1文字ごとに小さく上下して、書いている手つきにする。
  const tip = (index: number, progress: number): Point => {
    const box = lines[index].getBoundingClientRect();
    const end = ends[index];
    const p = Math.min(progress, end.x);
    const scribble = Math.sin(p * chars[index] * Math.PI * 2) * Math.sin(p / end.x * Math.PI) * box.height * .13;
    // 最後の1文字で、書き終える高さへ寄っていく
    const settle = easeInOut(clamp01((p - end.x) * chars[index] + 1));
    return { x: box.left + box.width * p, y: box.top + box.height * (.58 + (end.y - .58) * settle) + scribble };
  };
  // 行の終わりから次の行の頭へ、小さく跳ねて移る
  const hop = (from: number, progress: number): Point => {
    const a = tip(from, 1);
    const b = tip(from + 1, 0);
    const p = easeInOut(clamp01(progress));
    return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p - Math.sin(p * Math.PI) * (b.y - a.y) * .3 };
  };

  let frame = 0;
  let leapAt = -1;
  let lastDot: Point | null = null;

  const place = (point: Point, size: number) => {
    const origin = hero.getBoundingClientRect();
    pen.style.width = pen.style.height = `${size}px`;
    pen.style.transform = `translate(${point.x - origin.left - size / 2}px, ${point.y - origin.top - size / 2}px)`;
    return origin;
  };
  const dot = (point: Point, origin: DOMRect) => {
    const mark = document.createElement('i');
    mark.className = 'hero-pen__dot';
    // 点は scale で現れて消えるので、場所は transform ではなく translate で置く（transform だと場所まで縮む）
    mark.style.translate = `${point.x - origin.left}px ${point.y - origin.top}px`;
    mark.addEventListener('animationend', () => mark.remove());
    hero.append(mark);
  };

  const tick = (time: number) => {
    // 途中で動きが止められたら（アニメーションが取り消されたら）、ペン先を片付けてゲームを始める
    if (leapAt < 0 && clock.playState === 'idle') {
      pen.remove();
      game.launch();
      return;
    }
    const target = game.landing();
    const size = Math.max(target.size, 7);

    if (leapAt < 0) {
      const now = Number(clock.currentTime) || 0;
      const index = spans.findIndex(span => now < span.end);
      if (clock.playState === 'finished' || index < 0) {
        leapAt = time;
      } else {
        const between = index > 0 && now < spans[index].start;
        place(between ? hop(index - 1, (now - spans[index - 1].end) / (spans[index].start - spans[index - 1].end)) : tip(index, written(lines[index])), size);
        frame = requestAnimationFrame(tick);
        return;
      }
    }

    // 最後の文字からパドルへ、放物線で跳ぶ
    const k = clamp01((time - leapAt) / LEAP_MS);
    const from = tip(lines.length - 1, 1);
    // いったん少し浮いてから落ちる高さにする
    const height = Math.max(56, Math.abs(target.y - from.y) * .5);
    const point = { x: from.x + (target.x - from.x) * k, y: from.y + (target.y - from.y) * k - height * 4 * k * (1 - k) };
    const origin = place(point, size);
    if (k < .94 && (!lastDot || Math.hypot(point.x - lastDot.x, point.y - lastDot.y) >= DOT_GAP)) {
      dot(point, origin);
      lastDot = point;
    }
    if (k < 1) {
      frame = requestAnimationFrame(tick);
      return;
    }
    game.launch();
    // 球が描かれるまでの1コマだけ、着いた場所に残しておく
    frame = requestAnimationFrame(() => pen.remove());
  };
  frame = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(frame);
    pen.remove();
  };
}
