export const brandConfig = {
    app: {
        name: 'Claw4Growth',
        deployedProduct: 'OpenClaw',
        // OpenClaw listens internally on 18789 but only on 127.0.0.1.
        // A socat sidecar (sharing the container network namespace) binds
        // 0.0.0.0:18790 and forwards to 127.0.0.1:18789.
        // Caddy proxies to this external-facing port.
        deployedProductPort: 18790,
        tagline: 'Your AI Marketing Operator',
        supportEmail: 'hello@claw4growth.com',
    },
    telegram: {
        botUsername: 'Claw4Growth_bot',
    },
    features: {
        enableDevMode: process.env.NODE_ENV === 'development',
        enableTelegram: process.env.NEXT_PUBLIC_ENABLE_TELEGRAM === 'true',
    },
};
