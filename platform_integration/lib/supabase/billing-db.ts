/**
 * Billing database operations (Stripe sync)
 */

import { createClient } from '@supabase/supabase-js';
import type { Subscription } from '@/types/billing';

const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function getUserSubscription(userId: string): Promise<Subscription | null> {
    const { data } = await supabaseAdmin
        .from('c4g_subscriptions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    return data || null;
}

export async function getSubscriptionStatusByUserId(userId: string): Promise<string | null> {
    const sub = await getUserSubscription(userId);
    return sub?.status ?? null;
}

export async function getSubscriptionTierByUserId(userId: string): Promise<string | null> {
    // For MVP, all paying users are on the same "pro" tier
    const sub = await getUserSubscription(userId);
    if (!sub || sub.status !== 'active') return null;
    return 'pro';
}

export async function upsertSubscription(sub: Partial<Subscription> & { user_id: string }) {
    const { error } = await supabaseAdmin
        .from('c4g_subscriptions')
        .upsert(sub, { onConflict: 'user_id' });

    if (error) throw error;
}
