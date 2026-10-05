// Run in one process so Windows does not require child-process spawning.
await import('./security.test.mjs');
await import('./http.test.mjs');
