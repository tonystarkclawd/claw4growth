import type { Metadata } from 'next';

export const metadata: Metadata = {
    title: 'Claw4Growth — AI Marketing Team',
    description: 'Your AI-powered marketing team. Automated content, campaigns, and growth — powered by OpenClaw.',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>{children}</body>
        </html>
    );
}
