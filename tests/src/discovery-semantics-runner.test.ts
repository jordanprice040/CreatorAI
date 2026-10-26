// Route the shared runner admission/stop checks through the normal compiled suite.
await import(
  new URL('../discovery-semantics-runner.test.mjs', import.meta.url).href
);
export {};
