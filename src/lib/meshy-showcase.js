import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { consoleFlightProgress } from './console-flight.js';
import { observeConsoleModel } from './console-model-bridge.js';

const MODEL_URLS = {
  desk: '/models/meshy/desk/model.glb',
  robot: '/models/meshy/robot/model.glb',
  props: '/models/meshy/props/model.glb',
  rocket: '/models/meshy/rocket/model.glb',
  portal: '/models/meshy/portal/model.glb',
  books: '/models/meshy/books/model.glb',
  cloud: '/models/meshy/cloud/model.glb',
  pencil: '/models/meshy/winged-pencil/model.glb',
};

const DESKTOP_LAYOUT = [
  { key: 'portal', position: [1.25, -.38, -2.55], scale: 5.15, rotation: [-.08, -.18, -.04], phase: .2, motion: .035 },
  { key: 'desk', position: [1.45, -1.36, -.35], scale: 3.05, rotation: [-.04, -.16, 0], phase: 1.4, motion: .02 },
  { key: 'robot', position: [4.18, -1.32, .95], scale: 1.68, rotation: [0, -.28, .025], phase: 2.1, motion: .07 },
  { key: 'robot', position: [1.1, -.78, -1.22], scale: .74, rotation: [0, .4, -.03], phase: 4.2, motion: .045 },
  { key: 'props', position: [3.75, -1.72, .75], scale: 1.0, rotation: [0, -.3, 0], phase: 3.2, motion: .04 },
  { key: 'books', position: [-3.82, -1.38, .55], scale: 1.48, rotation: [-.06, .32, -.055], phase: .7, motion: .055 },
  { key: 'rocket', position: [-4.18, 1.67, .9], scale: 1.45, rotation: [-.08, .42, -.48], phase: 2.7, motion: .09 },
  { key: 'cloud', position: [4.16, 1.92, -.15], scale: 1.55, rotation: [0, -.24, .03], phase: 1.2, motion: .08 },
  { key: 'pencil', position: [-2.65, .95, 1.12], scale: 1.48, rotation: [-.12, .18, .16], phase: 3.8, motion: .075 },
  { key: 'props', position: [-.72, -1.62, 1.28], scale: .66, rotation: [0, .35, 0], phase: 5.1, motion: .045 },
];

const MOBILE_LAYOUT = [
  { key: 'portal', position: [0, -1.02, -2.7], scale: 4.05, rotation: [-.08, -.12, -.03], phase: .2, motion: .03 },
  { key: 'desk', position: [-.05, -2.2, -.28], scale: 2.48, rotation: [-.04, -.1, 0], phase: 1.4, motion: .018 },
  { key: 'robot', position: [1.58, -2.52, .92], scale: 1.23, rotation: [0, -.3, .02], phase: 2.1, motion: .06 },
  { key: 'robot', position: [-.45, -1.33, -1.15], scale: .58, rotation: [0, .4, -.03], phase: 4.2, motion: .04 },
  { key: 'props', position: [-1.32, -2.35, .62], scale: .77, rotation: [0, .2, 0], phase: 3.2, motion: .035 },
  { key: 'books', position: [-1.42, -.28, .2], scale: .9, rotation: [-.06, .28, -.055], phase: .7, motion: .05 },
  { key: 'rocket', position: [1.25, 1.92, .78], scale: 1.0, rotation: [-.08, .35, -.38], phase: 2.7, motion: .08 },
  { key: 'cloud', position: [-1.35, 2.18, -.45], scale: 1.02, rotation: [0, -.2, .03], phase: 1.2, motion: .07 },
  { key: 'pencil', position: [.22, .78, .98], scale: .9, rotation: [-.12, .16, .14], phase: 3.8, motion: .065 },
  { key: 'props', position: [1.38, -.62, -.42], scale: .5, rotation: [0, -.32, 0], phase: 5.1, motion: .04 },
];

/**
 * Mount one full-bleed 3D world. There are deliberately no drag controls;
 * movement comes from a quiet idle loop, pointer depth and scroll parallax.
 * @param {HTMLDivElement} root
 * @returns {() => void}
 */
export function mountMeshyShowcase(root) {
  const stage = root.querySelector('.meshy-world__stage');
  const status = root.querySelector('[role="status"]');
  const hero = root.closest('.home-hero');
  const consoleSlot = hero?.querySelector('.hero-console-stack');
  const consoleRoot = consoleSlot?.querySelector('.hero-console');
  const playButton = consoleSlot?.querySelector('.game-launcher-button');
  const sticky = hero?.querySelector('.home-hero__sticky');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const aborter = new AbortController();
  const signal = aborter.signal;

  let renderer;
  let frame = 0;
  let visible = false;
  let loaded = false;
  let disposed = false;
  let resizeObserver;
  let intersectionObserver;
  let lastDraw = 0;
  let pointerX = 0;
  let pointerY = 0;
  let scrollDepth = 0;
  let scrollProgress = 0;
  let cameraBaseY = .75;
  let cameraBaseZ = 10.7;
  let desk;
  let deskContact;
  let flightMetrics;
  let consoleController;
  let consoleModel;
  let worldFailed = false;
  const anchor = new THREE.Vector3();
  const lifted = new THREE.Vector3();
  const destination = new THREE.Vector3();
  const deskScale = new THREE.Vector3();
  const restingQuaternion = new THREE.Quaternion();
  const destinationQuaternion = new THREE.Quaternion();
  const flatQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

  const geometry = new Set();
  const materials = new Set();
  const textures = new Set();
  const animated = [];

  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  } catch {
    status.textContent = 'WebGLが使えないため、モデルの写真を表示しています。';
    return () => {};
  }
  if (consoleSlot) consoleSlot.dataset.flightLoading = 'true';

  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-hidden', 'true');
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, .1, 50);
  camera.position.set(0, .75, 10.7);
  camera.lookAt(0, .05, 0);

  const world = new THREE.Group();
  scene.add(world);
  scene.add(new THREE.HemisphereLight(0xfff9ed, 0x789083, 2.7));

  const key = new THREE.DirectionalLight(0xfff2e3, 4.35);
  key.position.set(-5.5, 8, 8);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 7, bottom: -5, near: .1, far: 30 });
  key.shadow.bias = -.0005;
  key.shadow.normalBias = .025;
  key.shadow.radius = 5;
  scene.add(key);

  const pinkFill = new THREE.DirectionalLight(0xffa9bd, 1.7);
  pinkFill.position.set(6, 3, 5);
  scene.add(pinkFill);

  const mintFill = new THREE.PointLight(0xb7eadb, 12, 17, 2);
  mintFill.position.set(-3.5, 1.5, 4);
  scene.add(mintFill);

  const shadowMaterial = new THREE.ShadowMaterial({ color: 0x6f4347, opacity: .13 });
  const shadowGeometry = new THREE.PlaneGeometry(13, 7);
  materials.add(shadowMaterial);
  geometry.add(shadowGeometry);
  const shadowFloor = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.set(.6, -1.62, -.25);
  shadowFloor.receiveShadow = true;
  world.add(shadowFloor);

  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);

  function collectResources(object) {
    object.traverse(child => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      geometry.add(child.geometry);
      const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
      childMaterials.filter(Boolean).forEach(material => {
        materials.add(material);
        Object.values(material).forEach(value => {
          if (value?.isTexture) textures.add(value);
        });
      });
    });
  }

  function normalise(object) {
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    const centre = bounds.getCenter(new THREE.Vector3());
    object.position.sub(centre);
    object.scale.setScalar(1 / Math.max(size.y, .001));
    object.updateMatrixWorld(true);
    collectResources(object);
    return object;
  }

  function createCopy(source, config) {
    const wrapper = new THREE.Group();
    wrapper.add(source.clone(true));
    wrapper.userData.phase = config.phase;
    wrapper.userData.motion = config.motion;
    world.add(wrapper);
    animated.push(wrapper);
    if (config.key === 'desk') desk = wrapper;
    return wrapper;
  }

  // The device now lives in this scene, not in a flattened DOM overlay. Its
  // back faces the actual tabletop, with its original geometry/LCD shared.
  // Clear patch beside the baked-in mouse/keyboard, sampled against the GLB.
  const deskAnchor = new THREE.Vector3(.50, -.091856, .075);
  const deskConsoleScale = .055;
  const consoleBack = -.245;

  function releaseConsolePresentation() {
    consoleController?.setWorldRendered(false);
    if (consoleModel) consoleModel.visible = false;
    if (deskContact) deskContact.visible = false;
    consoleRoot?.style.removeProperty('transform');
    consoleRoot?.style.removeProperty('transform-origin');
    consoleSlot?.style.removeProperty('--flight-button');
    if (consoleSlot) {
      delete consoleSlot.dataset.flightReady;
      delete consoleSlot.dataset.flightLoading;
    }
    if (playButton) playButton.inert = false;
  }

  const stopObservingConsole = consoleRoot ? observeConsoleModel(consoleRoot, controller => {
    releaseConsolePresentation();
    if (consoleModel) scene.remove(consoleModel);
    consoleController = controller;
    // Clone nodes only. The original island still owns all geometry, materials
    // and the live screen texture; never dispose them in the Meshy scene.
    consoleModel = controller?.model.clone(true);
    if (consoleModel) {
      consoleModel.visible = false;
      scene.add(consoleModel);
    }
    measureFlight();
    requestDraw();
  }) : () => {};

  function measureFlight() {
    if (!consoleSlot || !consoleRoot) return;
    const canvasStage = consoleRoot.querySelector('.console-stage');
    const height = canvasStage?.hidden ? consoleRoot.offsetHeight : canvasStage?.clientHeight;
    if (!height) return;
    const slotRect = consoleSlot.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    flightMetrics = {
      height,
      width: consoleRoot.offsetWidth,
      x: slotRect.left - stageRect.left + consoleRoot.offsetWidth / 2,
      y: slotRect.top - stageRect.top + height / 2,
    };
  }

  function updateConsoleFlight() {
    if (!desk || !consoleRoot || !flightMetrics || !consoleController || !consoleModel || worldFailed) return;
    if (reducedMotion.matches) {
      releaseConsolePresentation();
      return;
    }
    desk.updateWorldMatrix(true, false);
    camera.updateMatrixWorld();
    const width = stage.clientWidth, height = stage.clientHeight;
    const pose = consoleFlightProgress(scrollProgress);

    // Local +Z is the device's screen normal. A -90 degree X rotation lays
    // its back flat on +Y of the desk, before either object is world-rotated.
    anchor.copy(deskAnchor);
    anchor.y += -consoleBack * deskConsoleScale + .002;
    lifted.copy(anchor);
    lifted.y += pose.lift * .32;
    lifted.applyMatrix4(desk.matrixWorld);
    desk.getWorldQuaternion(restingQuaternion).multiply(flatQuaternion);
    desk.getWorldScale(deskScale);

    // Match the existing foreground slot in camera space while keeping the
    // flight itself three-dimensional, perspective-correct and reversible.
    const frontDistance = 4;
    const halfView = frontDistance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    destination.set(
      (flightMetrics.x / width * 2 - 1) * halfView * camera.aspect,
      (1 - flightMetrics.y / height * 2) * halfView,
      -frontDistance,
    ).applyMatrix4(camera.matrixWorld);
    const targetScale = halfView * flightMetrics.height / height / consoleController.camera.top;
    destinationQuaternion.copy(camera.quaternion).multiply(consoleController.model.quaternion);
    consoleModel.position.lerpVectors(lifted, destination, pose.approach);
    consoleModel.scale.setScalar(THREE.MathUtils.lerp(deskConsoleScale * deskScale.x, targetScale, pose.approach));
    consoleModel.quaternion.slerpQuaternions(restingQuaternion, destinationQuaternion, pose.turn);
    consoleModel.visible = true;
    consoleController.setWorldRendered(true);

    // Keep the original accessible play/pause surface over the moving device;
    // only its now-duplicated canvas is hidden. The model is never CSS-flattened.
    anchor.copy(consoleModel.position).project(camera);
    const screenX = (anchor.x + 1) * width / 2;
    const screenY = (1 - anchor.y) * height / 2;
    const hitScale = THREE.MathUtils.lerp(.23, 1, pose.approach);
    consoleRoot.style.transformOrigin = '50% 50%';
    consoleRoot.style.transform = `translate3d(${screenX - flightMetrics.x}px,${screenY - flightMetrics.y}px,0) scale(${hitScale})`;
    consoleSlot.style.setProperty('--flight-button', pose.button.toFixed(4));
    // Do not leave a tiny, invisible play button in the keyboard order.
    if (playButton) playButton.inert = pose.button < .95;
    if (deskContact) {
      deskContact.visible = true;
      deskContact.material.opacity = .24 * pose.shadow;
      deskContact.scale.setScalar(1 + pose.lift * .6);
    }
    consoleSlot.dataset.flight = scrollProgress <= .12 ? 'resting' : pose.approach < 1 ? 'flying' : 'arrived';
    consoleSlot.dataset.anchor = `${screenX.toFixed(2)},${screenY.toFixed(2)}`;
    consoleSlot.dataset.flightScale = consoleModel.scale.x.toFixed(4);
    consoleSlot.dataset.flightLift = pose.lift.toFixed(4);
    consoleSlot.dataset.flightTurn = pose.turn.toFixed(4);
    consoleSlot.dataset.flightApproach = pose.approach.toFixed(4);
    consoleSlot.dataset.flightSpace = 'desk-world';
    consoleSlot.dataset.flightReady = 'true';
    delete consoleSlot.dataset.flightLoading;
  }

  function applyLayout(isNarrow) {
    const layout = isNarrow ? MOBILE_LAYOUT : DESKTOP_LAYOUT;
    animated.forEach((item, index) => {
      const config = layout[index];
      item.position.set(...config.position);
      item.scale.setScalar(config.scale);
      item.rotation.set(...config.rotation);
      item.userData.basePosition = new THREE.Vector3(...config.position);
      item.userData.baseRotation = new THREE.Euler(...config.rotation);
      item.userData.motion = config.motion;
      item.userData.scrollX = Math.sign(config.position[0] || (index % 2 ? 1 : -1)) * (.15 + Math.abs(config.position[0]) * .1);
      item.userData.scrollY = ((index % 3) - 1) * .22;
      item.userData.scrollZ = .35 + (index % 4) * .16;
    });
    shadowFloor.position.y = isNarrow ? -2.56 : -1.62;
    shadowFloor.scale.setScalar(isNarrow ? .7 : 1);
  }

  function resize() {
    const width = Math.max(1, stage.clientWidth);
    const height = Math.max(1, stage.clientHeight);
    const isNarrow = width < 640;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.fov = isNarrow ? 42 : 35;
    cameraBaseY = isNarrow ? .15 : .75;
    cameraBaseZ = isNarrow ? 11.5 : 10.7;
    camera.position.set(0, cameraBaseY, cameraBaseZ);
    camera.lookAt(0, isNarrow ? -.1 : .05, 0);
    camera.updateProjectionMatrix();
    if (loaded) applyLayout(isNarrow);
    measureFlight();
    updateScrollDepth();
  }

  function requestDraw() {
    if (!frame && visible && !document.hidden && !worldFailed) frame = requestAnimationFrame(draw);
  }

  function draw(time) {
    frame = 0;
    if (disposed || worldFailed || !visible || document.hidden || !loaded) return;

    const seconds = time / 1000;
    const moving = !reducedMotion.matches;
    animated.forEach((item, index) => {
      const basePosition = item.userData.basePosition;
      const baseRotation = item.userData.baseRotation;
      item.position.x = basePosition.x + (moving ? scrollProgress * item.userData.scrollX : 0);
      item.position.y = basePosition.y + (moving ? Math.sin(seconds * .68 + item.userData.phase) * item.userData.motion + scrollProgress * item.userData.scrollY : 0);
      item.position.z = basePosition.z + (moving ? scrollProgress * item.userData.scrollZ : 0);
      item.rotation.x = baseRotation.x + (moving ? Math.sin(seconds * .31 + index) * .018 : 0);
      item.rotation.y = baseRotation.y + (moving ? Math.sin(seconds * .24 + item.userData.phase) * .045 : 0);
      item.rotation.z = baseRotation.z + (moving ? Math.cos(seconds * .28 + index) * .014 : 0);
    });

    const targetRotationY = moving ? pointerX * .042 : 0;
    const targetRotationX = moving ? pointerY * -.018 : 0;
    world.rotation.y += (targetRotationY - world.rotation.y) * .035;
    world.rotation.x += (targetRotationX - world.rotation.x) * .035;
    world.position.y += ((moving ? scrollDepth * .32 : 0) - world.position.y) * .045;
    world.rotation.z += ((moving ? (scrollProgress - .5) * .035 : 0) - world.rotation.z) * .04;
    camera.position.y += ((moving ? cameraBaseY + scrollProgress * .18 : cameraBaseY) - camera.position.y) * .06;
    camera.position.z += ((moving ? cameraBaseZ - scrollProgress * 1.15 : cameraBaseZ) - camera.position.z) * .06;
    camera.lookAt(0, moving ? scrollProgress * -.08 : 0, 0);

    if (time - lastDraw > 1000 / 30 - 1 || !moving) {
      updateConsoleFlight();
      renderer.render(scene, camera);
      lastDraw = time;
    }
    if (moving) requestDraw();
  }

  function onPointerMove(event) {
    if (!finePointer.matches) return;
    const rect = stage.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width - .5) * 2;
    pointerY = ((event.clientY - rect.top) / rect.height - .5) * 2;
    requestDraw();
  }

  function updateScrollDepth() {
    if (hero) {
      const rect = hero.getBoundingClientRect();
      const travel = Math.max(1, rect.height - (sticky?.clientHeight || innerHeight));
      scrollProgress = reducedMotion.matches ? 0 : THREE.MathUtils.clamp(-rect.top / travel, 0, 1);
      scrollDepth = scrollProgress * 2 - 1;
      hero.style.setProperty('--hero-progress', scrollProgress.toFixed(4));
    } else {
      const rect = root.getBoundingClientRect();
      const centre = rect.top + rect.height / 2;
      scrollDepth = THREE.MathUtils.clamp((innerHeight / 2 - centre) / innerHeight, -1, 1);
      scrollProgress = (scrollDepth + 1) / 2;
    }
    requestDraw();
  }

  async function load() {
    try {
      const entries = Object.entries(MODEL_URLS);
      const results = await Promise.all(entries.map(([, url]) => loader.loadAsync(url)));
      if (disposed) return;

      const models = {};
      entries.forEach(([key], index) => { models[key] = normalise(results[index].scene); });
      DESKTOP_LAYOUT.forEach(config => createCopy(models[config.key], config));

      // Soft contact shadow attached to the same desk coordinates as the device.
      const contactCanvas = document.createElement('canvas');
      contactCanvas.width = contactCanvas.height = 64;
      const contactContext = contactCanvas.getContext('2d');
      const gradient = contactContext.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(83,45,55,.7)');
      gradient.addColorStop(1, 'rgba(83,45,55,0)');
      contactContext.fillStyle = gradient;
      contactContext.fillRect(0, 0, 64, 64);
      const contactTexture = new THREE.CanvasTexture(contactCanvas);
      textures.add(contactTexture);
      const contactGeometry = new THREE.PlaneGeometry(.20, .19);
      const contactMaterial = new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, opacity: .24, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
      geometry.add(contactGeometry);
      materials.add(contactMaterial);
      deskContact = new THREE.Mesh(contactGeometry, contactMaterial);
      deskContact.rotation.x = -Math.PI / 2;
      deskContact.position.copy(deskAnchor);
      deskContact.position.y += .002;
      desk.add(deskContact);

      loaded = true;
      if (!consoleController && consoleSlot) delete consoleSlot.dataset.flightLoading;
      root.dataset.ready = 'true';
      status.textContent = '8種類の3Dモデルで小宇宙を表示しました。';
      resize();
      updateScrollDepth();
      requestDraw();
    } catch {
      worldFailed = true;
      releaseConsolePresentation();
      root.dataset.ready = 'fallback';
      if (consoleSlot) delete consoleSlot.dataset.flightLoading;
      status.textContent = '3Dモデルを読み込めなかったため、写真で表示しています。';
    }
  }

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  if (consoleRoot) resizeObserver.observe(consoleRoot);
  intersectionObserver = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    if (visible) {
      updateScrollDepth();
      requestDraw();
    }
  }, { rootMargin: '220px 0px' });
  intersectionObserver.observe(root);

  stage.addEventListener('pointermove', onPointerMove, { signal });
  stage.addEventListener('pointerleave', () => { pointerX = 0; pointerY = 0; }, { signal });
  document.addEventListener('visibilitychange', requestDraw, { signal });
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    worldFailed = true;
    releaseConsolePresentation();
    root.dataset.ready = 'fallback';
    status.textContent = '3D表示を継続できないため、写真で表示しています。';
    cancelAnimationFrame(frame);
    frame = 0;
  }, { signal });
  window.addEventListener('scroll', updateScrollDepth, { passive: true, signal });
  reducedMotion.addEventListener('change', () => { updateScrollDepth(); requestDraw(); }, { signal });
  load();

  return () => {
    disposed = true;
    aborter.abort();
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    releaseConsolePresentation();
    stopObservingConsole();
    if (consoleModel) scene.remove(consoleModel);
    textures.forEach(texture => texture.dispose());
    materials.forEach(material => material.dispose());
    geometry.forEach(item => item.dispose());
    renderer.dispose();
    renderer.domElement.remove();
    hero?.style.removeProperty('--hero-progress');
    consoleRoot?.style.removeProperty('transform');
    consoleRoot?.style.removeProperty('transform-origin');
    consoleSlot?.style.removeProperty('--flight-button');
    if (consoleSlot) {
      delete consoleSlot.dataset.flightReady;
      delete consoleSlot.dataset.flightLoading;
    }
    if (playButton) playButton.inert = false;
  };
}
