import Stripe from "stripe";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { ENV } from "./_core/env";
import { claimStripeWebhookEvent, fulfillStripeCheckout } from "./db";

export const CREDIT_PACKS = [
  { id: "starter", name: "Starter credits", credits: 10, amountCents: 1200, description: "A small boost for your next drop." },
  { id: "studio", name: "Studio credits", credits: 30, amountCents: 2900, description: "For sellers with a weekly rhythm." },
  { id: "pro", name: "Pro credits", credits: 80, amountCents: 6900, description: "More room to create, clean and publish." },
] as const;

let stripeClient: Stripe | null = null;

export function getStripeClient() {
  if (!ENV.stripeSecretKey) return null;
  stripeClient ??= new Stripe(ENV.stripeSecretKey, { apiVersion: "2026-08-26.dahlia" });
  return stripeClient;
}

export function isCreditEligiblePaymentStatus(status: Stripe.Checkout.Session.PaymentStatus | null | undefined) {
  return status === "paid" || status === "no_payment_required";
}

export async function createCreditCheckout(options: {
  userId: number;
  email?: string | null;
  name?: string | null;
  packId: string;
  origin: string;
}) {
  const pack = CREDIT_PACKS.find((item) => item.id === options.packId);
  if (!pack) throw new Error("Credit pack not found.");
  const stripe = getStripeClient();
  if (!stripe) throw new Error("Stripe is not configured yet. Add Stripe keys in Settings → Payment.");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "aud",
        unit_amount: pack.amountCents,
        product_data: { name: `Fingerprints ${pack.name}`, description: `${pack.credits} creative credits` },
      },
    }],
    customer_email: options.email ?? undefined,
    client_reference_id: String(options.userId),
    metadata: {
      user_id: String(options.userId),
      customer_email: options.email ?? "",
      customer_name: options.name ?? "",
      pack_id: pack.id,
      credits: String(pack.credits),
    },
    allow_promotion_codes: true,
    integration_identifier: `fingerprints_${pack.id}_${randomBytes(12).toString("base64").replace(/[^A-Za-z]/g, "").slice(0, 8).padEnd(8, "x")}`,
    success_url: `${options.origin}/?checkout=success&pack=${pack.id}`,
    cancel_url: `${options.origin}/?checkout=cancelled`,
  });
  return { url: session.url, sessionId: session.id, pack };
}

export async function handleStripeWebhook(req: Request, res: Response) {
  try {
    const stripe = getStripeClient();
    if (!stripe || !ENV.stripeWebhookSecret) {
      return res.status(503).json({ error: "Stripe webhook is not configured." });
    }
    let event: Stripe.Event;
    try {
      const signature = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(req.body, signature as string, ENV.stripeWebhookSecret);
    } catch (error) {
      console.error("[Stripe] Webhook signature verification failed", error);
      return res.status(400).json({ error: "Invalid signature" });
    }
    const checkoutEvent = event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded";
    const session = checkoutEvent ? event.data.object as Stripe.Checkout.Session : undefined;

    const fulfillsCredits = isCreditEligiblePaymentStatus(session?.payment_status);
    if (session && fulfillsCredits) {
      const userId = Number(session.metadata?.user_id ?? session.client_reference_id);
      const pack = CREDIT_PACKS.find((item) => item.id === session.metadata?.pack_id);
      if (!Number.isInteger(userId) || userId <= 0 || !pack) {
        throw new Error(`Stripe checkout ${session.id} is missing valid user or pack metadata.`);
      }
      const granted = await fulfillStripeCheckout({ sessionId: session.id, userId, credits: pack.credits });
      console.log("[Stripe] Checkout credits processed", { id: event.id, sessionId: session.id, granted, packId: pack.id, paymentStatus: session.payment_status });
    } else if (session) {
      console.log("[Stripe] Checkout received before payment", { id: event.id, sessionId: session.id, paymentStatus: session.payment_status });
    }
    const isNewEvent = await claimStripeWebhookEvent({ eventId: event.id, sessionId: session?.id ?? null, eventType: event.type });
    if (!isNewEvent) return res.json({ received: true, duplicate: true });
    return res.json({ received: true });
  } catch (error) {
    console.error("[Stripe] Webhook processing failed", error);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
