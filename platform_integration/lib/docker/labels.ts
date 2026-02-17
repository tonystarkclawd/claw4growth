/**
 * Docker container labels and constants for C4G instances.
 */

import type { SubscriptionTier } from '@/types/billing';

export const LABELS = {
    APP: 'c4g.app',
    INSTANCE_ID: 'c4g.instance-id',
    USER_ID: 'c4g.user-id',
    SUBDOMAIN: 'c4g.subdomain',
} as const;

export const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE || 'ghcr.io/openclaw/openclaw:latest';
export const DOCKER_NETWORK = process.env.DOCKER_NETWORK || 'caddy';
export const ISOLATED_NETWORK_PREFIX = 'c4g-isolated-';

export function buildLabels(instanceId: string, userId: string, subdomain: string): Record<string, string> {
    return {
        [LABELS.APP]: 'claw4growth',
        [LABELS.INSTANCE_ID]: instanceId,
        [LABELS.USER_ID]: userId,
        [LABELS.SUBDOMAIN]: subdomain,
    };
}

/**
 * Generates Caddy reverse proxy labels for automatic HTTPS routing.
 */
export function getCaddyLabels(subdomain: string): Record<string, string> {
    const domain = `${subdomain}.claw4growth.com`;
    return {
        'caddy': domain,
        'caddy.reverse_proxy': '{{upstreams 3000}}',
        'managed-by': 'claw4growth',
        'c4g.subdomain': subdomain,
    };
}

/**
 * Returns Docker resource limits based on subscription tier.
 */
export function getContainerResourceLimits(tier?: SubscriptionTier): Record<string, unknown> {
    const limits: Record<string, Record<string, unknown>> = {
        free: {
            Memory: 256 * 1024 * 1024,      // 256MB
            NanoCpus: 500_000_000,           // 0.5 CPU
            PidsLimit: 100,
        },
        pro: {
            Memory: 512 * 1024 * 1024,      // 512MB
            NanoCpus: 1_000_000_000,        // 1 CPU
            PidsLimit: 200,
        },
        enterprise: {
            Memory: 1024 * 1024 * 1024,     // 1GB
            NanoCpus: 2_000_000_000,        // 2 CPU
            PidsLimit: 500,
        },
    };

    return limits[tier || 'pro'] || limits.pro;
}
