// Include the shared, author-visible calibration in the normal compiled test suite.
// The standalone file also remains runnable by the documented targeted command.
await import(
  new URL('../discovery-finding-semantics.test.mjs', import.meta.url).href
);

export {};
