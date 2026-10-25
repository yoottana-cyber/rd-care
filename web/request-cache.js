// Short-lived, in-memory request cache for non-sensitive reference lookups.
// Never persist roster data in localStorage or CacheStorage via this helper.
export function createRequestCache({now=()=>Date.now(), ttlMs=120_000}={}) {
  const entries = new Map();
  return {
    get(key, load) {
      const existing = entries.get(key);
      if(existing?.promise) return existing.promise;
      if(existing && now()-existing.at < ttlMs) return Promise.resolve(existing.value);
      let promise;
      promise=Promise.resolve().then(load).then(value=>{
        if(entries.get(key)?.promise===promise) entries.set(key,{value,at:now()});
        return value;
      },error=>{
        if(entries.get(key)?.promise===promise) entries.delete(key);
        throw error;
      });
      entries.set(key,{promise});
      return promise;
    },
    invalidate(key) {entries.delete(key);},
    clear() {entries.clear();}
  };
}
