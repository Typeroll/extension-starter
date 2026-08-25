import './index.css';
import type { ExtensionRuntimeContext } from '../runtime.js';

interface QuoteProps {
  heading?: string;
}

interface Quote {
  title: string;
  total: string;
  approved: boolean;
}

export async function mount(
  element: HTMLElement,
  props: QuoteProps,
  context: ExtensionRuntimeContext,
): Promise<void> {
  // Capture once. Internal navigation keeps this value in the mount closure.
  const recipientToken = context.url.consume('quote_token');
  let quote: Quote | undefined;
  let error: string | undefined;

  async function request(path: string, options?: RequestInit): Promise<Quote> {
    const response = await context.gateway.fetch(path, options);
    if (!response.ok) throw new Error(`Quote API returned ${response.status}`);
    return response.json() as Promise<Quote>;
  }

  function render(view = context.navigation.current): void {
    const shell = document.createElement('section');
    shell.className = 'quote-extension';

    const heading = document.createElement('h2');
    heading.textContent = props.heading || String(context.config.heading_default || 'Your quote');
    shell.append(heading);

    if (error) {
      const message = document.createElement('p');
      message.role = 'alert';
      message.textContent = error;
      shell.append(message);
    } else if (view === 'approved') {
      const message = document.createElement('p');
      message.textContent = 'Thank you. The quote has been approved.';
      shell.append(message);
    } else if (quote && recipientToken) {
      const summary = document.createElement('p');
      summary.textContent = `${quote.title}: ${quote.total}`;
      shell.append(summary);

      const approve = document.createElement('button');
      approve.type = 'button';
      approve.textContent = 'Approve quote';
      approve.addEventListener('click', async () => {
        approve.disabled = true;
        try {
          await request('/quotes/approve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: recipientToken }),
          });
          context.navigation.navigate('approved');
        } catch {
          error = 'The quote could not be approved. Please try again.';
          render();
        }
      });
      shell.append(approve);
    } else {
      const message = document.createElement('p');
      message.textContent = recipientToken
        ? 'Loading quote…'
        : 'Open a recipient-specific link to view a quote.';
      shell.append(message);
    }

    element.replaceChildren(shell);
  }

  context.navigation.subscribe(render);
  render();

  if (!recipientToken) return;
  try {
    quote = await request(`/quotes/current?token=${encodeURIComponent(recipientToken)}`);
  } catch {
    error = 'The quote service is temporarily unavailable.';
  }
  render();
}
