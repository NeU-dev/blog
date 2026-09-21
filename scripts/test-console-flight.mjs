import assert from 'node:assert/strict';
import { consoleFlightProgress } from '../src/lib/console-flight.js';
import { observeConsoleModel, publishConsoleModel } from '../src/lib/console-model-bridge.js';

const resting = { lift: 0, turn: 0, approach: 0, button: 0, shadow: 1 };
for (const progress of [-1, 0, .12]) {
  assert.deepEqual(consoleFlightProgress(progress), resting, `resting at ${progress}`);
}

for (const progress of [.13, .2, .27, .28]) {
  const phase = consoleFlightProgress(progress);
  assert.ok(phase.lift > 0, `lift begins before turning at ${progress}`);
  assert.equal(phase.turn, 0, `back remains parallel to tabletop at ${progress}`);
  assert.equal(phase.approach, 0, `no approach before lifting clear at ${progress}`);
  assert.equal(phase.button, 0, `play button stays hidden at ${progress}`);
}

const arrived = { lift: 1, turn: 1, approach: 1, button: 1, shadow: 0 };
for (const progress of [.9, 1, 2]) {
  assert.deepEqual(consoleFlightProgress(progress), arrived, `arrived at ${progress}`);
}

const epsilon = 1e-12;
const samples = Array.from({ length: 1001 }, (_, index) => index / 1000);
const forward = samples.map(progress => consoleFlightProgress(progress));
for (let index = 0; index < forward.length; index++) {
  const phase = forward[index];
  for (const [name, value] of Object.entries(phase)) {
    assert.ok(Number.isFinite(value), `${name} must be finite at ${samples[index]}`);
    assert.ok(value >= -epsilon && value <= 1 + epsilon,
      `${name} must stay in [0, 1] at ${samples[index]}: ${value}`);
  }
  if (index === 0) continue;
  for (const name of ['lift', 'turn', 'approach', 'button']) {
    assert.ok(phase[name] + epsilon >= forward[index - 1][name],
      `${name} must not move backward during forward scrolling`);
  }
  assert.ok(phase.shadow <= forward[index - 1].shadow + epsilon,
    'tabletop contact shadow must fade during lift and approach');
}

// The trajectory has no time-dependent state: reversing to an earlier scroll
// position must return exactly the same pose, without hysteresis or drift.
for (let index = samples.length - 1; index >= 0; index--) {
  assert.deepEqual(consoleFlightProgress(samples[index]), forward[index]);
}
const reduced = { lift: 0, turn: 1, approach: 1, button: 1, shadow: 0 };
for (const progress of [-1, ...samples, 2]) {
  assert.deepEqual(consoleFlightProgress(progress, true), reduced);
}
console.log('PASS console flight: hold, lift before turn, arrival, bounds, monotonicity, reversal, reduced motion');

const root = {};
const first = { model: {}, camera: {}, resource: { disposed: false } };
const second = { model: {}, camera: {}, resource: { disposed: false } };
const events = [];
const stop = observeConsoleModel(root, controller => events.push(controller));
assert.deepEqual(events, [null], 'subscription must immediately report an unpublished model');

const unpublishFirst = publishConsoleModel(root, first);
assert.deepEqual(events, [null, first]);
const lateEvents = [];
const stopLate = observeConsoleModel(root, controller => lateEvents.push(controller));
assert.deepEqual(lateEvents, [first], 'late subscription must immediately receive the current model');

const unpublishSecond = publishConsoleModel(root, second);
assert.deepEqual(events, [null, first, second]);
unpublishFirst();
assert.deepEqual(events, [null, first, second], 'stale owner teardown must not clear its replacement');

stopLate();
stopLate();
unpublishSecond();
unpublishSecond();
assert.deepEqual(events, [null, first, second, null], 'current teardown reports null exactly once');
assert.deepEqual(lateEvents, [first, second], 'unsubscribed observers must not receive teardown');
stop();
publishConsoleModel(root, first)();
assert.deepEqual(events, [null, first, second, null], 'unsubscribed observers must not receive a new owner');

// Consumer detachment runs synchronously before the owner disposes shared GPU
// resources. Record observations outside assertions: bridge callbacks isolate
// consumer errors and must never conceal a failed test assertion.
const resourceRoot = {};
const shared = { model: {}, resource: { disposed: false } };
const disposalObservations = [];
let lastController = null;
const stopResource = observeConsoleModel(resourceRoot, controller => {
  if (!controller && lastController) disposalObservations.push(lastController.resource.disposed);
  lastController = controller;
});
const unpublishShared = publishConsoleModel(resourceRoot, shared);
unpublishShared();
shared.resource.disposed = true;
assert.deepEqual(disposalObservations, [false], 'consumer must see null before owner resource disposal');
stopResource();

// An observer can synchronously replace the publication. Later observers must
// receive the replacement, never the obsolete value from the outer publish.
const reentrantRoot = {};
let unpublishReplacement;
const stopReplacing = observeConsoleModel(reentrantRoot, controller => {
  if (controller === first) unpublishReplacement = publishConsoleModel(reentrantRoot, second);
});
const reentrantEvents = [];
const stopReentrant = observeConsoleModel(reentrantRoot, controller => reentrantEvents.push(controller));
const unpublishStale = publishConsoleModel(reentrantRoot, first);
assert.deepEqual(reentrantEvents, [null, second]);
unpublishStale();
assert.deepEqual(reentrantEvents, [null, second]);
unpublishReplacement();
assert.deepEqual(reentrantEvents, [null, second, null]);
stopReplacing();
stopReentrant();
console.log('PASS console model bridge: initial value, replacement, unsubscribe, disposal ordering, reentrant publication');
