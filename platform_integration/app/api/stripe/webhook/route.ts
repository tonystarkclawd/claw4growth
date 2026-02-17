/**
 * POST /api/stripe/webhook
 *
 * Handles Stripe webhook events:
 * - checkout.session.completed → creates subscription record
 * - customer.subscription.updated → syncs status changes
 * - customer.subscription.deleted → marks as canceled
 */

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';
import { upsertSubscription } from '@/lib/supabase/billing-db';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-01-28.clover',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

/**
 * Look up the Supabase user_id by email (from Stripe customer).
 */
async function getUserIdByEmail(email: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('auth.users')
    .select('id')
    .eq('email', email)
    .single();

  if (data) return data.id;

  // Fallback: use admin API to list users by email
  const { data: { users } } = await supabaseAdmin.auth.admin.listUsers();
  const user = users.find(u => u.email === email);
  return user?.id ?? null;
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get('stripe-signature');

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid signature';
    console.error('[stripe-webhook] Signature verification failed:', message);
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerEmail = session.customer_email || session.customer_details?.email;
        const customerId = session.customer as string;
        const subscriptionId = session.subscription as string;

        if (!customerEmail) {
          console.error('[stripe-webhook] No customer email in checkout session');
          break;
        }

        // Find user by email
        const userId = await getUserIdByEmail(customerEmail);
        if (!userId) {
          console.error('[stripe-webhook] No Supabase user for email:', customerEmail);
          break;
        }

        // Fetch the subscription details from Stripe
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const firstItem = subscription.items.data[0];

        await upsertSubscription({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          stripe_price_id: firstItem?.price.id || null,
          status: 'active',
          current_period_start: firstItem?.current_period_start
            ? new Date(firstItem.current_period_start * 1000).toISOString()
            : new Date().toISOString(),
          current_period_end: firstItem?.current_period_end
            ? new Date(firstItem.current_period_end * 1000).toISOString()
            : null,
        });

        console.log(`[stripe-webhook] Subscription created for user ${userId}`);
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Find subscription by stripe_subscription_id
        const { data: existingSub } = await supabaseAdmin
          .from('c4g_subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (existingSub) {
          const item = subscription.items.data[0];
          await upsertSubscription({
            user_id: existingSub.user_id,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscription.id,
            status: subscription.status === 'active' ? 'active' : subscription.status === 'past_due' ? 'past_due' : 'unpaid',
            current_period_start: item?.current_period_start
              ? new Date(item.current_period_start * 1000).toISOString()
              : undefined,
            current_period_end: item?.current_period_end
              ? new Date(item.current_period_end * 1000).toISOString()
              : undefined,
          });
          console.log(`[stripe-webhook] Subscription updated for user ${existingSub.user_id}`);
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        const { data: existingSub } = await supabaseAdmin
          .from('c4g_subscriptions')
          .select('user_id')
          .eq('stripe_subscription_id', subscription.id)
          .single();

        if (existingSub) {
          await upsertSubscription({
            user_id: existingSub.user_id,
            status: 'canceled',
          });
          console.log(`[stripe-webhook] Subscription canceled for user ${existingSub.user_id}`);
        }
        break;
      }

      default:
        console.log(`[stripe-webhook] Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error('[stripe-webhook] Error processing event:', err);
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
