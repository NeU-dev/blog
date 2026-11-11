import { createBreakoutAutoplay } from './breakout-autoplay';

// トップの方眼紙の上で、ブロック崩しが勝手に遊び続ける。
// カーソルを乗せるとパドルを動かせて、クリックすると本番のゲーム（GameLauncher）が開く。
// 盤面の計算は breakout-autoplay.js、ここは「青インクで描く」ことと演出だけを受け持つ。
// 開いた直後は球を出さずに待ち、題名を書き終えたペン先（lib/hero-pen.ts）がパドルに届いたら、それを球にして始める。

const W = 768;
const H = 440;
const ROW_ALPHA = [1, .68, .42];

type Palette = { ink: string; blue: string; muted: string; rule: string };
// breakout-autoplay.js は型を持たないので、ここで使う形だけを書いておく
type Brick = { x: number; y: number; width: number; height: number; row: number; alive: boolean };
type DemoState = {
  score: number; round: number; lives: number; phase: 'play' | 'serve' | 'clear';
  ball: { x: number; y: number; r: number };
  paddle: { x: number; y: number; width: number; height: number };
  bricks: Brick[];
  totals: { paddleHits: number };
};
type Burst = { x: number; y: number; w: number; h: number; row: number; t: number };
type Shard = { x: number; y: number; vx: number; vy: number; angle: number; spin: number; size: number; life: number; max: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
// 0→1 を、少し行き過ぎてから戻るバネの動きに変える
const springOut = (p: number) => p >= 1 ? 1 : 1 - Math.exp(-6.5 * p) * Math.cos(11 * p);
const easeOut = (p: number) => 1 - Math.pow(1 - clamp(p, 0, 1), 3);

function readPalette(el: HTMLElement): Palette {
  const style = getComputedStyle(el);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return { ink: read('--ink'), blue: read('--blue'), muted: read('--muted'), rule: read('--rule') };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

export type HeroBreakout = {
  /** 止める */
  stop: () => void;
  /** ペン先が届いた。パドルの上に球を置いて、ゲームを始める。 */
  launch: () => void;
  /** 球が置かれる場所（画面上の座標）と、球の直径 */
  landing: () => { x: number; y: number; size: number };
};

// ペン先がいつまでも来ないときに、待つのをやめるまでの秒数
const PEN_TIMEOUT = 6;

/** トップのブロック崩しを動かし始める。waitForPen のときは、launch が呼ばれるまで球を出さない。 */
export function mountHeroBreakout(root: HTMLElement, { waitForPen = false } = {}): HeroBreakout {
  const screen = root.querySelector<HTMLElement>('.hero-play__screen');
  const canvas = root.querySelector<HTMLCanvasElement>('canvas');
  const ctx = canvas?.getContext('2d');
  if (!screen || !canvas || !ctx) return { stop() {}, launch() {}, landing: () => ({ x: 0, y: 0, size: 0 }) };

  const demo = createBreakoutAutoplay();
  const state = demo.state as unknown as DemoState;
  const { field } = demo;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  let palette = readPalette(root);

  let clock = 0;
  let last = 0;
  let frame = 0;
  let visible = true;
  let gameOpen = document.body.dataset.neulogGameOpen === 'true';
  let holdUntil = 0;
  let shake = 0;
  let squash = 0;
  let scorePop = 0;
  let clearAt = -1;
  let waiting = waitForPen && !reducedMotion.matches;
  let landedAt = -1;
  let seenScore = 0;
  let seenPaddleHits = 0;
  let wasAlive = state.bricks.map(brick => brick.alive);
  let spawnAt = state.bricks.map(() => 0);
  const bursts: Burst[] = [];
  const shards: Shard[] = [];
  const trail: { x: number; y: number }[] = [];

  // ブロックが上から順に降ってくる。降り切るまで球は止めておく。
  const dropBricks = (delay: number) => {
    spawnAt = state.bricks.map((_, index) => clock + delay + (index % 8) * .045 + Math.floor(index / 8) * .12);
    holdUntil = Math.max(...spawnAt) + .55;
  };

  const breakBrick = (index: number) => {
    const brick = state.bricks[index];
    bursts.push({ x: brick.x, y: brick.y, w: brick.width, h: brick.height, row: brick.row, t: clock });
    for (let i = 0; i < 7; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 220;
      const max = .5 + Math.random() * .35;
      shards.push({
        x: brick.x + brick.width / 2, y: brick.y + brick.height / 2,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 120,
        angle: Math.random() * 6, spin: (Math.random() - .5) * 18,
        size: 5 + Math.random() * 7, life: max, max,
      });
    }
    shake = 1;
  };

  const launch = () => {
    if (!waiting) return;
    waiting = false;
    state.ball.x = state.paddle.x;
    state.ball.y = state.paddle.y - state.ball.r - 1;
    holdUntil = clock;
    landedAt = clock;
    squash = 1;
    trail.length = 0;
  };
  const landing = () => {
    const box = canvas.getBoundingClientRect();
    const scale = box.width / W;
    return { x: box.left + state.paddle.x * scale, y: box.top + (state.paddle.y - state.ball.r - 1) * scale, size: (state.ball.r + 1) * 2 * scale };
  };

  const step = (dt: number) => {
    clock += dt;
    if (waiting && clock > PEN_TIMEOUT) launch();
    if (!waiting && clock >= holdUntil) demo.advance(dt);

    state.bricks.forEach((brick, index) => {
      if (wasAlive[index] && !brick.alive) breakBrick(index);
    });
    const alive = state.bricks.map(brick => brick.alive);
    // 全部そろって復活した＝新しいラウンド
    if (alive.every(Boolean) && !wasAlive.every(Boolean)) dropBricks(.15);
    wasAlive = alive;

    if (state.score > seenScore) scorePop = 1;
    seenScore = state.score;
    if (state.totals.paddleHits !== seenPaddleHits) squash = 1;
    seenPaddleHits = state.totals.paddleHits;
    if (state.phase === 'clear' && clearAt < 0) clearAt = clock;
    if (state.phase !== 'clear') clearAt = -1;

    shake = Math.max(0, shake - dt * 6);
    squash = Math.max(0, squash - dt * 4);
    scorePop = Math.max(0, scorePop - dt * 5);
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.life -= dt;
      if (s.life <= 0) { shards.splice(i, 1); continue; }
      s.vy += 620 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.angle += s.spin * dt;
    }
    for (let i = bursts.length - 1; i >= 0; i--) if (clock - bursts[i].t > .45) bursts.splice(i, 1);

    trail.push({ x: state.ball.x, y: state.ball.y });
    if (trail.length > 14) trail.shift();
    if (waiting || state.phase !== 'play') trail.length = 0;
  };

  const draw = () => {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake) ctx.translate((Math.random() - .5) * 7 * shake, (Math.random() - .5) * 7 * shake);

    // 壁：上と左右だけ線を引く。下は開いている。
    ctx.strokeStyle = palette.ink;
    ctx.lineWidth = 2.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(field.left, field.bottom);
    ctx.lineTo(field.left, field.top + 12);
    ctx.quadraticCurveTo(field.left, field.top, field.left + 12, field.top);
    ctx.lineTo(field.right - 12, field.top);
    ctx.quadraticCurveTo(field.right, field.top, field.right, field.top + 12);
    ctx.lineTo(field.right, field.bottom);
    ctx.stroke();
    ctx.setLineDash([6, 8]);
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(field.left, field.bottom);
    ctx.lineTo(field.right, field.bottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // スコア
    ctx.fillStyle = palette.muted;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.font = '500 19px "IBM Plex Sans JP", sans-serif';
    ctx.fillText('スコア', field.left, 44);
    ctx.save();
    ctx.translate(field.left + 64, 44);
    ctx.scale(1 + scorePop * .35, 1 + scorePop * .35);
    ctx.fillStyle = scorePop > .05 ? palette.blue : palette.ink;
    ctx.font = '700 22px "IBM Plex Sans JP", sans-serif';
    ctx.fillText(String(state.score).padStart(5, '0'), 0, 0);
    ctx.restore();
    ctx.textAlign = 'right';
    ctx.fillStyle = palette.muted;
    ctx.font = '500 19px "IBM Plex Sans JP", sans-serif';
    ctx.fillText(`ラウンド ${state.round}`, field.right, 44);
    for (let life = 0; life < 3; life++) {
      ctx.globalAlpha = life < state.lives ? 1 : .2;
      ctx.fillStyle = palette.blue;
      ctx.beginPath();
      ctx.arc(W / 2 - 18 + life * 18, 38, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ブロック（降ってくる途中はバネで弾む）
    state.bricks.forEach((brick, index) => {
      if (!brick.alive) return;
      const p = clamp((clock - spawnAt[index]) / .75, 0, 1);
      if (p <= 0) return;
      const drop = (1 - springOut(p)) * 90;
      ctx.globalAlpha = ROW_ALPHA[brick.row] * clamp(p * 4, 0, 1);
      ctx.fillStyle = palette.blue;
      roundRect(ctx, brick.x + 2, brick.y + 2 - drop, brick.width - 4, brick.height - 4, 5);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // 壊れたブロック：ふくらんで消え、インクの輪が広がる
    for (const b of bursts) {
      const k = (clock - b.t) / .45;
      const grow = 1 + easeOut(k) * .45;
      ctx.globalAlpha = (1 - k) * ROW_ALPHA[b.row];
      ctx.fillStyle = palette.blue;
      roundRect(ctx, b.x + b.w / 2 - (b.w - 4) * grow / 2, b.y + b.h / 2 - (b.h - 4) * grow / 2, (b.w - 4) * grow, (b.h - 4) * grow, 5);
      ctx.fill();
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = palette.blue;
      ctx.lineWidth = 3 * (1 - k) + .5;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2, b.y + b.h / 2, 12 + easeOut(k) * 58, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const s of shards) {
      ctx.globalAlpha = clamp(s.life / s.max * 1.6, 0, 1);
      ctx.fillStyle = palette.blue;
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      ctx.fillRect(-s.size / 2, -s.size / 2, s.size, s.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    // 球の軌跡：先へ行くほど太くなる青い線
    for (let i = 1; i < trail.length; i++) {
      const t = i / trail.length;
      ctx.globalAlpha = t * .55;
      ctx.strokeStyle = palette.blue;
      ctx.lineWidth = state.ball.r * 2 * t;
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (!waiting && (state.phase === 'play' || state.phase === 'clear')) {
      ctx.fillStyle = palette.ink;
      ctx.beginPath();
      ctx.arc(state.ball.x, state.ball.y, state.ball.r + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // パドル：球を打ち返すと横につぶれる
    const pw = state.paddle.width * (1 + squash * .22);
    const ph = state.paddle.height * (1 - squash * .45);
    ctx.fillStyle = palette.ink;
    roundRect(ctx, state.paddle.x - pw / 2, state.paddle.y + (state.paddle.height - ph), pw, ph, 6);
    ctx.fill();
    // ペン先が着いたところから、インクの輪が広がる
    if (landedAt >= 0 && clock - landedAt < .6) {
      const k = (clock - landedAt) / .6;
      ctx.globalAlpha = 1 - k;
      ctx.strokeStyle = palette.blue;
      ctx.lineWidth = 3 * (1 - k) + .5;
      ctx.beginPath();
      ctx.arc(state.paddle.x, state.paddle.y, 10 + easeOut(k) * 64, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (clearAt >= 0) {
      const k = clamp((clock - clearAt) / .7, 0, 1);
      ctx.save();
      ctx.translate(W / 2, 250);
      const s = 1.6 - springOut(k) * .6;
      ctx.scale(s, s);
      ctx.globalAlpha = clamp(k * 3, 0, 1);
      ctx.fillStyle = palette.blue;
      ctx.textAlign = 'center';
      ctx.font = '600 64px "Klee One", serif';
      ctx.fillText('クリア！', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  };

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth || W;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssWidth * ratio * H / W);
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    draw();
  };

  const loop = (time: number) => {
    frame = 0;
    if (!visible || gameOpen || document.hidden || reducedMotion.matches) { last = 0; return; }
    const dt = last ? Math.min((time - last) / 1000, .05) : 0;
    last = time;
    step(dt);
    draw();
    frame = requestAnimationFrame(loop);
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(loop); };

  if (reducedMotion.matches) {
    // 動きを減らす設定では、少し崩れた盤面を1枚だけ描く
    for (let i = 0; i < 40; i++) demo.advance(.1);
    wasAlive = state.bricks.map(brick => brick.alive);
    trail.length = 0;
  } else {
    // ペン先を待つあいだに降らせて、着くころに並び終える
    dropBricks(waiting ? 1.3 : .7);
  }
  resize();
  wake();

  // カーソルでパドルを動かす。離れたら少し待ってから自動に戻す。
  let release = 0;
  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return;
    const box = canvas.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width;
    const y = (event.clientY - box.top) / box.height;
    demo.setTarget(x * W);
    clearTimeout(release);
    screen.style.setProperty('--tilt-x', `${(x - .5) * 10}deg`);
    screen.style.setProperty('--tilt-y', `${(.5 - y) * 8}deg`);
  };
  const onLeave = () => {
    release = window.setTimeout(() => demo.setTarget(null), 700);
    screen.style.removeProperty('--tilt-x');
    screen.style.removeProperty('--tilt-y');
  };
  if (finePointer.matches) {
    screen.addEventListener('pointermove', onMove);
    screen.addEventListener('pointerleave', onLeave);
  }

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); });
  intersection.observe(canvas);
  const repaint = () => { palette = readPalette(root); draw(); };
  const themeObserver = new MutationObserver(repaint);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  colorScheme.addEventListener('change', repaint);
  const onGame = (event: Event) => { gameOpen = Boolean((event as CustomEvent<boolean>).detail); if (!gameOpen) wake(); };
  addEventListener('neulog-game-visibility', onGame);
  document.addEventListener('visibilitychange', wake);
  document.fonts?.ready.then(draw);

  const stop = () => {
    cancelAnimationFrame(frame);
    clearTimeout(release);
    screen.removeEventListener('pointermove', onMove);
    screen.removeEventListener('pointerleave', onLeave);
    resizeObserver.disconnect();
    intersection.disconnect();
    themeObserver.disconnect();
    colorScheme.removeEventListener('change', repaint);
    removeEventListener('neulog-game-visibility', onGame);
    document.removeEventListener('visibilitychange', wake);
  };
  return { stop, launch, landing };
}
