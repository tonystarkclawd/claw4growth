/**
 * POST /api/deploy
 * 
 * Triggers automatic deployment after successful payment.
 * Creates instance record in Supabase (status=provisioning),
 * generates Telegram pairing code for platform bot.
 * Actual container provisioning is handled by the VPS worker.
 * 
 * Required body: { userId, email, onboardingData }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { generatePairingCode } from '@/lib/telegram/pairing';

const ALLOWED_ORIGINS = [
  'https://claw4growth.com',
  'https://www.claw4growth.com',
  'https://app.claw4growth.com',
];

function corsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

function jsonWithCors(request: NextRequest, data: Record<string, unknown>, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders(request) });
}

// Service role client for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function generateSubdomain(baseName: string = ''): string {
  // Slugify the base name: lowercase, remove non-alphanumeric, replace spaces with hyphens
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 20); // Limit length

  // Generate short random suffix (4 chars) for uniqueness
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(4);
  let suffix = '';
  for (let i = 0; i < 4; i++) {
    suffix += chars[bytes[i] % chars.length];
  }

  // If we have a valid slug, use it + suffix. Otherwise fallback to random 8 chars.
  if (slug.length > 0) {
    return `${slug}-${suffix}`;
  }

  // Fallback
  const fallbackBytes = randomBytes(8);
  let fallback = '';
  for (let i = 0; i < 8; i++) {
    fallback += chars[fallbackBytes[i] % chars.length];
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      userId,
      email,
      onboardingData,
      composioEntityId
    } = body;

    if (!userId || !email) {
      return jsonWithCors(request, { error: 'Missing required fields: userId, email' }, 400);
    }

    // Check if user already has an instance
    const { data: existingInstance } = await supabaseAdmin
      .from('c4g_instances')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existingInstance) {
      return jsonWithCors(request, { error: 'Instance already exists for this user', instanceId: existingInstance.id }, 409);
    }

    // Generate human-readable subdomain (e.g. "my-brand-8x2a")
    const brandName = onboardingData?.companyName || onboardingData?.operatorName || '';
    const subdomain = generateSubdomain(brandName);

    // Create instance record
    const { data: instance, error: instanceError } = await supabaseAdmin
      .from('c4g_instances')
      .insert({
        user_id: userId,
        subdomain,
        status: 'provisioning',
        composio_entity_id: composioEntityId || null,
      })
      .select()
      .single();

    if (instanceError || !instance) {
      console.error('Failed to create instance:', instanceError);
      return jsonWithCors(request, { error: 'Failed to create instance record' }, 500);
    }

    // Create config record with onboarding data
    const configData: Record<string, unknown> = {
      instance_id: instance.id,
      model_preference: 'minimax',
      onboarding_data: onboardingData || {},
      composio_keys_encrypted: {},
    };

    const { error: configError } = await supabaseAdmin
      .from('c4g_instance_configs')
      .insert(configData);

    if (configError) {
      console.error('Failed to create config:', configError);
      // Rollback instance
      await supabaseAdmin.from('c4g_instances').delete().eq('id', instance.id);
      return jsonWithCors(request, { error: 'Failed to create instance config' }, 500);
    }

    // Generate pairing code for the platform bot
    let pairingCode: string | null = null;
    try {
      pairingCode = await generatePairingCode(userId, instance.id);
    } catch (err) {
      console.error('Failed to generate pairing code:', err);
      // Non-fatal — user can generate one later from the dashboard
    }

    // Provisioning is handled by the VPS worker (polls for status=provisioning).
    // The API just writes the intent to the database and returns immediately.

    return jsonWithCors(request, {
      success: true,
      instanceId: instance.id,
      subdomain,
      url: `https://${subdomain}.claw4growth.com`,
      status: 'provisioning',
      pairingCode,
      telegramBotUsername: process.env.PLATFORM_TELEGRAM_BOT_USERNAME || 'Claw4GrowthBot',
    });

  } catch (error) {
    console.error('Deploy error:', error);
    return jsonWithCors(request, { error: 'Internal server error' }, 500);
  }
}

export async function GET(request: NextRequest) {
  // Check instance status
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return jsonWithCors(request, { error: 'Missing userId' }, 400);
  }

  const { data: instance } = await supabaseAdmin
    .from('c4g_instances')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!instance) {
    return jsonWithCors(request, { exists: false });
  }

  return jsonWithCors(request, {
    exists: true,
    instanceId: instance.id,
    status: instance.status,
    subdomain: instance.subdomain,
    url: `https://${instance.subdomain}.claw4growth.com`,
  });
}

