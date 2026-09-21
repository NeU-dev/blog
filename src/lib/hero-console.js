import * as THREE from 'three';
import { createBreakoutAutoplay } from './breakout-autoplay';
import { drawBreakoutScreen } from './breakout-screen';
import { publishConsoleModel } from './console-model-bridge';

/** Mount one isolated console. The React island owns its teardown.
 * @param {HTMLDivElement} root
 * @returns {() => void}
 */
export function mountHeroConsole(root) {
  const stage = root.querySelector('.console-stage');
  const touch = root.querySelector('.console-touch');
  const fallback = root.querySelector('.console-fallback');
  const status = root.querySelector('[role="status"]');
  const worldStage = root.closest('.home-hero')?.querySelector('.meshy-world__stage');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const aborter = new AbortController();
  const signal = aborter.signal;
  let renderer, scene, model, camera, frame = 0, disposed = false;
  const inViewport = element => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0
      && rect.top < innerHeight && rect.left < innerWidth;
  };
  let localVisible = inViewport(root);
  let worldVisible = worldStage ? inViewport(worldStage) : localVisible;
  let visible = localVisible;
  let gameOpen = document.body.dataset.neulogGameOpen === 'true';
  let wake = () => {};
  let resizeObserver, intersectionObserver, frameCount = 0;
  let lastTickTime = 0, lastDrawTime = 0, forcePaint = true, manualPlay = null;
  let worldRendered = false, unpublishModel = () => {};
  const demo = createBreakoutAutoplay();
  const lcdPalette = {};
  const autoplayEnabled = () => manualPlay === null ? !reducedMotion.matches : manualPlay;
  const base = { x: -.11, y: -.24, z: -.035 };
  const target = { ...base };
  const materials = [], textures = [], geometry = [];
  const probe = document.createElement('span');
  probe.hidden = true;
  root.appendChild(probe);
  const color = name => {
    probe.style.color = 'var(--console-' + name + ')';
    return getComputedStyle(probe).color;
  };
  function fail() {
    unpublishModel();
    unpublishModel = () => {};
    worldRendered = false;
    delete root.dataset.worldRendered;
    root.dataset.renderer = 'fallback';
    stage.hidden = true;
    fallback.hidden = false;
    status.textContent = 'この環境では2Dで自動プレイを表示しています。';
    cancelAnimationFrame(frame);
    frame = 0;
    const canvas = fallback.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    const palette = { screen: color('screen'), ink: color('screen-ink'), bricks: [color('brick-1'), color('brick-2'), color('brick-3')] };
    function drawFallback(time) {
      frame = 0;
      if (disposed || !visible || document.hidden || gameOpen) { lastTickTime = 0; return; }
      if (autoplayEnabled() && lastTickTime) demo.advance(Math.min((time - lastTickTime) / 1000, .05));
      lastTickTime = time;
      drawBreakoutScreen(ctx, demo.state, autoplayEnabled(), palette);
      if (autoplayEnabled()) frame = requestAnimationFrame(drawFallback);
    }
    wake = () => { lastTickTime = 0; if (!frame && !disposed) frame = requestAnimationFrame(drawFallback); };
    updateVisibility();
  }
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .96;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    touch.appendChild(renderer.domElement);
    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-2, 2, 1.7, -1.7, .1, 30);
    camera.position.set(0, 0, 8);
    camera.lookAt(0, 0, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x727d72, 2.0));
    const key = new THREE.DirectionalLight(0xfffaf0, 2.5);
    key.position.set(-3.5, 5.5, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: .1, far: 18 });
    key.shadow.bias = -.001;
    key.shadow.normalBias = .012;
    key.shadow.radius = 5;
    scene.add(key);
    model = new THREE.Group();
    model.rotation.set(base.x, base.y, base.z);
    scene.add(model);

    const paletteMaterials = [];
    function material(token, shade = 1) {
      const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(color(token)).multiplyScalar(shade), roughness: .88, metalness: 0 });
      paletteMaterials.push({ mat, token, shade });
      materials.push(mat);
      return mat;
    }
    function roundedPath(width, height, radius, isHole = false) {
      const path = isHole ? new THREE.Path() : new THREE.Shape();
      const x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2);
      path.moveTo(x + r, y);
      path.lineTo(x + width - r, y);
      path.quadraticCurveTo(x + width, y, x + width, y + r);
      path.lineTo(x + width, y + height - r);
      path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      path.lineTo(x + r, y + height);
      path.quadraticCurveTo(x, y + height, x, y + height - r);
      path.lineTo(x, y + r);
      path.quadraticCurveTo(x, y, x + r, y);
      return path;
    }
    function mesh(geo, mat, x = 0, y = 0, z = 0) {
      geometry.push(geo);
      const item = new THREE.Mesh(geo, mat);
      item.position.set(x, y, z);
      item.castShadow = true;
      item.receiveShadow = true;
      model.add(item);
      return item;
    }
    function box(w, h, d, r, mat, x, y, z) {
      const geo = new THREE.ExtrudeGeometry(roundedPath(w, h, r), { depth: d, bevelEnabled: true, bevelSize: .015, bevelThickness: .015, bevelSegments: 3, steps: 1, curveSegments: 8 });
      geo.translate(0, 0, -d / 2);
      return mesh(geo, mat, x, y, z);
    }
    const bodyMaterial = material('device');
    const edgeMaterial = material('device', .77);
    const seamMaterial = material('shadow', .83);
    const inkMaterial = material('screen');
    const accentMaterial = material('accent');
    box(3.08, 2.91, .16, .12, edgeMaterial, 0, 0, -.15);
    box(3.09, 2.92, .028, .12, seamMaterial, 0, 0, -.067);
    box(3.08, 2.91, .22, .12, bodyMaterial, 0, 0, .06);
    const rimShape = roundedPath(2.72, 1.64, .075);
    rimShape.holes.push(roundedPath(2.55, 1.46, .025, true));
    const rimGeo = new THREE.ExtrudeGeometry(rimShape, { depth: .073, bevelEnabled: true, bevelSize: .012, bevelThickness: .012, bevelSegments: 2, curveSegments: 8 });
    mesh(rimGeo, material('shadow', .84), 0, .12, .16);

    function textureCanvas(width, height) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      textures.push(tex);
      return { canvas, ctx: canvas.getContext('2d'), tex };
    }
    const lcd = textureCanvas(768, 440);
    lcd.tex.generateMipmaps = false;
    lcd.tex.minFilter = THREE.LinearFilter;
    lcd.tex.magFilter = THREE.LinearFilter;
    const decals = textureCanvas(1024, 970);
    // Discard clear decal pixels. Alpha blending on the full-case plane can
    // occlude the LCD and buttons when the handheld tilts (depth sorting).
    const matte = (texture, opaque = false) => {
      const mat = new THREE.MeshBasicMaterial({
        map: texture, transparent: false, depthWrite: true,
        alphaTest: opaque ? 0 : .35, toneMapped: false
      });
      materials.push(mat);
      return mat;
    };
    const screenMesh = mesh(new THREE.PlaneGeometry(2.56, 1.47), matte(lcd.tex, true), 0, .12, .199);
    screenMesh.castShadow = false;
    screenMesh.receiveShadow = false;
    const printMesh = mesh(new THREE.PlaneGeometry(3.08, 2.91), matte(decals.tex), 0, 0, .21);
    printMesh.castShadow = false;
    printMesh.receiveShadow = false;
    stage.dataset.lcdOpaque = String(!screenMesh.material.transparent);
    stage.dataset.decalsWriteDepth = String(printMesh.material.depthWrite);
    stage.dataset.decalsDiscardClear = String(printMesh.material.alphaTest > 0);
    function paintScreen() {
      drawBreakoutScreen(lcd.ctx, demo.state, autoplayEnabled(), lcdPalette);
      lcd.tex.needsUpdate = true;
    }
    function paint() {
      Object.assign(lcdPalette, {
        screen: color('screen'), ink: color('screen-ink'),
        bricks: [color('brick-1'), color('brick-2'), color('brick-3')]
      });
      paintScreen();
      const d = decals.ctx;
      d.clearRect(0, 0, 1024, 970);
      d.font = 'bold 27px monospace';
      d.fillStyle = color('ink');
      d.fillText('NEU-BOY', 64, 156);
      d.font = '21px monospace';
      d.fillText('● POWER', 810, 156);
      d.strokeStyle = color('shadow');
      d.lineWidth = 6;
      d.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        d.beginPath();
        d.moveTo(464 + i * 19, 789);
        d.lineTo(453 + i * 19, 832);
        d.stroke();
      }
      decals.tex.needsUpdate = true;
    }
    // All keys clear the LCD rim, including the top arm of the D-pad.
    box(.61, .19, .07, .025, inkMaterial, -.99, -1.07, .226);
    box(.19, .61, .071, .025, inkMaterial, -.99, -1.07, .227);
    const buttonPositions = [{ x: .64, y: -1.16, label: 'B' }, { x: 1.09, y: -.99, label: 'A' }];
    for (const item of buttonPositions) {
      const keyGeo = new THREE.CylinderGeometry(.157, .18, .11, 40);
      keyGeo.rotateX(Math.PI / 2);
      mesh(keyGeo, accentMaterial, item.x, item.y, .233);
      const text = textureCanvas(96, 96);
      item.print = text;
      text.ctx.fillStyle = color('on-accent');
      text.ctx.font = '500 44px monospace';
      text.ctx.textAlign = 'center';
      text.ctx.textBaseline = 'middle';
      text.ctx.fillText(item.label, 48, 50);
      text.tex.needsUpdate = true;
      const label = mesh(new THREE.PlaneGeometry(.29, .29), matte(text.tex), item.x, item.y, .29);
      label.castShadow = false;
    }
    box(.30, .065, .026, .02, seamMaterial, -.17, -1.23, .186);
    box(.30, .065, .026, .02, seamMaterial, .20, -1.23, .186);

    const contactShadow = textureCanvas(256, 256);
    const shadowMat = new THREE.MeshBasicMaterial({ map: contactShadow.tex, transparent: true, opacity: .16, depthWrite: false, toneMapped: false });
    materials.push(shadowMat);
    const shadowGeo = new THREE.PlaneGeometry(3.8, 3.6);
    geometry.push(shadowGeo);
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.position.set(.04, -.065, -.72);
    scene.add(shadow);

    const modelBounds = new THREE.Box3();
    function fitCamera() {
      const aspect = touch.clientWidth / Math.max(1, touch.clientHeight);
      model.updateMatrixWorld(true);
      modelBounds.setFromObject(model);
      const x = Math.max(Math.abs(modelBounds.min.x), Math.abs(modelBounds.max.x));
      const y = Math.max(Math.abs(modelBounds.min.y), Math.abs(modelBounds.max.y));
      const halfHeight = Math.max(1.75, y + .075, (x + .075) / aspect);
      camera.left = -halfHeight * aspect;
      camera.right = halfHeight * aspect;
      camera.top = halfHeight;
      camera.bottom = -halfHeight;
      camera.updateProjectionMatrix();
      stage.dataset.fits = String(x < camera.right && y < camera.top);
    }
    function updatePlayback() {
      touch.setAttribute('aria-label', autoplayEnabled()
        ? 'ブロック崩しの自動プレイを一時停止'
        : 'ブロック崩しの自動プレイを再生');
      lastTickTime = 0;
      forcePaint = true;
      requestDraw();
    }
    function draw(timestamp) {
      frame = 0;
      if (disposed || !visible || document.hidden || stage.hidden || gameOpen) {
        lastTickTime = 0;
        stage.dataset.autoplay = 'hidden';
        return;
      }
      const dt = lastTickTime ? Math.min((timestamp - lastTickTime) / 1000, .05) : 0;
      lastTickTime = timestamp;
      const running = autoplayEnabled();
      if (running) demo.advance(dt);
      const wasMoving = Math.abs(model.rotation.x - target.x) + Math.abs(model.rotation.y - target.y) + Math.abs(model.rotation.z - target.z) > .001;
      const amount = reducedMotion.matches ? 1 : .19;
      model.rotation.x += (target.x - model.rotation.x) * amount;
      model.rotation.y += (target.y - model.rotation.y) * amount;
      model.rotation.z += (target.z - model.rotation.z) * amount;
      const moving = Math.abs(model.rotation.x - target.x) + Math.abs(model.rotation.y - target.y) + Math.abs(model.rotation.z - target.z) > .001;
      if (forcePaint || wasMoving || (running && timestamp - lastDrawTime >= 1000 / 30 - 1)) {
        if (wasMoving || forcePaint) {
          fitCamera();
          renderer.shadowMap.needsUpdate = true;
        }
        paintScreen();
        if (!worldRendered) renderer.render(scene, camera);
        lastDrawTime = timestamp;
        forcePaint = false;
        frameCount++;
        stage.dataset.frames = String(frameCount);
        stage.dataset.rotation = [model.rotation.x, model.rotation.y, model.rotation.z].map(value => value.toFixed(3)).join(',');
        stage.dataset.simTime = demo.state.time.toFixed(3);
        stage.dataset.ball = [demo.state.ball.x, demo.state.ball.y].map(value => value.toFixed(2)).join(',');
        stage.dataset.paddle = demo.state.paddle.x.toFixed(2);
        stage.dataset.remaining = String(demo.state.bricks.filter(brick => brick.alive).length);
        stage.dataset.round = String(demo.state.round);
        stage.dataset.brickHits = String(demo.state.totals.brickHits);
        stage.dataset.paddleHits = String(demo.state.totals.paddleHits);
      }
      stage.dataset.autoplay = running ? 'playing' : 'paused';
      stage.dataset.moving = String(moving);
      if (moving || running) requestDraw();
      else lastTickTime = 0;
    }
    function requestDraw() {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    }
    function setWorldRendered(active) {
      if (disposed || stage.hidden) return;
      const next = Boolean(active);
      if (worldRendered === next) return;
      worldRendered = next;
      if (next) root.dataset.worldRendered = 'true';
      else delete root.dataset.worldRendered;
      updateVisibility();
    }
    function resize() {
      if (stage.hidden) return;
      const width = touch.clientWidth, height = touch.clientHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      fitCamera();
      forcePaint = true;
      requestDraw();
    }
    function sync() {
      stage.hidden = false;
      fallback.hidden = true;
      paletteMaterials.forEach(({ mat, token, shade }) => mat.color.set(color(token)).multiplyScalar(shade));
      const shadowContext = contactShadow.ctx;
      shadowContext.clearRect(0, 0, 256, 256);
      shadowContext.shadowColor = color('depth-shadow');
      shadowContext.shadowBlur = 20;
      shadowContext.shadowOffsetY = 5;
      shadowContext.fillStyle = color('depth-shadow');
      shadowContext.beginPath();
      shadowContext.roundRect(34, 33, 188, 186, 18);
      shadowContext.fill();
      contactShadow.tex.needsUpdate = true;
      for (const item of buttonPositions) {
        const labelContext = item.print.ctx;
        labelContext.clearRect(0, 0, 96, 96);
        labelContext.fillStyle = color('on-accent');
        labelContext.fillText(item.label, 48, 50);
        item.print.tex.needsUpdate = true;
      }
      paint();
      resize();
      updatePlayback();
    }
    let drag = null, suppressClick = false, keyboardPose = false;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    touch.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      keyboardPose = false;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, rx: target.x, ry: target.y, moved: false };
      touch.setPointerCapture(event.pointerId);
    }, { signal });
    touch.addEventListener('pointermove', event => {
      if (drag && event.pointerId === drag.id) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.moved = drag.moved || Math.abs(dx) + Math.abs(dy) > 5;
        target.y = clamp(drag.ry + dx * .007, -.92, .92);
        target.x = clamp(drag.rx + dy * .004, -.42, .42);
      } else if (finePointer.matches && !reducedMotion.matches) {
        keyboardPose = false;
        const rect = touch.getBoundingClientRect();
        target.y = base.y + ((event.clientX - rect.left) / rect.width - .5) * .22;
        target.x = base.x + ((event.clientY - rect.top) / rect.height - .5) * .13;
      } else return;
      requestDraw();
    }, { signal });
    function endDrag(event) {
      if (!drag || drag.id !== event.pointerId) return;
      suppressClick = drag.moved;
      if (touch.hasPointerCapture(event.pointerId)) touch.releasePointerCapture(event.pointerId);
      drag = null;
    }
    touch.addEventListener('pointerup', endDrag, { signal });
    touch.addEventListener('pointercancel', endDrag, { signal });
    touch.addEventListener('pointerleave', () => {
      if (drag || keyboardPose || reducedMotion.matches) return;
      Object.assign(target, base);
      requestDraw();
    }, { signal });
    touch.addEventListener('click', event => {
      if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
      manualPlay = !autoplayEnabled();
      updatePlayback();
    }, { signal });
    touch.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
      event.preventDefault();
      keyboardPose = true;
      if (event.key === 'Home') Object.assign(target, base);
      else if (event.key === 'ArrowLeft') target.y = clamp(target.y - .16, -.92, .92);
      else if (event.key === 'ArrowRight') target.y = clamp(target.y + .16, -.92, .92);
      else if (event.key === 'ArrowUp') target.x = clamp(target.x - .12, -.42, .42);
      else target.x = clamp(target.x + .12, -.42, .42);
      requestDraw();
    }, { signal });
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      fail();
    }, { signal });
    root.dataset.renderer = 'threejs';
    wake = requestDraw;
    sync();
    unpublishModel = publishConsoleModel(root, { model, camera, setWorldRendered });
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(touch);
  } catch (error) {
    fail();
  }
  const fallbackToggle = root.querySelector('.console-fallback-toggle');
  fallbackToggle.addEventListener('click', () => {
    manualPlay = !autoplayEnabled();
    fallbackToggle.setAttribute('aria-label', autoplayEnabled() ? 'ブロック崩しの自動プレイを一時停止' : 'ブロック崩しの自動プレイを再生');
    lastTickTime = 0;
    wake();
  }, { signal });
  function updateVisibility() {
    // The live LCD belongs to the world scene while its clone is displayed.
    // Its transformed, transparent DOM hit area is not the visible model.
    visible = worldRendered && worldStage ? worldVisible : localVisible;
    lastTickTime = 0;
    if (!visible || document.hidden || gameOpen) {
      cancelAnimationFrame(frame);
      frame = 0;
      stage.dataset.autoplay = 'hidden';
    } else { forcePaint = true; wake(); }
  }
  document.addEventListener('visibilitychange', updateVisibility, { signal });
  window.addEventListener('neulog-game-visibility', event => { gameOpen = event.detail; updateVisibility(); }, { signal });
  window.addEventListener('pageshow', updateVisibility, { signal });
  window.addEventListener('pagehide', () => { cancelAnimationFrame(frame); frame = 0; lastTickTime = 0; }, { signal });
  reducedMotion.addEventListener('change', () => {
    Object.assign(target, base);
    manualPlay = null;
    lastTickTime = 0;
    forcePaint = true;
    for (const button of [touch, fallbackToggle]) button.setAttribute('aria-label', autoplayEnabled() ? 'ブロック崩しの自動プレイを一時停止' : 'ブロック崩しの自動プレイを再生');
    wake();
  }, { signal });
  intersectionObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.target === root) localVisible = entry.isIntersecting;
      else if (entry.target === worldStage) worldVisible = entry.isIntersecting;
    }
    updateVisibility();
  });
  intersectionObserver.observe(root);
  if (worldStage) intersectionObserver.observe(worldStage);
  updateVisibility();
  function dispose() {
    if (disposed) return;
    disposed = true;
    unpublishModel();
    unpublishModel = () => {};
    worldRendered = false;
    delete root.dataset.worldRendered;
    aborter.abort();
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    geometry.forEach(item => item.dispose());
    materials.forEach(item => item.dispose());
    textures.forEach(item => item.dispose());
    renderer?.dispose();
    renderer?.domElement.remove();
    probe.remove();
  }
  return dispose;
}
