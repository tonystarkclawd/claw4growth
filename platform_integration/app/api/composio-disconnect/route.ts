import { NextResponse } from 'next/server';
import { Composio } from '@composio/client';
import { getAuthUser } from '@/lib/supabase/server';

const composio = new Composio({
    apiKey: process.env.COMPOSIO_API_KEY!,
});

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': 'https://www.claw4growth.com',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};

export async function OPTIONS() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * POST /api/composio-disconnect
 *
 * Disconnects a Composio connected account.
 * Body: { connectionId: string }
 */
export async function POST(request: Request) {
    const user = await getAuthUser(request);
    if (!user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS });
    }

    const body = await request.json();
    const connectionId = body.connectionId;

    if (!connectionId) {
        return NextResponse.json({ error: 'Missing connectionId' }, { status: 400, headers: CORS_HEADERS });
    }

    try {
        // Verify the connection belongs to this user before deleting
        const account = await composio.connectedAccounts.retrieve(connectionId);
        if ((account as any).user_id !== user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers: CORS_HEADERS });
        }

        await composio.connectedAccounts.delete(connectionId);
        return NextResponse.json({ ok: true }, { headers: CORS_HEADERS });
    } catch (error: unknown) {
        console.error('Composio disconnect error:', error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        return NextResponse.json(
            { error: 'Failed to disconnect', details: message },
            { status: 500, headers: CORS_HEADERS }
        );
    }
}
