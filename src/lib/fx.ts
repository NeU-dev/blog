// Loud-but-cheap page effects: confetti, cursor sparkles, scroll reveals, card tilt.
// One canvas, one rAF loop that sleeps when nothing is moving.

type Particle = {
  x: number; y: number; vx: number; vy: number;
  life: number; max: number; size: number; color: string;
  spin: number; angle: number; shape: 'rect' | 'star' | 'dot';
  gravity: number;
};

const COLORS = ['#8ecdf5', '#5b7cf7', '#a3e6d8', '#2fb8a8', '#a493f7', '#3b4fc4', '#2a2d32'];
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];

export function initFx() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const root = document.documentElement;

  initReveal(reducedMotion.matches);
  initReadProgress();
  if (reducedMotion.matches) return;

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-layer';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const particles: Particle[] = [];
  let frame = 0;
  let last = 0;

  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = innerWidth * ratio;
    canvas.height = innerHeight * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  resize();
  addEventListener('resize', resize);

  const drawStar = (size: number) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const r = i % 2 ? size * .38 : size;
      const a = (Math.PI / 4) * i;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
  };

  const loop = (time: number) => {
    const dt = last ? Math.min((time - last) / 1000, .05) : 1 / 60;
    last = time;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.vx *= .985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.angle += p.spin * dt;
      const t = p.life / p.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 2.2);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = p.color;
      if (p.shape === 'rect') ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      else if (p.shape === 'star') drawStar(p.size * (.6 + t * .4));
      else { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      ctx.restore();
    }
    if (particles.length) frame = requestAnimationFrame(loop);
    else { frame = 0; last = 0; ctx.clearRect(0, 0, innerWidth, innerHeight); }
  };
  const wake = () => { if (!frame) frame = requestAnimationFrame(loop); };

  const burst = (x: number, y: number, amount = 26, power = 1) => {
    for (let i = 0; i < amount; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (180 + Math.random() * 420) * power;
      const max = .9 + Math.random() * .8;
      particles.push({
        x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 220 * power,
        life: max, max, size: 7 + Math.random() * 9, color: pick(COLORS),
        spin: (Math.random() - .5) * 14, angle: Math.random() * 6,
        shape: pick(['rect', 'rect', 'star', 'dot']), gravity: 900,
      });
    }
    wake();
  };
  (window as unknown as { neulogBurst: typeof burst }).neulogBurst = burst;

  // Confetti on every press of something clickable (and anywhere on the home page).
  const isHome = location.pathname === '/';
  addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const target = event.target as Element | null;
    if (!target || target.closest('input, textarea, [role="dialog"], .article-body p, .article-body li')) return;
    const interactive = target.closest('a, button, [data-confetti]');
    if (!interactive && !isHome) return;
    burst(event.clientX, event.clientY, interactive ? 28 : 16, interactive ? 1 : .7);
  }, { passive: true });

  // Sparkle trail behind the mouse (not over article text — reading stays calm).
  if (finePointer.matches) {
    let lastSpark = 0;
    addEventListener('pointermove', event => {
      if (event.pointerType !== 'mouse' || document.body.dataset.neulogGameOpen === 'true') return;
      const now = performance.now();
      if (now - lastSpark < 28) return;
      if ((event.target as Element | null)?.closest('.article-body')) return;
      lastSpark = now;
      const max = .5 + Math.random() * .35;
      particles.push({
        x: event.clientX + (Math.random() - .5) * 8, y: event.clientY + (Math.random() - .5) * 8,
        vx: (Math.random() - .5) * 60, vy: 20 + Math.random() * 40,
        life: max, max, size: 5 + Math.random() * 6, color: pick(COLORS),
        spin: (Math.random() - .5) * 8, angle: 0, shape: 'star', gravity: 120,
      });
      wake();
    }, { passive: true });
  }

  // Cards lean toward the pointer.
  if (finePointer.matches) {
    document.querySelectorAll<HTMLElement>('.post-card__link').forEach(card => {
      card.addEventListener('pointermove', event => {
        const box = card.getBoundingClientRect();
        const x = (event.clientX - box.left) / box.width;
        const y = (event.clientY - box.top) / box.height;
        card.style.setProperty('--rx', `${(x - .5) * 10}deg`);
        card.style.setProperty('--ry', `${(.5 - y) * 8}deg`);
        card.style.setProperty('--gx', `${x * 100}%`);
        card.style.setProperty('--gy', `${y * 100}%`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.removeProperty('--rx');
        card.style.removeProperty('--ry');
      });
    });
  }

  // Finishing an article deserves a party.
  const end = document.querySelector<HTMLElement>('[data-celebrate]');
  if (end && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      observer.disconnect();
      const box = end.getBoundingClientRect();
      burst(box.left + 30, box.top + 20, 40, 1.2);
      setTimeout(() => burst(box.right - 30, box.top + 20, 40, 1.2), 160);
    }, { threshold: .9 });
    observer.observe(end);
  }

  root.dataset.fx = 'on';
}

function initReveal(skip: boolean) {
  const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (skip || !('IntersectionObserver' in window)) {
    items.forEach(item => item.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      // Jumped past it (anchor link, restored scroll): show it rather than leave a hole.
      if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return;
      entry.target.classList.add('is-in');
      observer.unobserve(entry.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach(item => observer.observe(item));
}

function initReadProgress() {
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
