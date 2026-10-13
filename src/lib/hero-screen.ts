import { createBreakoutAutoplay } from './breakout-autoplay';

type Palette = { screen: string; ink: string; dim: string; bricks: string[] };

const WIDTH = 768;
const HEIGHT = 440;

function readPalette(device: HTMLElement): Palette {
  const style = getComputedStyle(device);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    screen: read('--device-screen'),
    ink: read('--device-ink'),
    dim: read('--device-dim'),
    bricks: [read('--brick-1'), read('--brick-2'), read('--brick-3')],
  };
}

function block(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

function draw(ctx: CanvasRenderingContext2D, state: ReturnType<typeof createBreakoutAutoplay>['state'], palette: Palette) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = palette.screen;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.font = '500 20px "Geist Mono", ui-monospace, monospace';
  ctx.fillStyle = palette.dim;
  ctx.textAlign = 'left';
  ctx.fillText(`SCORE ${String(state.score).padStart(5, '0')}`, 30, 42);
  ctx.textAlign = 'right';
  ctx.fillText(`ROUND ${String(state.round).padStart(2, '0')}`, 738, 42);

  for (let life = 0; life < 3; life++) {
    ctx.fillStyle = life < state.lives ? palette.bricks[0] : palette.dim;
    ctx.globalAlpha = life < state.lives ? 1 : .35;
    block(ctx, 362 + life * 18, 30, 12, 12, 3);
  }
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.beginPath();
  ctx.rect(15, 62, 738, 335);
  ctx.clip();
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    ctx.fillStyle = palette.bricks[brick.row];
    block(ctx, brick.x + 2, brick.y + 2, brick.width - 4, brick.height - 4, 5);
  }
  for (const particle of state.particles) {
    ctx.fillStyle = palette.bricks[particle.row];
    ctx.globalAlpha = Math.max(0, particle.life / .26);
    ctx.fillRect(particle.x - 3, particle.y - 3, 6, 6);
  }
  ctx.fillStyle = palette.ink;
  state.trail.forEach((point, index) => {
    ctx.globalAlpha = .05 + index * .04;
    ctx.beginPath();
    ctx.arc(point.x, point.y, state.ball.r * .8, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(state.ball.x, state.ball.y, state.ball.r + 1, 0, Math.PI * 2);
  ctx.fill();
  block(ctx, state.paddle.x - state.paddle.width / 2, state.paddle.y, state.paddle.width, state.paddle.height, 6);
  ctx.restore();

  if (state.phase === 'clear') {
    ctx.fillStyle = palette.bricks[0];
    ctx.font = '600 24px "Geist Mono", ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('STAGE CLEAR!', WIDTH / 2, 250);
  }
}

/** Runs the self-playing breakout on the hero console. Returns a teardown. */
export function mountHeroScreen(device: HTMLElement) {
  const canvas = device.querySelector<HTMLCanvasElement>('canvas');
  const ctx = canvas?.getContext('2d');
  if (!canvas || !ctx) return () => {};

  const demo = createBreakoutAutoplay();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let palette = readPalette(device);
  let frame = 0;
  let last = 0;
  let visible = true;
  let gameOpen = document.body.dataset.neulogGameOpen === 'true';
  let seenHits = 0;
  let hitTimer = 0;

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    const cssWidth = canvas.clientWidth || WIDTH;
    canvas.width = Math.round(cssWidth * ratio);
    canvas.height = Math.round(cssWidth * ratio * HEIGHT / WIDTH);
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    draw(ctx, demo.state, palette);
  };

  const loop = (time: number) => {
    frame = 0;
    if (!visible || gameOpen || document.hidden || reducedMotion.matches) { last = 0; return; }
    if (last) demo.advance(Math.min((time - last) / 1000, .05));
    last = time;
    draw(ctx, demo.state, palette);
    if (demo.state.totals.brickHits !== seenHits) {
      seenHits = demo.state.totals.brickHits;
      device.classList.remove('is-hit');
      void device.offsetWidth;
      device.classList.add('is-hit');
      clearTimeout(hitTimer);
      hitTimer = window.setTimeout(() => device.classList.remove('is-hit'), 180);
    }
    frame = requestAnimationFrame(loop);
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(loop); };

  // A still frame for reduced motion: a few bricks already gone.
  for (let i = 0; i < 40; i++) demo.advance(.1);
  seenHits = demo.state.totals.brickHits;
  resize();
  wake();

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  const intersection = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; if (visible) wake(); });
  intersection.observe(canvas);
  const repaint = () => { palette = readPalette(device); draw(ctx, demo.state, palette); };
  const themeObserver = new MutationObserver(repaint);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const colorScheme = matchMedia('(prefers-color-scheme: dark)');
  colorScheme.addEventListener('change', repaint);
  const onGame = (event: Event) => { gameOpen = Boolean((event as CustomEvent<boolean>).detail); if (!gameOpen) wake(); };
  addEventListener('neulog-game-visibility', onGame);
  document.addEventListener('visibilitychange', wake);
  reducedMotion.addEventListener('change', wake);

  return () => {
    cancelAnimationFrame(frame);
    resizeObserver.disconnect();
    intersection.disconnect();
    themeObserver.disconnect();
    colorScheme.removeEventListener('change', repaint);
    removeEventListener('neulog-game-visibility', onGame);
    document.removeEventListener('visibilitychange', wake);
    reducedMotion.removeEventListener('change', wake);
  };
}
