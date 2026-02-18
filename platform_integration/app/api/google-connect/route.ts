import { NextResponse } from 'next/server';

/**
 * Google app → OAuth scopes.
 * All Google services use our direct OAuth (not Composio).
 * userinfo.email is always included for account identification.
 */
const BASE_SCOPES = ['https://www.googleapis.com/auth/userinfo.email'];

const APP_SCOPES: Record<string, string[]> = {
    googleads:        ['https://www.googleapis.com/auth/adwords'],
    gmail:            ['https://www.googleapis.com/auth/gmail.modify'],
    googlecalendar:   ['https://www.googleapis.com/auth/calendar'],
    googledrive:      ['https://www.googleapis.com/auth/drive'],
    googledocs:       ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive'],
    googlesheets:     ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
    google_analytics: ['https://www.googleapis.com/auth/analytics.readonly'],
};

/** Resolve scopes: app-specific + base (email) */
function getScopesForApp(app: string): string[] | null {
    const appScopes = APP_SCOPES[app];
    if (!appScopes) return null;
    return [...new Set([...BASE_SCOPES, ...appScopes])];
}

/**
 * GET /api/google-connect
 *
 * Initiates Google OAuth for a given app.
 * Query params:
 *   - app: e.g. "googleads"
 *   - entityId: user_id (from Supabase auth)
 *   - redirectTo: path to redirect after OAuth (e.g. "/dashboard/")
 *   - customer_id: (optional) Google Ads customer ID if user provides one
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const app = searchParams.get('app')?.toLowerCase();
    const entityId = searchParams.get('entityId');
    const redirectTo = searchParams.get('redirectTo') || '/dashboard/';
    const customerId = searchParams.get('customer_id') || '';

    if (!app || !entityId) {
        return NextResponse.json({ error: 'Missing app or entityId' }, { status: 400 });
    }

    const scopes = getScopesForApp(app);
    if (!scopes) {
        return NextResponse.json({ error: `Unsupported Google app: ${app}` }, { status: 400 });
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        return NextResponse.json({ error: 'Google OAuth not configured' }, { status: 500 });
    }

    // Encode state for the callback
    const state = Buffer.from(JSON.stringify({
        userId: entityId,
        app,
        redirectTo,
        customerId,
    })).toString('base64url');

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: 'https://app.claw4growth.com/api/google-callback',
        response_type: 'code',
        scope: scopes.join(' '),
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
    });

    return NextResponse.redirect(
        `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
        303,
    );
}
