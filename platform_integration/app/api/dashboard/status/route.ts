import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/server';
import { getUserSubscription } from '@/lib/supabase/billing-db';
import { createClient } from '@supabase/supabase-js';
import { Composio } from '@composio/client';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://www.claw4growth.com',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
});

/**
 * Maps dashboard app IDs to Composio toolkit slugs.
 * Must stay in sync with composio-connect/route.ts APP_MAP.
 */
const DASHBOARD_TO_COMPOSIO: Record<string, string> = {
    googlesuper: 'gmail',        // Google Suite — Composio returns 'gmail' as toolkit slug
    facebook: 'facebook',
    instagram: 'instagram',
    linkedin: 'linkedin',
    stripe: 'stripe',
    shopify: 'shopify',
    hubspot: 'hubspot',
    notion: 'notion',
};

/**
 * Reverse map: Composio app ID → dashboard app ID(s)
 */
const COMPOSIO_TO_DASHBOARD: Record<string, string[]> = {};
for (const [dashId, composioId] of Object.entries(DASHBOARD_TO_COMPOSIO)) {
    if (!COMPOSIO_TO_DASHBOARD[composioId]) {
        COMPOSIO_TO_DASHBOARD[composioId] = [];
    }
    COMPOSIO_TO_DASHBOARD[composioId].push(dashId);
}

/**
 * GET /api/dashboard/status
 *
 * Returns a unified JSON with:
 * - user info (id, email)
 * - instance status (subdomain, status)
 * - subscription (plan, billing dates, stripe_customer_id)
 * - connections (which apps are connected via Composio)
 */
export async function GET(request: Request) {
    const user = await getAuthUser(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Fetch instance, subscription, and Composio connections in parallel
    const [instanceResult, subscription, connections] = await Promise.all([
        supabaseAdmin
            .from('c4g_instances')
            .select('id, subdomain, status, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        getUserSubscription(user.id),
        getComposioConnections(user.id),
    ]);

    const instance = instanceResult.data;

    return NextResponse.json({
        user: {
            id: user.id,
            email: user.email,
        },
        instance: instance
            ? { id: instance.id, subdomain: instance.subdomain, status: instance.status }
            : null,
        subscription: subscription
            ? {
                status: subscription.status,
                tier: subscription.tier,
                stripe_customer_id: subscription.stripe_customer_id,
                current_period_end: subscription.current_period_end,
            }
            : null,
        connections,
    }, { headers: CORS_HEADERS });
}

/**
 * Fetches connected accounts from Composio for this user.
 * Returns { appId: { connected: bool, connectionId?: string } }
 */
async function getComposioConnections(
    userId: string,
): Promise<Record<string, { connected: boolean; connectionId?: string }>> {
    const connectedMap: Record<string, { connected: boolean; connectionId?: string }> = {};
    for (const dashId of Object.keys(DASHBOARD_TO_COMPOSIO)) {
        connectedMap[dashId] = { connected: false };
    }

    try {
        const accounts = await composio.connectedAccounts.list({
            user_ids: [userId],
        });

        if (accounts?.items) {
            for (const account of accounts.items) {
                // Skip non-active accounts
                if ((account as any).status !== 'ACTIVE') continue;

                const toolkit = (account as any).toolkit?.slug || (account as any).appName || '';
                const dashIds = COMPOSIO_TO_DASHBOARD[toolkit.toLowerCase()];
                if (dashIds) {
                    for (const did of dashIds) {
                        connectedMap[did] = {
                            connected: true,
                            connectionId: account.id,
                        };
                    }
                }
            }
        }
    } catch (err) {
        console.error('Failed to fetch Composio connections:', err);
    }

    return connectedMap;
}
