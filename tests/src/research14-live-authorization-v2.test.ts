// Keep offline authorization-admission checks in the normal compiled test route.
await import(
  new URL('../research14-live-authorization-v2.test.mjs', import.meta.url).href
);
export {};
