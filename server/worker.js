'use strict';
/* Worker thread: runs one scenario pipeline and streams progress to the main thread. */
const { parentPort, workerData } = require('worker_threads');
const { runPipeline } = require('./pipeline.js');

runPipeline(workerData.req, (p) => parentPort.postMessage({ type: 'progress', p }))
  .then((meta) => parentPort.postMessage({ type: 'done', meta }))
  .catch((err) => parentPort.postMessage({ type: 'error', error: err && err.message ? err.message : String(err), stack: err && err.stack }));
