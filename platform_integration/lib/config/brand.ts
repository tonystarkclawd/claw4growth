export const brandConfig = {
    app: {
        name: 'Claw4Growth',
        deployedProduct: 'OpenClaw',
        deployedProductPort: 18789,
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
