/** @type {import('next').NextConfig} */
const nextConfig = {
    // Serve static HTML pages from the parent directory
    // API routes live in app/api/
    experimental: {
        serverActions: {
            bodySizeLimit: '2mb',
        },
    },

    // Rewrites: serve the existing static HTML pages
    async rewrites() {
        return [
            // Landing page
            {
                source: '/',
                destination: '/landing/index.html',
            },
            // Onboarding
            {
                source: '/onboarding',
                destination: '/onboarding/index.html',
            },
            {
                source: '/onboarding/it',
                destination: '/onboarding/it.html',
            },
            // Dashboard
            {
                source: '/dashboard',
                destination: '/dashboard/index.html',
            },
            // Early bird
            {
                source: '/early-bird',
                destination: '/early-bird/index.html',
            },
        ];
    },
};

export default nextConfig;
