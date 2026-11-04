// Deterministic, device-local demo. Never writes to the playable game or leaderboard.
export function createBreakoutAutoplay() {
  const field = { left: 22, right: 746, top: 65, bottom: 395 };
  const state = {
    time: 0, round: 1, score: 0, lives: 3, phase: 'play', hold: 0,
    ball: { x: 433, y: 278, vx: -164, vy: -228, r: 7 },
    paddle: { x: 384, y: 363, width: 116, height: 12 },
    bricks: [], particles: [], trail: [],
    totals: { brickHits: 0, paddleHits: 0, wallHits: 0, clears: 0, misses: 0 }
  };
  const clampValue = (value, min, max) => Math.min(max, Math.max(min, value));
  let trailClock = 0;
  // 人が動かしているときのパドルの目標位置。null のあいだは自動で打ち返す。
  let manualTarget = null;
  function reflectX(x) {
    const low = field.left + state.ball.r;
    const span = field.right - state.ball.r - low;
    const phase = ((x - low) % (2 * span) + 2 * span) % (2 * span);
    return low + (phase <= span ? phase : 2 * span - phase);
  }
  function seedBricks() {
    state.bricks = Array.from({ length: 24 }, (_, index) => ({
      x: 30 + index % 8 * 90, y: 90 + Math.floor(index / 8) * 37,
      width: 79, height: 26, row: Math.floor(index / 8), alive: true
    }));
  }
  function serve() {
    Object.assign(state.ball, {
      x: 365 + state.round % 3 * 34, y: 286,
      vx: state.round % 2 ? -164 : 174, vy: -228
    });
    state.paddle.x = state.ball.x;
    state.trail = [];
    state.particles = [];
    trailClock = 0;
  }
  function reset() {
    state.time = 0;
    state.round = 1;
    state.score = 0;
    state.lives = 3;
    state.phase = 'play';
    state.hold = 0;
    Object.keys(state.totals).forEach(key => { state.totals[key] = 0; });
    seedBricks();
    serve();
  }
  function tick(dt) {
    state.time += dt;
    for (const particle of state.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 150 * dt;
      particle.life -= dt;
    }
    state.particles = state.particles.filter(particle => particle.life > 0);
    if (state.phase !== 'play') {
      state.hold -= dt;
      if (state.hold <= 0) {
        if (state.phase === 'clear') {
          state.round++;
          seedBricks();
        } else if (state.lives <= 0) {
          state.lives = 3;
          state.score = 0;
          seedBricks();
        }
        serve();
        state.phase = 'play';
      }
      return;
    }
    const b = state.ball, p = state.paddle;
    const alive = state.bricks.filter(brick => brick.alive);
    let goal = b.x + b.vx * .18;
    if (b.vy > 0) {
      const untilPaddle = Math.max(0, (p.y - b.r - b.y) / b.vy);
      const landing = reflectX(b.x + b.vx * untilPaddle);
      const aim = alive[(state.totals.paddleHits * 5 + state.round * 3) % Math.max(1, alive.length)];
      const angle = aim
        ? clampValue(Math.atan2(aim.x + aim.width / 2 - landing, p.y - b.r - aim.y - aim.height / 2), -.85, .85)
        : .28;
      goal = landing - angle / 1.05 * p.width / 2;
    }
    if (manualTarget !== null) goal = manualTarget;
    goal = clampValue(goal, field.left + p.width / 2, field.right - p.width / 2);
    p.x += clampValue(goal - p.x, -620 * dt, 620 * dt);
    const previousX = b.x, previousY = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x - b.r < field.left) {
      b.x = field.left + b.r;
      b.vx = Math.abs(b.vx);
      state.totals.wallHits++;
    } else if (b.x + b.r > field.right) {
      b.x = field.right - b.r;
      b.vx = -Math.abs(b.vx);
      state.totals.wallHits++;
    }
    if (b.y - b.r < field.top) {
      b.y = field.top + b.r;
      b.vy = Math.abs(b.vy);
      state.totals.wallHits++;
    }
    for (const brick of state.bricks) {
      if (!brick.alive) continue;
      const closestX = clampValue(b.x, brick.x, brick.x + brick.width);
      const closestY = clampValue(b.y, brick.y, brick.y + brick.height);
      if ((b.x - closestX) ** 2 + (b.y - closestY) ** 2 > b.r ** 2) continue;
      brick.alive = false;
      state.score += 10;
      state.totals.brickHits++;
      if (previousY + b.r <= brick.y) {
        b.y = brick.y - b.r - .01;
        b.vy = -Math.abs(b.vy);
      } else if (previousY - b.r >= brick.y + brick.height) {
        b.y = brick.y + brick.height + b.r + .01;
        b.vy = Math.abs(b.vy);
      } else if (previousX + b.r <= brick.x) {
        b.x = brick.x - b.r - .01;
        b.vx = -Math.abs(b.vx);
      } else if (previousX - b.r >= brick.x + brick.width) {
        b.x = brick.x + brick.width + b.r + .01;
        b.vx = Math.abs(b.vx);
      } else {
        b.vy = -b.vy;
        b.y = b.vy < 0 ? brick.y - b.r - .01 : brick.y + brick.height + b.r + .01;
      }
      for (let index = 0; index < 4; index++) {
        state.particles.push({
          x: brick.x + brick.width / 2, y: brick.y + brick.height / 2,
          vx: (index - 1.5) * 38, vy: -44 - index % 2 * 18,
          life: .26, row: brick.row
        });
      }
      break;
    }
    if (b.vy > 0 && previousY + b.r <= p.y && b.y + b.r >= p.y
      && b.x + b.r >= p.x - p.width / 2 && b.x - b.r <= p.x + p.width / 2) {
      b.y = p.y - b.r - .01;
      let angle = clampValue((b.x - p.x) / (p.width / 2), -.9, .9) * 1.05;
      if (Math.abs(angle) < .14) angle = state.totals.paddleHits % 2 ? -.16 : .16;
      const speed = 278 + Math.min(state.round - 1, 4) * 9;
      b.vx = Math.sin(angle) * speed;
      b.vy = -Math.cos(angle) * speed;
      state.totals.paddleHits++;
    }
    if (!state.bricks.some(brick => brick.alive)) {
      state.phase = 'clear';
      state.hold = 1;
      state.totals.clears++;
    } else if (b.y - b.r > field.bottom) {
      state.lives--;
      state.totals.misses++;
      state.phase = 'serve';
      state.hold = .7;
    }
    trailClock += dt;
    if (trailClock >= 1 / 30) {
      trailClock %= 1 / 30;
      state.trail.push({ x: b.x, y: b.y });
      if (state.trail.length > 5) state.trail.shift();
    }
  }
  function advance(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    let remaining = Math.min(seconds, .1);
    while (remaining > 1e-9) {
      const step = Math.min(remaining, 1 / 120);
      tick(step);
      remaining -= step;
    }
  }
  function setTarget(x) {
    manualTarget = Number.isFinite(x) ? x : null;
  }
  seedBricks();
  return { state, advance, reset, setTarget, field };
}
