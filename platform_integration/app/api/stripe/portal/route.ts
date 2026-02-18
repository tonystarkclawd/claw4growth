import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { getAuthUser } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/supabase/billing-db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover',
});

/**
 * POST /api/stripe/portal
 *
 * Creates a Stripe Billing Portal session for the authenticated user.
 * Returns { url } — the frontend redirects to this URL.
 *
 * The portal handles both "Manage" and "Cancel" flows.
 */
export async function POST(request: Request) {
    const user = await getAuthUser(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const subscription = await getUserSubscription(user.id);
    if (!subscription?.stripe_customer_id) {
        return NextResponse.json(
            { error: 'No active subscription found' },
            { status: 404 }
        );
    }

    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: subscription.stripe_customer_id,
            return_url: 'https://claw4growth.com/dashboard/',
        });

        return NextResponse.json({ url: session.url });
    } catch (err) {
        console.error('Stripe portal error:', err);
        return NextResponse.json(
            { error: 'Failed to create portal session' },
            { status: 500 }
        );
    }
}
