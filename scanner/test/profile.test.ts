import { describe, expect, it } from 'vitest';
import { profileFor, assertAllowed } from '../src/profile.js';
import { getAdapters } from '../src/adapters/registry.js';
import { CrtShAdapter } from '../src/adapters/crtsh.js';
import { ForbiddenProfileError } from '../src/errors.js';
import type { Adapter } from '../src/adapters/types.js';

describe('profile gating', () => {
  it('self + active_confirmed => active', () => {
    expect(profileFor('self', true)).toBe('active');
    expect(profileFor('subsidiary', true)).toBe('active');
  });
  it('unconfirmed or third-party => passive', () => {
    expect(profileFor('self', false)).toBe('passive');
    expect(profileFor('subsidiary', false)).toBe('passive');
    expect(profileFor('supplier', true)).toBe('passive');
    expect(profileFor('partner', true)).toBe('passive');
    expect(profileFor('watch', true)).toBe('passive');
  });

  it('offline registry returns only the fixtures adapter', () => {
    const a = getAdapters('passive', { offline: true });
    expect(a).toHaveLength(1);
    expect(a[0]!.name).toBe('offline');
  });

  it('crt.sh is passive-safe and non-authoritative', () => {
    const c = new CrtShAdapter();
    expect(c.supportsProfile('passive')).toBe(true);
    expect(c.authoritative).toBe(false);
  });

  it('assertAllowed throws for an active-only adapter under passive', () => {
    const activeOnly: Adapter = {
      name: 'fake-active',
      requiresKey: false,
      authoritative: true,
      supportsProfile: (p) => p === 'active',
      fetch: async () => [],
    };
    expect(() => assertAllowed(activeOnly, 'passive')).toThrow(ForbiddenProfileError);
    expect(() => assertAllowed(activeOnly, 'active')).not.toThrow();
  });
});
