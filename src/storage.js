import storage from "node-persist";

export async function initStorage() {
  await storage.init({
    dir: "data",
    stringify: JSON.stringify,
    parse: JSON.parse,
  });
}

export async function getItem(key) {
  return storage.getItem(key);
}

export async function setItem(key, value) {
  return storage.setItem(key, value);
}

export async function removeItem(key) {
  return storage.removeItem(key);
}

export async function listKeys() {
  return storage.keys();
}

export async function pushToArray(key, value) {
  const existing = (await storage.getItem(key)) || [];
  existing.push(value);
  await storage.setItem(key, existing);
  return existing;
}

export async function upsertById(key, id, updater) {
  const list = (await storage.getItem(key)) || [];
  const index = list.findIndex((i) => i.id === id);
  if (index === -1) {
    const created = updater(null);
    list.push(created);
    await storage.setItem(key, list);
    return created;
  }
  const updated = updater(list[index]);
  list[index] = updated;
  await storage.setItem(key, list);
  return updated;
}
