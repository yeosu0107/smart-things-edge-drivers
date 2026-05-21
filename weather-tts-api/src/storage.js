function createMemoryStorage() {
  let value = null;
  return {
    async load() { return value; },
    async save(v) { value = v; },
  };
}

function createKVStorage(kv) {
  return {
    async load() { return await kv.get('default', { type: 'json' }); },
    async save(v) { await kv.put('default', JSON.stringify(v)); },
  };
}

export { createMemoryStorage, createKVStorage };
