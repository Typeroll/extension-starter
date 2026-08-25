import assert from 'node:assert/strict';
import test from 'node:test';
import { recipientTokenDigest } from '../src/provider/security.js';
import { createMemoryProviderStorage } from '../src/provider/storage.js';

test('recipient tokens are stored as installation-scoped digests', async () => {
  const digest = recipientTokenDigest('com.example.quote-extension', 'recipient-secret');
  const storage = createMemoryProviderStorage([[
    digest,
    { installation_id: 'installation-one', title: 'Quote', total: 'SEK 100', approved: false },
  ]]);

  assert.equal(digest.includes('recipient-secret'), false);
  assert.equal(await storage.quotes.getByRecipientDigest(digest, 'installation-two'), undefined);
  assert.deepEqual(await storage.quotes.getByRecipientDigest(digest, 'installation-one'), {
    installation_id: 'installation-one', title: 'Quote', total: 'SEK 100', approved: false,
  });
  assert.equal((await storage.quotes.approveByRecipientDigest(digest, 'installation-one'))?.approved, true);
});

test('event receipt claims are idempotent', async () => {
  const storage = createMemoryProviderStorage();
  const expires = new Date(Date.now() + 60_000);
  assert.equal(await storage.eventReceipts.claim('event-one', expires), true);
  assert.equal(await storage.eventReceipts.claim('event-one', expires), false);
});
