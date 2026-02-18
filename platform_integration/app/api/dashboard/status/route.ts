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
    // Google services (individual)
    gmail: 'gmail',
    googlecalendar: 'googlecalendar',
    googlesheets: 'googlesheets',
    googledrive: 'googledrive',
    googledocs: 'googledocs',
    google_analytics: 'google_analytics',
    googleads: 'googleads',
    // Meta services
    facebook: 'facebook',
    instagram: 'instagram',
    metaads: 'metaads',
    // Other
    linkedin: 'linkedin',
    reddit: 'reddit',
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

    // Fetch instance, subscription, Composio connections, and usage in parallel
    const [instanceResult, subscription, connections, usageResult] = await Promise.all([
        supabaseAdmin
            .from('c4g_instances')
            .select('id, subdomain, status, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
        getUserSubscription(user.id),
        getComposioConnections(user.id),
        getMonthlyUsage(supabaseAdmin, user.id),
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
        usage: usageResult,
    }, { headers: CORS_HEADERS });
}

const MONTHLY_BUDGET_EUR = 20;

/**
 * Fetches current month's API usage for a user.
 */
async function getMonthlyUsage(
    supabaseAdmin: any,
    userId: string,
): Promise<{ current_eur: number; budget_eur: number; pct: number }> {
    try {
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);

        const { data, error } = await supabaseAdmin
            .from('c4g_api_usage')
            .select('estimated_cost_eur')
            .eq('user_id', userId)
            .gte('created_at', monthStart.toISOString());

        if (error) throw error;

        const currentEur = (data || []).reduce(
            (sum: number, r: { estimated_cost_eur: number }) => sum + parseFloat(String(r.estimated_cost_eur || 0)),
            0,
        );
        const rounded = Math.round(currentEur * 100) / 100;
        const pct = Math.min(100, Math.round((rounded / MONTHLY_BUDGET_EUR) * 100));

        return { current_eur: rounded, budget_eur: MONTHLY_BUDGET_EUR, pct };
    } catch (err) {
        console.error('Failed to fetch monthly usage:', err);
        return { current_eur: 0, budget_eur: MONTHLY_BUDGET_EUR, pct: 0 };
    }
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
            limit: 100,
        });

        if (accounts?.items) {
            for (const account of accounts.items) {
                const acct = account as any;
                // Skip non-active accounts
                if (acct.status !== 'ACTIVE') continue;

                const toolkit = acct.toolkit?.slug || acct.appName || '';
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
