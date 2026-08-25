import assert from 'node:assert/strict';
import test from 'node:test';
import { createForms, createNavigation, createUrlContext } from '../src/runtime.js';

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

test('local Forms context exposes only declared bindings', async () => {
  const forms = createForms(['lead'], async (bindingId, data) => ({
    ok: bindingId === 'lead' && data.email === 'ada@example.com',
    done: true,
  }));

  assert.deepEqual(forms.list(), ['lead']);
  assert.equal(forms.has('lead'), true);
  assert.deepEqual(await forms.submit('lead', { email: 'ada@example.com' }), { ok: true, done: true });
  await assert.rejects(forms.submit('another-form', {}), /Unknown Extension form binding/);
});
