import Stripe from 'stripe';
import type { PaymentOrderRecord } from './types.js';

let stripeClient: Stripe | null = null;

export function getStripeSecretKey() {
  return (
    process.env.METROVAN_STRIPE_SECRET_KEY?.trim() ||
    process.env.STRIPE_SECRET_KEY?.trim() ||
    ''
  );
}

export function getStripeWebhookSecret() {
  return (
    process.env.METROVAN_STRIPE_WEBHOOK_SECRET?.trim() ||
    process.env.STRIPE_WEBHOOK_SECRET?.trim() ||
    ''
  );
}

export function getStripeCurrency() {
  return (
    process.env.METROVAN_STRIPE_CURRENCY?.trim().toLowerCase() ||
    process.env.STRIPE_CURRENCY?.trim().toLowerCase() ||
    'usd'
  );
}

export function isStripeConfigured() {
  return Boolean(getStripeSecretKey());
}

function isStripeAutomaticTaxEnabled() {
  const value = (
    process.env.METROVAN_STRIPE_AUTOMATIC_TAX ??
    process.env.STRIPE_AUTOMATIC_TAX ??
    'false'
  )
    .trim()
    .toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

export function getStripeClient() {
  const secretKey = getStripeSecretKey();
  if (!secretKey) {
    throw new Error('Stripe is not configured. Set METROVAN_STRIPE_SECRET_KEY.');
  }

  if (!stripeClient) {
    stripeClient = new Stripe(secretKey);
  }

  return stripeClient;
}

export function constructStripeWebhookEvent(input: { rawBody: Buffer; signature: string }) {
  const webhookSecret = getStripeWebhookSecret();
  if (!webhookSecret) {
    throw new Error('Stripe webhook secret is not configured. Set METROVAN_STRIPE_WEBHOOK_SECRET.');
  }

  return getStripeClient().webhooks.constructEvent(input.rawBody, input.signature, webhookSecret);
}

export async function createStripeCheckoutSession(input: {
  order: PaymentOrderRecord;
  successUrl: string;
  cancelUrl: string;
}) {
  const metadata = {
    metrovanOrderId: input.order.id,
    userId: input.order.userId,
    userKey: input.order.userKey,
    packageId: input.order.packageId
  };

  return await getStripeClient().checkout.sessions.create({
    mode: 'payment',
    client_reference_id: input.order.id,
    customer_email: input.order.email,
    customer_creation: 'always',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata,
    payment_intent_data: {
      metadata
    },
    invoice_creation: {
      enabled: true,
      invoice_data: {
        description: `Metrovan AI credits - ${input.order.packageName}`,
        footer: 'Payment, receipt, and invoice are processed by Stripe.',
        metadata
      }
    },
    custom_text: {
      submit: {
        message:
          'Secure payment is processed by Stripe. After payment, Stripe will provide the official receipt and invoice download link.'
      }
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.order.currency || getStripeCurrency(),
          unit_amount: Math.round(input.order.amountUsd * 100),
          product_data: {
            name: `Metrovan AI credits - ${input.order.packageName}`,
            description: `${input.order.points} photo credits`,
            metadata
          }
        }
      }
    ],
    automatic_tax: {
      enabled: isStripeAutomaticTaxEnabled()
    }
  });
}
