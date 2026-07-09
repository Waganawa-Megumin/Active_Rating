import { describe, expect, it } from 'vitest';
import { findingForAsset, slaDue, identityOf } from '../src/index.js';

describe('findingForAsset', () => {
  it('email: missing DMARC is high, p=none is med, enforced is clean', () => {
    expect(findingForAsset('email', { dmarc: null, spf: 'strict' })?.severity).toBe('high');
    expect(findingForAsset('email', { dmarc: 'none', spf: 'strict' })?.severity).toBe('med');
    expect(findingForAsset('email', { dmarc: 'reject', spf: 'strict' })).toBeNull();
    const weak = findingForAsset('email', { dmarc: 'reject', spf: null });
    expect(weak?.severity).toBe('low');
    expect(weak?.vector).toBe('email');
  });

  it('exposure leaks bucket → critical credential finding', () => {
    const f = findingForAsset('exposure', { bucket: 'leaks' });
    expect(f?.severity).toBe('critical');
    expect(f?.vector).toBe('credential');
  });

  it('inventory-only assets produce no finding', () => {
    expect(findingForAsset('subdomain', {})).toBeNull();
    expect(findingForAsset('dns', {})).toBeNull();
  });

  it('slaDue returns a future date for actionable severities, null for info', () => {
    expect(slaDue('2026-01-01T00:00:00.000Z', 'info')).toBeNull();
    expect(slaDue('2026-01-01T00:00:00.000Z', 'high')).toBe('2026-01-08T00:00:00.000Z');
  });

  it('email identity is stable', () => {
    expect(identityOf('email', { domain: 'NEC.com.' })).toBe('email:nec.com');
  });
});
