import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { encryptToken } from '@/lib/google-crypto';

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_ADS_CUSTOMERS_URL = 'https://googleads.googleapis.com/v20/customers:listAccessibleCustomers';

/**
 * GET /api/google-callback
 *
 * Google OAuth redirect callback.
 * Exchanges code → tokens, auto-discovers Google Ads customer ID,
 * encrypts tokens, upserts into c4g_google_tokens.
 */
export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const stateParam = searchParams.get('state');
    const error = searchParams.get('error');

    if (error) {
        console.error('Google OAuth error:', error);
        return NextResponse.redirect('https://www.claw4growth.com/dashboard/?error=google_denied');
    }

    if (!code || !stateParam) {
        return NextResponse.redirect('https://www.claw4growth.com/dashboard/?error=google_missing_params');
    }

    // Decode state
    let state: { userId: string; app: string; redirectTo: string; customerId?: string };
    try {
        state = JSON.parse(Buffer.from(stateParam, 'base64url').toString('utf8'));
    } catch {
        return NextResponse.redirect('https://www.claw4growth.com/dashboard/?error=google_invalid_state');
    }

    const clientId = process.env.GOOGLE_CLIENT_ID!;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET!;

    // 1. Exchange code for tokens
    let tokens: { access_token: string; refresh_token: string; expires_in: number; scope: string };
    try {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: 'https://app.claw4growth.com/api/google-callback',
                grant_type: 'authorization_code',
            }),
        });
        tokens = await tokenRes.json();
        if (!tokens.access_token) {
            console.error('Token exchange failed:', tokens);
            return NextResponse.redirect('https://www.claw4growth.com/dashboard/?error=google_token_exchange');
        }
    } catch (err) {
        console.error('Token exchange error:', err);
        return NextResponse.redirect('https://www.claw4growth.com/dashboard/?error=google_token_exchange');
    }

    // 2. Fetch user email
    let googleEmail = '';
    try {
        const userRes = await fetch(GOOGLE_USERINFO_URL, {
            headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        const userInfo = await userRes.json();
        googleEmail = userInfo.email || '';
    } catch (err) {
        console.error('Userinfo fetch error:', err);
    }

    // 3. Auto-discover Google Ads Customer ID (if googleads scope)
    let adsCustomerId = state.customerId || '';
    const grantedScopes = (tokens.scope || '').split(' ');
    if (grantedScopes.some(s => s.includes('adwords')) && !adsCustomerId) {
        try {
            const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '';
            const adsRes = await fetch(GOOGLE_ADS_CUSTOMERS_URL, {
                headers: {
                    Authorization: `Bearer ${tokens.access_token}`,
                    'developer-token': devToken,
                },
            });
            const adsData = await adsRes.json();
            // resourceNames are like "customers/1234567890"
            const resourceNames: string[] = adsData.resourceNames || [];
            if (resourceNames.length > 0) {
                // Take the first one (strip "customers/" prefix)
                adsCustomerId = resourceNames[0].replace('customers/', '');
            }
        } catch (err) {
            console.error('Google Ads customer discovery error:', err);
        }
    }

    // 4. Encrypt tokens
    const accessTokenEnc = encryptToken(tokens.access_token);
    const refreshTokenEnc = encryptToken(tokens.refresh_token);
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    const scopes = grantedScopes.filter(s => s.length > 0);

    // 5. Upsert into Supabase (merge scopes if existing)
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Check if record exists to merge scopes
    const { data: existing } = await supabase
        .from('c4g_google_tokens')
        .select('scopes, google_ads_customer_id')
        .eq('user_id', state.userId)
        .maybeSingle();

    const mergedScopes = existing
        ? Array.from(new Set([...(existing.scopes || []), ...scopes]))
        : scopes;

    // Keep existing customer ID if we didn't discover a new one
    const finalCustomerId = adsCustomerId || existing?.google_ads_customer_id || null;

    const { error: upsertError } = await supabase
        .from('c4g_google_tokens')
        .upsert({
            user_id: state.userId,
            access_token_enc: accessTokenEnc,
            refresh_token_enc: refreshTokenEnc,
            expires_at: expiresAt,
            scopes: mergedScopes,
            google_ads_customer_id: finalCustomerId,
            google_email: googleEmail,
        }, { onConflict: 'user_id' });

    if (upsertError) {
        console.error('Supabase upsert error:', upsertError);
        return NextResponse.redirect('https://www.claw4growth.com/dashboard/?error=google_save');
    }

    // 6. Redirect back to dashboard
    const redirectUrl = `https://www.claw4growth.com${state.redirectTo}?connected=${state.app}`;
    return NextResponse.redirect(redirectUrl, 303);
}
