import { NextResponse } from 'next/server';
import { getAuthUser } from '@/lib/supabase/server';
import { createClient } from '@supabase/supabase-js';
import { decryptToken } from '@/lib/google-crypto';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://www.claw4growth.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/google-disconnect
 *
 * Revokes Google tokens and deletes the record from Supabase.
 * Body: { app: "googleads" }
 */
export async function POST(request: Request) {
    const user = await getAuthUser(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Fetch token to revoke
    const { data: tokenRow } = await supabase
        .from('c4g_google_tokens')
        .select('access_token_enc')
        .eq('user_id', user.id)
        .maybeSingle();

    if (!tokenRow) {
        return NextResponse.json({ ok: true, message: 'No Google connection found' }, { headers: CORS_HEADERS });
    }

    // Revoke token at Google (best-effort)
    try {
        const accessToken = decryptToken(tokenRow.access_token_enc);
        await fetch(`https://oauth2.googleapis.com/revoke?token=${accessToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
    } catch (err) {
        console.error('Google token revoke error (non-fatal):', err);
    }

    // Delete from Supabase
    const { error: deleteError } = await supabase
        .from('c4g_google_tokens')
        .delete()
        .eq('user_id', user.id);

    if (deleteError) {
        console.error('Delete error:', deleteError);
        return NextResponse.json(
            { error: 'Failed to delete token' },
            { status: 500, headers: CORS_HEADERS },
        );
    }

    return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
}
