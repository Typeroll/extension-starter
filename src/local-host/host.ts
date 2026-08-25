import { mount } from '../frontend/index.js';
import { createForms, createNavigation, createUrlContext } from '../runtime.js';

const root = document.querySelector<HTMLElement>('#extension-root');
if (!root) throw new Error('Missing local Extension mount');

const url = new URL(window.location.href);
const token = url.searchParams.get('quote');
if (token) {
  url.searchParams.delete('quote');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

const providerPort = import.meta.env.VITE_PROVIDER_PORT || '8787';

await mount(root, { heading: 'Your local quote' }, {
  protocol_version: 1,
  runtime_version: '0.36.0',
  installation_id: 'local-installation',
  extension_id: 'com.example.quote-extension',
  component_id: 'quote',
  config: { heading_default: 'Your quote' },
  url: createUrlContext(token ? { quote_token: token } : {}),
  navigation: createNavigation(),
  gateway: {
    fetch(resource, options) {
      const path = resource.startsWith('/') ? resource : `/${resource}`;
      return fetch(`http://127.0.0.1:${providerPort}/typeroll${path}`, options);
    },
  },
  forms: createForms(['lead'], async () => ({ ok: true, done: true })),
});
