import { NextResponse } from 'next/server';
import { Composio } from '@composio/client';

const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
});

/**
 * App name mapping: our internal names → Composio toolkit slugs
 */
const APP_MAP: Record<string, string> = {
    google: 'google',
    facebook: 'facebook',
    instagram: 'instagram',
    metaads: 'facebook_ads',
    shopify: 'shopify',
    linkedin: 'linkedin',
    notion: 'notion',
    hubspot: 'hubspot',
    stripe: 'stripe',
    twitter: 'twitter',
    tiktok: 'tiktok',
    google_analytics: 'googleanalytics',
};

/**
 * Finds or creates a Composio auth config for the given toolkit slug.
 * Uses Composio-managed auth (default OAuth credentials).
 */
async function getOrCreateAuthConfig(toolkitSlug: string): Promise<string> {
    // Check for existing auth config
    const existing = await composio.authConfigs.list({
        toolkit_slug: toolkitSlug,
    });

    if (existing?.items?.length) {
        return existing.items[0].id;
    }

    // Create a new auth config with Composio-managed credentials
    const created = await composio.authConfigs.create({
        toolkit: { slug: toolkitSlug },
        auth_config: { type: 'use_composio_managed_auth' },
    });

    return created.auth_config.id;
}

/**
 * GET /api/composio-connect
 *
 * Initiates a Composio OAuth connection for a given app.
 * Redirects the user to the OAuth provider's authorization page.
 *
 * Query params:
 *   - app: the app to connect (e.g. 'facebook', 'instagram', 'google')
 *   - entityId: unique identifier for the user/entity in Composio
 *   - redirectTo: path to redirect after OAuth (e.g. '/dashboard/')
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const app = searchParams.get('app');
    const entityId = searchParams.get('entityId') || 'default';
    const redirectTo = searchParams.get('redirectTo');

    if (!app) {
        return NextResponse.json({ error: 'Missing app parameter' }, { status: 400 });
    }

    const toolkitSlug = APP_MAP[app.toLowerCase()];
    if (!toolkitSlug) {
        return NextResponse.json({ error: `Unknown app: ${app}` }, { status: 400 });
    }

    // Determine redirect URL after OAuth completes
    const origin = request.headers.get('origin')
        || request.headers.get('referer')?.replace(/\/[^/]*$/, '')
        || 'https://www.claw4growth.com';
    const callbackUrl = redirectTo
        ? `${origin}${redirectTo}?connected=${app}`
        : `${origin}/onboarding/?step=app-connected&app=${app}`;

    try {
        // Get or create auth config for this app
        const authConfigId = await getOrCreateAuthConfig(toolkitSlug);

        const response = await composio.connectedAccounts.create({
            auth_config: {
                id: authConfigId,
            },
            connection: {
                user_id: entityId,
                callback_url: callbackUrl,
            },
        });

        // Look for OAuth redirect URL in the response
        const connData = response.connectionData?.val as any;
        if (connData) {
            const authUrl = connData.authUri || connData.redirectUrl || connData.redirect_url;
            if (authUrl) {
                return NextResponse.redirect(authUrl, 303);
            }
        }

        // Some integrations may not require OAuth redirect
        return NextResponse.json({
            status: 'connected',
            connectionId: response.id,
            data: response
        });
    } catch (error: unknown) {
        console.error('Composio connect error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'Failed to initiate connection', details: message },
            { status: 500 }
        );
    }
}
