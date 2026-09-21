// Keep the console's geometry, materials and live LCD texture owned by its
// original renderer while allowing the desk scene to display the same model.
const consoles = new WeakMap();

function entryFor(root) {
  let entry = consoles.get(root);
  if (!entry) {
    entry = { controller: null, owner: null, listeners: new Set() };
    consoles.set(root, entry);
  }
  return entry;
}

function callListener(listener, controller) {
  try {
    listener(controller);
  } catch (error) {
    // A secondary scene must not interrupt publication or resource teardown.
    console.error('Unable to update the shared console model.', error);
  }
}

function notify(entry, owner) {
  for (const listener of [...entry.listeners]) {
    // A listener may unsubscribe or synchronously publish a replacement.
    if (entry.owner !== owner) break;
    if (entry.listeners.has(listener)) callListener(listener, entry.controller);
  }
}

function forgetEmpty(root, entry) {
  if (!entry.controller && !entry.listeners.size && consoles.get(root) === entry) {
    consoles.delete(root);
  }
}

export function publishConsoleModel(root, controller) {
  const entry = entryFor(root);
  const owner = {};
  entry.controller = controller;
  entry.owner = owner;
  notify(entry, owner);
  return () => {
    // A stale renderer must not unpublish a newer renderer for the same root.
    if (entry.owner !== owner) return;
    entry.controller = null;
    entry.owner = null;
    notify(entry, null);
    forgetEmpty(root, entry);
  };
}

export function observeConsoleModel(root, callback) {
  const entry = entryFor(root);
  entry.listeners.add(callback);
  callListener(callback, entry.controller);
  return () => {
    entry.listeners.delete(callback);
    forgetEmpty(root, entry);
  };
}
