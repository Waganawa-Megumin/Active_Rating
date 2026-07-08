// Active Rating — @ar/shared barrel. Single source of truth imported byte-for-byte
// by both the scanner (sign/normalize) and the worker (verify/diff).

export * from './types.js';
export * from './hmac.js';
export * from './identity.js';
export * from './normalize.js';
export * from './severity.js';
export * from './confidence.js';
export * from './config/weights.js';
export * from './schema/ingest.js';
export * from './schema/admin.js';
