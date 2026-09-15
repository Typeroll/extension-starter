import assert from 'node:assert/strict';
import test from 'node:test';
import { createSite, createStorageArea } from '../src/local-host/context.js';

test('site navigation preserves paths, queries and fragments and rejects external destinations', () => {
  const visited: string[] = [];
  const site = createSite('https://example.com', (url) => visited.push(url));
  assert.equal(site.url('/contact/?from=quote#form'), 'https://example.com/contact/?from=quote#form');
  site.navigate('/contact/');
  assert.deepEqual(visited, ['https://example.com/contact/']);
  for (const path of ['https://other.test/', '//other.test/', '/\\other.test/', 'contact']) {
    assert.throws(() => site.navigate(path), /root-relative/);
  }
  assert.equal(visited.length, 1);
});

test('storage isolates installations and round trips JSON without retaining object references', () => {
  const data = new Map<string, string>();
  const store = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
  const first = createStorageArea(store, 'first');
  const second = createStorageArea(store, 'second');
  const draft = { count: 2 };
  first.set('draft', draft);
  draft.count = 3;
  assert.deepEqual(first.get('draft'), { count: 2 });
  assert.equal(second.get('draft'), undefined);
  second.set('draft', null);
  first.remove('draft');
  assert.equal(first.get('draft'), undefined);
  assert.equal(second.get('draft'), null);
  data.set('typeroll:extension:first:broken', 'invalid');
  assert.equal(first.get('broken'), undefined);
  for (const key of ['', 'x'.repeat(129)]) assert.throws(() => first.set(key, 1), /1-128/);
  assert.throws(() => first.set('draft', undefined), /JSON-compatible/);
  assert.throws(() => first.set('draft', 'x'.repeat(65536)), /64 KiB/);
  assert.equal(first.get('draft'), undefined);
});

test('storage propagates browser access failures instead of silently losing data', () => {
  const fail = () => { throw new Error('Storage unavailable'); };
  const area = createStorageArea({ getItem: fail, setItem: fail, removeItem: fail }, 'first');
  assert.throws(() => area.get('draft'), /Storage unavailable/);
  assert.throws(() => area.set('draft', 1), /Storage unavailable/);
  assert.throws(() => area.remove('draft'), /Storage unavailable/);
});
