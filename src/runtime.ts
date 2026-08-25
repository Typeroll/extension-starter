export interface ExtensionUrlContext {
  get(name: string): string | undefined;
  has(name: string): boolean;
  consume(name: string): string | undefined;
}

export interface ExtensionNavigation {
  readonly current: string;
  navigate(view: string): void;
  subscribe(listener: (view: string) => void): () => void;
}

export interface ExtensionGateway {
  fetch(resource: string, options?: RequestInit): Promise<Response>;
}

export interface ExtensionFormError {
  field: string | null;
  code: string;
  message: string;
}

export interface ExtensionFormResult {
  ok: boolean;
  done?: boolean;
  next_step?: string;
  state?: string;
  html?: string;
  errors?: ExtensionFormError[];
}

export interface ExtensionForms {
  has(bindingId: string): boolean;
  list(): string[];
  submit(bindingId: string, data: Record<string, unknown>): Promise<ExtensionFormResult>;
}

export interface ExtensionRuntimeContext {
  protocol_version: number;
  runtime_version: string;
  installation_id: string;
  extension_id: string;
  component_id: string;
  config: Record<string, unknown>;
  url: ExtensionUrlContext;
  navigation: ExtensionNavigation;
  gateway: ExtensionGateway;
  forms: ExtensionForms;
}

export function createUrlContext(values: Record<string, string>): ExtensionUrlContext {
  const available = new Map(Object.entries(values));
  return {
    get: (name) => available.get(name),
    has: (name) => available.has(name),
    consume(name) {
      const value = available.get(name);
      available.delete(name);
      return value;
    },
  };
}

export function createNavigation(initial = 'root'): ExtensionNavigation {
  let current = initial;
  const listeners = new Set<(view: string) => void>();
  return {
    get current() {
      return current;
    },
    navigate(view) {
      const next = view.trim();
      if (!next || next === current) return;
      current = next;
      for (const listener of listeners) listener(current);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createForms(
  bindingIds: readonly string[],
  submitter: (bindingId: string, data: Record<string, unknown>) => Promise<ExtensionFormResult>,
): ExtensionForms {
  const available = new Set(bindingIds);
  return {
    has: (bindingId) => available.has(bindingId),
    list: () => [...available],
    submit(bindingId, data) {
      if (!available.has(bindingId)) return Promise.reject(new Error('Unknown Extension form binding'));
      return submitter(bindingId, data);
    },
  };
}
