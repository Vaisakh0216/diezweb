// Hostinger entry file. Hostinger's Node runner (LiteSpeed) loads this file with require(), so it is CommonJS
// and loads the ES-module server (server/index.js, which also serves the built website) with import().
import('./server/index.js').catch((e) => {
  console.error('Server failed to start:', e);
  process.exit(1);
});
