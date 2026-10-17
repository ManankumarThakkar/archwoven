import { describe, expect, it } from 'vitest';
import { localRequestRefusal } from './local-guard';

const h = (entries: Record<string, string>) => new Headers(entries);

describe('localRequestRefusal', () => {
  it.each([
    ['localhost with port', { host: 'localhost:3000' }],
    ['IPv4 loopback', { host: '127.0.0.1:3031' }],
    ['IPv6 loopback', { host: '[::1]:3000' }],
    ['same-origin fetch', { host: '127.0.0.1:3031', origin: 'http://127.0.0.1:3031', 'sec-fetch-site': 'same-origin' }],
    ['direct navigation without fetch metadata', { host: 'localhost:3000', 'sec-fetch-site': 'none' }],
  ])('allows %s in local mode', (_name, headers) => {
    expect(localRequestRefusal(h(headers), 'local')).toBeNull();
  });

  it.each([
    ['a DNS-rebinding host', { host: 'evil.example:3000' }, /addressed to localhost/],
    ['a LAN address', { host: '192.168.1.20:3000' }, /addressed to localhost/],
    ['a lookalike host', { host: 'localhost.evil.example' }, /addressed to localhost/],
    ['a missing host', {}, /addressed to localhost/],
    ['a cross-site origin', { host: 'localhost:3000', origin: 'https://evil.example' }, /Cross-site requests/],
    ['an origin on another local port', { host: 'localhost:3000', origin: 'http://localhost:8080' }, /Cross-site requests/],
    ['a null origin', { host: 'localhost:3000', origin: 'null' }, /Cross-site requests/],
    ['cross-site fetch metadata', { host: 'localhost:3000', 'sec-fetch-site': 'cross-site' }, /Cross-site requests/],
  ])('refuses %s in local mode', (_name, headers, message) => {
    expect(localRequestRefusal(h(headers), 'local')).toMatch(message);
  });

  it('never interferes with hosted deployments', () => {
    expect(localRequestRefusal(h({ host: 'archwoven.example', origin: 'https://elsewhere.example' }), undefined)).toBeNull();
    expect(localRequestRefusal(h({ host: 'archwoven.example' }), 'hosted')).toBeNull();
  });
});
