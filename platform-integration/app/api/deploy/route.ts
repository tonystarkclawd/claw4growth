/**
 * POST /api/deploy
 * 
 * Triggers automatic deployment after successful payment.
 * Creates instance record, provisions Docker container,
 * generates Telegram pairing code for platform bot.
 * 
 * Required body: { userId, email, onboardingData }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'crypto';
import { generatePairingCode } from '@/lib/telegram/pairing';

// Service role client for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

function generateSubdomain(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(8);
  let subdomain = '';
  for (let i = 0; i < 8; i++) {
    subdomain += chars[bytes[i] % chars.length];
  }
  return subdomain;
}

function encrypt(text: string): string {
  // Simple encryption using service role
  // In production, use proper AES encryption
  const key = process.env.ENCRYPTION_KEY || 'default-key-32-chars-long!!!!!';
  const b64 = Buffer.from(text).toString('base64');
  return `enc:${b64}`;
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
      return NextResponse.json(
        { error: 'Missing required fields: userId, email' },
        { status: 400 }
      );
    }

    // Check if user already has an instance
    const { data: existingInstance } = await supabaseAdmin
      .from('c4g_instances')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (existingInstance) {
      return NextResponse.json(
        { error: 'Instance already exists for this user', instanceId: existingInstance.id },
        { status: 409 }
      );
    }

    // Generate unique subdomain
    const subdomain = generateSubdomain();

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
      return NextResponse.json(
        { error: 'Failed to create instance record' },
        { status: 500 }
      );
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
      return NextResponse.json(
        { error: 'Failed to create instance config' },
        { status: 500 }
      );
    }

    // Generate pairing code for the platform bot
    let pairingCode: string | null = null;
    try {
      pairingCode = await generatePairingCode(userId, instance.id);
    } catch (err) {
      console.error('Failed to generate pairing code:', err);
      // Non-fatal — user can generate one later from the dashboard
    }

    // Trigger async provisioning (with onboarding data for memory injection)
    provisionContainer(instance.id, subdomain, {
      composioEntityId,
      userId,
      email,
      onboardingData,
    }).catch(console.error);

    return NextResponse.json({
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
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Async container provisioning.
 * 
 * In production, this will:
 * 1. Call Docker API on VPS via createAndStartContainer()
 * 2. Pass onboardingData for memory/soul file injection
 * 3. Update instance status based on container health
 * 
 * For now, simulates provisioning (TODO: wire to real Docker).
 */
async function provisionContainer(
  instanceId: string,
  subdomain: string,
  config: {
    composioEntityId?: string;
    userId: string;
    email: string;
    onboardingData?: Record<string, unknown>;
  }
) {
  console.log(`[provision] Starting for instance ${instanceId}`);
  console.log(`[provision] Onboarding data:`, JSON.stringify(config.onboardingData || {}));

  // TODO: Replace with real Docker provisioning:
  //
  // import { createAndStartContainer } from '@/lib/docker/containers';
  // 
  // const containerId = await createAndStartContainer(
  //   config.userId,
  //   subdomain,
  //   {
  //     OPENCLAW_API_KEY: process.env.OPENCLAW_API_KEY,
  //     USER_ID: config.userId,
  //     INSTANCE_ID: instanceId,
  //   },
  //   {
  //     openclawModelId: 'minimax/minimax-latest',
  //     onboardingData: config.onboardingData,
  //   }
  // );
  //
  // await supabaseAdmin
  //   .from('c4g_instances')
  //   .update({ container_id: containerId, status: 'running' })
  //   .eq('id', instanceId);

  // Simulated provisioning delay
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Update status to running
  await supabaseAdmin
    .from('c4g_instances')
    .update({
      status: 'running',
      updated_at: new Date().toISOString(),
    })
    .eq('id', instanceId);

  console.log(`[provision] Instance ${instanceId} is now running`);
}

export async function GET(request: NextRequest) {
  // Check instance status
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  const { data: instance } = await supabaseAdmin
    .from('c4g_instances')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!instance) {
    return NextResponse.json({ exists: false });
  }

  return NextResponse.json({
    exists: true,
    instanceId: instance.id,
    status: instance.status,
    subdomain: instance.subdomain,
    url: `https://${instance.subdomain}.claw4growth.com`,
  });
}

