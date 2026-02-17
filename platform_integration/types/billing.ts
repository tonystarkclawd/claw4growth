/**
 * Billing types for Stripe integration
 */

export type SubscriptionTier = 'free' | 'pro' | 'enterprise';

export interface Subscription {
    id: string;
    user_id: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
    stripe_price_id: string | null;
    status: 'active' | 'canceled' | 'past_due' | 'unpaid';
    tier: SubscriptionTier;
    current_period_start: string | null;
    current_period_end: string | null;
    created_at: string;
    updated_at: string;
}

export interface BillingInfo {
    subscription: Subscription | null;
    isActive: boolean;
}

/**
 * Checks if the subscription status grants provisioning access.
 * Accepts either a status string or a full Subscription object.
 */
export function shouldProvisionAccess(statusOrSub: string | Subscription | null): boolean {
    if (!statusOrSub) return false;
    if (typeof statusOrSub === 'string') {
        return statusOrSub === 'active';
    }
    return statusOrSub.status === 'active';
}
