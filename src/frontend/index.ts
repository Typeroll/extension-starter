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

const currency = new Intl.NumberFormat('en', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

export async function mount(
  element: HTMLElement,
  props: QuoteProps,
  context: ExtensionRuntimeContext,
): Promise<void> {
  // Recipient links and public lead capture share one component. The opaque
  // token stays in this mount closure and is never persisted by Typeroll.
  const recipientToken = context.url.consume('quote_token');
  if (recipientToken) {
    await mountRecipientQuote(element, props, context, recipientToken);
    return;
  }
  mountLeadCalculator(element, props, context);
}

function mountLeadCalculator(
  element: HTMLElement,
  props: QuoteProps,
  context: ExtensionRuntimeContext,
): void {
  const shell = document.createElement('section');
  shell.className = 'quote-extension quote-calculator';
  shell.innerHTML = `
    <div class="quote-intro">
      <span class="quote-eyebrow">Instant estimate</span>
      <h2></h2>
      <p>Choose a plan and team size. Get a useful estimate now, then let us tailor the final proposal.</p>
      <div class="quote-estimate" aria-live="polite">
        <span>Estimated monthly price</span>
        <strong data-estimate></strong>
        <small>Excluding VAT. No commitment.</small>
      </div>
    </div>
    <form class="quote-form">
      <div class="quote-field">
        <label for="quote-plan">Plan</label>
        <select id="quote-plan" name="plan">
          <option value="starter">Starter</option>
          <option value="growth" selected>Growth</option>
          <option value="scale">Scale</option>
        </select>
      </div>
      <div class="quote-field quote-field-range">
        <div class="quote-label-row">
          <label for="quote-team-size">Team size</label>
          <output for="quote-team-size" data-team-size>10 people</output>
        </div>
        <input id="quote-team-size" name="team_size" type="range" min="1" max="100" value="10">
      </div>
      <div class="quote-field-grid">
        <div class="quote-field">
          <label for="quote-name">Name</label>
          <input id="quote-name" name="name" autocomplete="name" required>
        </div>
        <div class="quote-field">
          <label for="quote-email">Work email</label>
          <input id="quote-email" name="email" type="email" autocomplete="email" required>
        </div>
      </div>
      <div class="quote-field">
        <label for="quote-company">Company <span>optional</span></label>
        <input id="quote-company" name="company" autocomplete="organization">
      </div>
      <p class="quote-error" role="alert" hidden></p>
      <button class="quote-submit" type="submit">
        <span>Get my estimate</span><span aria-hidden="true">→</span>
      </button>
      <p class="quote-privacy">Your details are stored in this site's Typeroll Forms inbox.</p>
    </form>`;

  const heading = shell.querySelector<HTMLHeadingElement>('h2')!;
  const form = shell.querySelector<HTMLFormElement>('form')!;
  const plan = shell.querySelector<HTMLSelectElement>('#quote-plan')!;
  const teamSize = shell.querySelector<HTMLInputElement>('#quote-team-size')!;
  const teamOutput = shell.querySelector<HTMLOutputElement>('[data-team-size]')!;
  const estimateOutput = shell.querySelector<HTMLElement>('[data-estimate]')!;
  const error = shell.querySelector<HTMLElement>('.quote-error')!;
  const submit = shell.querySelector<HTMLButtonElement>('.quote-submit')!;
  heading.textContent = props.heading || String(context.config.heading_default || 'Find the right plan for your team');

  const estimate = (): number => {
    const people = Number(teamSize.value);
    const pricing = {
      starter: { base: 250, seat: 18 },
      growth: { base: 650, seat: 32 },
      scale: { base: 1400, seat: 48 },
    }[plan.value] ?? { base: 650, seat: 32 };
    return pricing.base + people * pricing.seat;
  };

  const updateEstimate = () => {
    teamOutput.textContent = `${teamSize.value} ${teamSize.value === '1' ? 'person' : 'people'}`;
    estimateOutput.textContent = currency.format(estimate());
  };
  plan.addEventListener('change', updateEstimate);
  teamSize.addEventListener('input', updateEstimate);
  updateEstimate();

  context.navigation.subscribe((view) => {
    if (view !== 'lead-sent') return;
    shell.innerHTML = `
      <div class="quote-success" role="status">
        <span class="quote-success-mark" aria-hidden="true">✓</span>
        <span class="quote-eyebrow">Estimate requested</span>
        <h2>Thank you — your details are on their way.</h2>
        <p>We'll review your estimate and follow up with a tailored proposal.</p>
      </div>`;
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    error.hidden = true;
    submit.disabled = true;
    submit.querySelector('span')!.textContent = 'Sending…';
    try {
      if (!context.forms.has('lead')) throw new Error('Lead form binding is unavailable');
      const data = new FormData(form);
      const result = await context.forms.submit('lead', {
        name: String(data.get('name') || ''),
        email: String(data.get('email') || ''),
        company: String(data.get('company') || ''),
        plan: String(data.get('plan') || ''),
        team_size: Number(data.get('team_size')),
        estimated_monthly_price: estimate(),
        source: 'quote-calculator',
      });
      if (result.ok === false) {
        const messages = result.errors?.map((item) => item.message).filter(Boolean) ?? [];
        throw new Error(messages[0] || 'Please check the details and try again.');
      }
      context.navigation.navigate('lead-sent');
    } catch (cause) {
      error.textContent = cause instanceof Error ? cause.message : 'The estimate could not be sent. Please try again.';
      error.hidden = false;
      submit.disabled = false;
      submit.querySelector('span')!.textContent = 'Get my estimate';
    }
  });

  element.replaceChildren(shell);
}

async function mountRecipientQuote(
  element: HTMLElement,
  props: QuoteProps,
  context: ExtensionRuntimeContext,
  recipientToken: string,
): Promise<void> {
  let quote: Quote | undefined;
  let error: string | undefined;

  async function request(path: string, options?: RequestInit): Promise<Quote> {
    const response = await context.gateway.fetch(path, options);
    if (!response.ok) throw new Error(`Quote API returned ${response.status}`);
    return response.json() as Promise<Quote>;
  }

  function render(view = context.navigation.current): void {
    const shell = document.createElement('section');
    shell.className = 'quote-extension quote-recipient';
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
    } else if (quote) {
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
      message.textContent = 'Loading quote…';
      shell.append(message);
    }
    element.replaceChildren(shell);
  }

  context.navigation.subscribe(render);
  render();
  try {
    quote = await request(`/quotes/current?token=${encodeURIComponent(recipientToken)}`);
  } catch {
    error = 'The quote service is temporarily unavailable.';
  }
  render();
}
