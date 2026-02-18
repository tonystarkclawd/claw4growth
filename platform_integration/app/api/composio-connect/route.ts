import { NextResponse } from 'next/server';
import { Composio } from '@composio/client';

const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
});

/**
 * App name mapping: our internal names → Composio integration IDs
 */
const APP_MAP: Record<string, string> = {
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
 * GET /api/composio-connect
 *
 * Initiates a Composio OAuth connection for a given app.
 * Redirects the user to the OAuth provider's authorization page.
 *
 * Query params:
 *   - app: the app to connect (e.g. 'facebook', 'instagram')
 *   - entityId: unique identifier for the user/entity in Composio
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const app = searchParams.get('app');
    const entityId = searchParams.get('entityId') || 'default';
    const redirectTo = searchParams.get('redirectTo');

    if (!app) {
        return NextResponse.json({ error: 'Missing app parameter' }, { status: 400 });
    }

    const composioApp = APP_MAP[app.toLowerCase()];
    if (!composioApp) {
        return NextResponse.json({ error: `Unknown app: ${app}` }, { status: 400 });
    }

    // Determine redirect URL after OAuth completes
    const origin = request.headers.get('origin')
        || request.headers.get('referer')?.replace(/\/[^/]*$/, '')
        || 'https://claw4growth.com';
    const redirectUrl = redirectTo
        ? `${origin}${redirectTo}?connected=${app}`
        : `${origin}/onboarding/?step=app-connected&app=${app}`;

    try {
        const response = await composio.connectedAccounts.create({
            auth_config: {
                id: composioApp,
            },
            connection: {
                user_id: entityId,
                callback_url: redirectUrl,
            },
        });

        if (response.connectionData && 'authUri' in response.connectionData.val) {
            // Redirect to OAuth URL provided by Composio
            const authUri = (response.connectionData.val as any).authUri;
            if (authUri) {
                return NextResponse.redirect(authUri, 303);
            }
        }

        if (response.connectionData && 'redirectUrl' in response.connectionData.val) {
            // Redirect to OAuth URL provided by Composio
            const redirectUrl = (response.connectionData.val as any).redirectUrl;
            if (redirectUrl) {
                return NextResponse.redirect(redirectUrl, 303);
            }
        }

        // Some integrations may not require OAuth redirect or return different structure
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
