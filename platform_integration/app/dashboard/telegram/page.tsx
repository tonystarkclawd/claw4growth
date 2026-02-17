'use client';

import { useState, useEffect } from 'react';
import { brandConfig } from '@/lib/config/brand';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import TelegramBotTokenForm from '@/components/TelegramBotTokenForm';

interface PairingResponse {
  code: string;
  deepLink: string;
}

export default function TelegramPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pairingData, setPairingData] = useState<PairingResponse | null>(null);
  const [isPaired, setIsPaired] = useState(false);

  const isFeatureEnabled =
    process.env.NEXT_PUBLIC_ENABLE_TELEGRAM === 'true';

  useEffect(() => {
    // In the future, we could check pairing status on mount
  }, []);

  const handleGenerateCode = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/telegram/generate-code', {
        method: 'POST',
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Not authenticated');
        }
        throw new Error('Failed to generate pairing code');
      }

      const data: PairingResponse = await response.json();
      setPairingData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (!isFeatureEnabled) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Telegram</h1>
        </div>
        <Card className="p-8 text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">Feature Not Enabled</h2>
          <p className="text-muted-foreground">
            Telegram integration is not currently available.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Telegram</h1>
        <p className="text-muted-foreground mt-1">
          Manage your Telegram bot token and connect your account to your{' '}
          {process.env.NEXT_PUBLIC_DEPLOYED_PRODUCT || brandConfig.app.deployedProduct} instance.
        </p>
      </div>

      {/* Bot Token Management */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Bot Token</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Your Telegram bot token is used by your {process.env.NEXT_PUBLIC_DEPLOYED_PRODUCT || brandConfig.app.deployedProduct} instance
          to communicate via Telegram. Updating it will restart your container with the new token.
        </p>
        <TelegramBotTokenForm />
      </div>

      {/* Pairing Flow */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Account Pairing</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Link your Telegram account to receive notifications and interact with your instance.
        </p>
        <Card className="p-8">
          {isPaired ? (
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500/20 rounded-full mb-4">
                <svg
                  className="w-8 h-8 text-green-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">Connected</h3>
              <p className="text-muted-foreground">
                Your Telegram account is connected to{' '}
                {process.env.NEXT_PUBLIC_APP_NAME || brandConfig.app.name}.
              </p>
            </div>
          ) : pairingData ? (
            <div className="space-y-6">
              <div className="text-center">
                <h3 className="text-xl font-semibold text-foreground mb-4">
                  Your Pairing Code
                </h3>
                <div className="bg-muted rounded-lg p-6 mb-4">
                  <div className="text-4xl font-mono font-bold text-foreground tracking-wider">
                    {pairingData.code}
                  </div>
                </div>
                <p className="text-sm text-yellow-400 font-medium mb-6">
                  Expires in 15 minutes
                </p>
              </div>

              <div className="border-t border-border pt-6">
                <h3 className="text-lg font-semibold text-foreground mb-3">
                  Next Steps
                </h3>
                <ol className="list-decimal list-inside space-y-2 text-muted-foreground mb-6">
                  <li>Click the button below to open Telegram</li>
                  <li>The bot will automatically receive your pairing code</li>
                  <li>Confirm the pairing when prompted in the Telegram chat</li>
                </ol>

                <Button asChild className="w-full" size="lg">
                  <a
                    href={pairingData.deepLink}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <svg
                      className="w-5 h-5 mr-2"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.14.18-.357.295-.6.295-.002 0-.003 0-.005 0l.213-3.054 5.56-5.022c.24-.213-.054-.334-.373-.121l-6.869 4.326-2.96-.924c-.64-.203-.658-.64.135-.954l11.566-4.458c.538-.196 1.006.128.832.941z" />
                    </svg>
                    Open Telegram Bot
                  </a>
                </Button>
              </div>

              <button
                onClick={() => setPairingData(null)}
                className="w-full text-sm text-muted-foreground hover:text-foreground underline"
              >
                Generate a new code
              </button>
            </div>
          ) : (
            <div className="text-center">
              {error && (
                <Alert variant="destructive" className="mb-4">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                onClick={handleGenerateCode}
                disabled={loading}
                size="lg"
              >
                {loading ? 'Generating...' : 'Generate Pairing Code'}
              </Button>

              <div className="mt-6 rounded-lg p-4 text-left bg-muted">
                <h3 className="font-semibold text-foreground mb-2">How it works</h3>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>1. Generate a unique pairing code</li>
                  <li>2. Open the Telegram bot with your code</li>
                  <li>3. Your account will be linked automatically</li>
                </ul>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
