import assert from 'node:assert/strict';
import test from 'node:test';
import { createNavigation, createUrlContext } from '../src/runtime.js';

test('opaque URL context is consumed once and remains in the mount closure during navigation', () => {
  const url = createUrlContext({ quote_token: 'recipient-token' });
  const token = url.consume('quote_token');
  const navigation = createNavigation();
  const observed: string[] = [];
  navigation.subscribe((view) => observed.push(view));

  navigation.navigate('details');
  navigation.navigate('confirmation');

  assert.equal(token, 'recipient-token');
  assert.equal(url.has('quote_token'), false);
  assert.equal(navigation.current, 'confirmation');
  assert.deepEqual(observed, ['details', 'confirmation']);
});

test('navigation ignores empty and repeated views', () => {
  const navigation = createNavigation();
  const observed: string[] = [];
  navigation.subscribe((view) => observed.push(view));

  navigation.navigate(' ');
  navigation.navigate('root');
  navigation.navigate('details');
  navigation.navigate('details');

  assert.deepEqual(observed, ['details']);
});
