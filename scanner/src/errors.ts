// Active Rating — scanner error types.

/** Thrown by keyed adapters not yet implemented in this phase. */
export class NotImplementedError extends Error {
  constructor(adapter: string) {
    super(`adapter "${adapter}" is not implemented in this phase`);
    this.name = 'NotImplementedError';
  }
}

/** Thrown when an active-only technique is attempted under a passive profile. */
export class ForbiddenProfileError extends Error {
  constructor(adapter: string, profile: string) {
    super(`adapter "${adapter}" may not run under profile "${profile}" (active scan forbidden)`);
    this.name = 'ForbiddenProfileError';
  }
}
