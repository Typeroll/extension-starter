import { createMemoryProviderStorage } from '../../src/provider/storage.js';
import { recipientTokenDigest } from '../../src/provider/security.js';
export const storage = createMemoryProviderStorage([[recipientTokenDigest('com.example.quote-extension', 'synthetic-recipient'), {
  installation_id: 'install-1', title: 'Synthetic quote', total: 'EUR 100', approved: false,
}]]);
export const createProviderStorage = () => storage;
