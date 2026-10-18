import { afterEach, expect, it, vi } from 'vitest';
import { assertHostingProbeRuntime } from './hosting-probe';

afterEach(() => vi.unstubAllEnvs());

it('refuses diagnostic mode outside a real Vercel preview or without a strong token', () => {
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
  vi.stubEnv('ARCHWOVEN_MODE', 'hosted');
  vi.stubEnv('ARCHWOVEN_FAKE', '0');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', 'x'.repeat(48));
  expect(() => assertHostingProbeRuntime()).toThrow(/preview/);
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', 'short');
  expect(() => assertHostingProbeRuntime()).toThrow(/token/i);
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', 'x'.repeat(48));
  expect(() => assertHostingProbeRuntime()).not.toThrow();
  vi.stubEnv('VERCEL', '');
  expect(() => assertHostingProbeRuntime()).toThrow(/preview/);
});

it.each([
  ['ARCHWOVEN_MODE', 'local'],
  ['ARCHWOVEN_FAKE', '1'],
])('refuses incompatible %s=%s even when demo startup is acknowledged', (key, value) => {
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE', '1');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('VERCEL_ENV', 'preview');
  vi.stubEnv('ARCHWOVEN_HOSTING_PROBE_TOKEN', 'x'.repeat(48));
  vi.stubEnv('ARCHWOVEN_MODE', 'hosted');
  vi.stubEnv('ARCHWOVEN_FAKE', '0');
  vi.stubEnv('ARCHWOVEN_DEMO_ACK', '1');
  vi.stubEnv(key, value);
  expect(() => assertHostingProbeRuntime()).toThrow(/hosted mode/);
});
