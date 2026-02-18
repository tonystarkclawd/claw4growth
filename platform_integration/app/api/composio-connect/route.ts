import { NextResponse } from 'next/server';
import { Composio } from '@composio/client';

const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
});

/**
 * Dashboard app ID → Composio auth config ID
 * These are the existing auth configs from our Composio project.
 * Google Suite maps to gmail (which has the broadest Google OAuth scopes).
 */
const AUTH_CONFIG_MAP: Record<string, string> = {
    // Google services (individual)
    gmail: 'ac_wBMMUfAOJDLY',
    googlecalendar: 'ac_p1ZaQqPzTlNP',
    googlesheets: 'ac_teL4nmno385E',
    googledrive: 'ac_u9qKr-pONcBz',
    googledocs: 'ac_mFdTE8GSOhFz',
    google_analytics: 'ac_UgKgM36aNi1C',
    googleads: 'ac_DfrrMF3eZdcX',
    // Meta services
    facebook: 'ac_B6oGhWz03WAe',
    instagram: 'ac_w_KXVqOyLCyy',
    metaads: 'ac_QxTnSDL1vZaq',
    // Other
    linkedin: 'ac_4Z-6WTXR0QcT',
    reddit: 'ac_EQYV_LpMdwRQ',
    stripe: 'ac_PQayaEbMegy1',
    shopify: 'ac_FKufei5EYb2N',
    hubspot: 'ac_tP_F4SXOvlNi',
    notion: 'ac_TV1QEGMyebUW',
};

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
/**
 * Apps that require extra input fields during connection.
 * Key = app ID, value = list of query param names to collect and pass to Composio.
 */
const APP_INPUT_FIELDS: Record<string, string[]> = {
    shopify: ['subdomain'],
    googleads: ['generic_token', 'generic_id'],
};

// Google apps handled by our own OAuth (not Composio)
const GOOGLE_APPS = ['googleads', 'gmail', 'googlecalendar', 'googledrive', 'googledocs', 'googlesheets', 'google_analytics'];

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const app = searchParams.get('app');
    const entityId = searchParams.get('entityId') || 'default';
    const redirectTo = searchParams.get('redirectTo');

    if (!app) {
        return NextResponse.json({ error: 'Missing app parameter' }, { status: 400 });
    }

    // Redirect Google apps to our direct OAuth flow
    if (GOOGLE_APPS.includes(app.toLowerCase())) {
        const googleParams = new URLSearchParams({
            app: app.toLowerCase(),
            entityId,
            ...(redirectTo ? { redirectTo } : {}),
        });
        // Pass customer_id if provided
        const customerId = searchParams.get('generic_id') || searchParams.get('customer_id');
        if (customerId) googleParams.set('customer_id', customerId);
        return NextResponse.redirect(new URL(`/api/google-connect?${googleParams}`, request.url), 303);
    }

    const authConfigId = AUTH_CONFIG_MAP[app.toLowerCase()];
    if (!authConfigId) {
        return NextResponse.json({ error: `Unknown app: ${app}` }, { status: 400 });
    }

    // Collect extra input fields for this app (e.g. subdomain for Shopify)
    const inputFields = APP_INPUT_FIELDS[app.toLowerCase()] || [];
    const connectionData: Record<string, string> = {};
    for (const field of inputFields) {
        const val = searchParams.get(field);
        if (val) connectionData[field] = val;
    }

    // Determine redirect URL after OAuth completes
    const origin = request.headers.get('origin')
        || request.headers.get('referer')?.replace(/\/[^/]*$/, '')
        || 'https://www.claw4growth.com';
    const callbackUrl = redirectTo
        ? `${origin}${redirectTo}?connected=${app}`
        : `${origin}/onboarding/?step=app-connected&app=${app}`;

    try {
        const response = await composio.connectedAccounts.create({
            auth_config: {
                id: authConfigId,
            },
            connection: {
                user_id: entityId,
                callback_url: callbackUrl,
                ...(Object.keys(connectionData).length > 0 ? { data: connectionData } : {}),
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
