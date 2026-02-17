import { NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: '2026-01-28.clover',
});

/**
 * GET /api/checkout-public
 *
 * Creates a Stripe Checkout session and redirects the user.
 * Called from the onboarding flow when user clicks "Pay".
 *
 * Query params:
 *   - email (optional): pre-fill customer email
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get('email') || undefined;

    // Determine base URL for redirects
    const origin = request.headers.get('origin')
        || request.headers.get('referer')?.replace(/\/[^/]*$/, '')
        || 'https://claw4growth.com';

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            line_items: [
                {
                    price: process.env.STRIPE_PRICE_ID!,
                    quantity: 1,
                },
            ],
            ...(email && { customer_email: email }),
            success_url: `${origin}/onboarding/?step=payment-success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${origin}/onboarding/?step=payment`,
            metadata: {
                source: 'onboarding',
            },
        });

        // Redirect to Stripe Checkout
        return NextResponse.redirect(session.url!, 303);
    } catch (error: unknown) {
        console.error('Stripe checkout error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'Failed to create checkout session', details: message },
            { status: 500 }
        );
    }
}
