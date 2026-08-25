export interface TrustedIssuerRecord {
  issuer: string;
  jwks: { keys: Array<import('node:crypto').JsonWebKey & { kid?: string; alg?: string }> };
  fingerprint: string;
  updated_at: string;
}

export interface TrustedIssuerRepository {
  get(issuer: string): Promise<TrustedIssuerRecord | undefined>;
  put(record: TrustedIssuerRecord): Promise<void>;
}

export interface EventReceiptRepository {
  /** Atomically records an event ID and returns true only for its first delivery. */
  claim(eventId: string, expiresAt: Date): Promise<boolean>;
}

export interface QuoteRecord {
  installation_id: string;
  title: string;
  total: string;
  approved: boolean;
}

export interface QuoteRepository {
  getByRecipientDigest(digest: string, installationId: string): Promise<QuoteRecord | undefined>;
  approveByRecipientDigest(digest: string, installationId: string): Promise<QuoteRecord | undefined>;
}

export interface ProviderStorage {
  trustedIssuers: TrustedIssuerRepository;
  eventReceipts: EventReceiptRepository;
  quotes: QuoteRepository;
}

export type ProviderStorageFactory = () => ProviderStorage | Promise<ProviderStorage>;

class MemoryTrustedIssuerRepository implements TrustedIssuerRepository {
  readonly #records = new Map<string, TrustedIssuerRecord>();

  async get(issuer: string): Promise<TrustedIssuerRecord | undefined> {
    return this.#records.get(issuer);
  }

  async put(record: TrustedIssuerRecord): Promise<void> {
    this.#records.set(record.issuer, structuredClone(record));
  }
}

class MemoryEventReceiptRepository implements EventReceiptRepository {
  readonly #expires = new Map<string, number>();

  async claim(eventId: string, expiresAt: Date): Promise<boolean> {
    const now = Date.now();
    for (const [id, expiry] of this.#expires) if (expiry <= now) this.#expires.delete(id);
    if (this.#expires.has(eventId)) return false;
    this.#expires.set(eventId, expiresAt.getTime());
    return true;
  }
}

class MemoryQuoteRepository implements QuoteRepository {
  readonly #quotes: Map<string, QuoteRecord>;

  constructor(seed: Iterable<readonly [string, QuoteRecord]> = []) {
    this.#quotes = new Map(seed);
  }

  async getByRecipientDigest(digest: string, installationId: string): Promise<QuoteRecord | undefined> {
    const quote = this.#quotes.get(digest);
    return quote?.installation_id === installationId ? { ...quote } : undefined;
  }

  async approveByRecipientDigest(digest: string, installationId: string): Promise<QuoteRecord | undefined> {
    const quote = this.#quotes.get(digest);
    if (!quote || quote.installation_id !== installationId) return undefined;
    quote.approved = true;
    return { ...quote };
  }
}

/** Development and tests only. Production must inject a durable adapter. */
export function createMemoryProviderStorage(
  quoteSeed: Iterable<readonly [string, QuoteRecord]> = [],
): ProviderStorage {
  return {
    trustedIssuers: new MemoryTrustedIssuerRepository(),
    eventReceipts: new MemoryEventReceiptRepository(),
    quotes: new MemoryQuoteRepository(quoteSeed),
  };
}
