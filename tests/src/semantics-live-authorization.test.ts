// Keep offline authorization-admission checks in the normal compiled test route.
await import(
  new URL('../semantics-live-authorization.test.mjs', import.meta.url).href
);
export {};
