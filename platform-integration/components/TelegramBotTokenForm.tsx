'use client';

import { updateTelegramBotTokenAction } from '@/lib/instance-actions';
import { useActionState } from 'react';
import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { ExternalLink } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

type FormState = {
  success: boolean;
  error?: string;
};

export default function TelegramBotTokenForm() {
  const prevStateRef = useRef<FormState>({ success: false });

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prevState, formData) => {
      const result = await updateTelegramBotTokenAction(formData);
      return result;
    },
    { success: false }
  );

  useEffect(() => {
    if (state === prevStateRef.current) return;
    prevStateRef.current = state;

    if (state.error) {
      toast.error(state.error);
    } else if (state.success) {
      toast.success('Bot token updated — container restarting with new token');
    }
  }, [state]);

  return (
    <Card className="p-6">
      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="telegramBotToken">Telegram Bot Token</Label>
          <Input
            type="password"
            id="telegramBotToken"
            name="telegramBotToken"
            required
            minLength={10}
            placeholder="110201543:AAHdqTcvCH1vGWJxfSe..."
            disabled={isPending}
          />
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline"
          >
            Create or manage bots via @BotFather
            <ExternalLink className="size-3" />
          </a>
        </div>

        <Button
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Updating...' : 'Update Token'}
        </Button>
      </form>
    </Card>
  );
}
