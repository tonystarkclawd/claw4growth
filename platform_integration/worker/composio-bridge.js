#!/usr/bin/env node
/**
 * C4G Composio Bridge
 *
 * Lightweight CLI that OpenClaw agents call via Bash to execute Composio tools.
 * Runs inside containers or on the VPS — requires COMPOSIO_API_KEY env var.
 *
 * Usage:
 *   node composio-bridge.js list-apps <user_id>
 *   node composio-bridge.js list-tools <user_id> [toolkit]
 *   node composio-bridge.js execute <user_id> <tool_slug> [json_args]
 *
 * Examples:
 *   node composio-bridge.js list-apps 5174719a-...
 *   node composio-bridge.js list-tools 5174719a-... gmail
 *   node composio-bridge.js execute 5174719a-... GMAIL_SEND_EMAIL '{"to":"a@b.com","subject":"Hi","body":"Hello"}'
 */

const { Composio } = require('@composio/core');

const API_KEY = process.env.COMPOSIO_API_KEY;
if (!API_KEY) {
  console.error(JSON.stringify({ error: 'COMPOSIO_API_KEY not set' }));
  process.exit(1);
}

const composio = new Composio({ apiKey: API_KEY });

const [,, command, userId, ...rest] = process.argv;

if (!command || !userId) {
  console.error(JSON.stringify({ error: 'Usage: composio-bridge.js <command> <user_id> [args...]' }));
  process.exit(1);
}

(async () => {
  try {
    switch (command) {
      case 'list-apps': {
        const accounts = await composio.connectedAccounts.list({ userId });
        const apps = [];
        for (const a of accounts.items || []) {
          if (a.status === 'ACTIVE') {
            const detail = await composio.connectedAccounts.get(a.id);
            apps.push({
              id: a.id,
              app: detail.toolkit?.slug || 'unknown',
              status: a.status,
            });
          }
        }
        console.log(JSON.stringify({ apps }, null, 2));
        break;
      }

      case 'list-tools': {
        const toolkit = rest[0];
        if (!toolkit) {
          console.error(JSON.stringify({ error: 'Usage: list-tools <user_id> <toolkit>' }));
          process.exit(1);
        }
        const tools = await composio.tools.get({
          toolkits: [toolkit],
          userId,
        });
        const list = (tools || []).map(t => ({
          slug: t.slug || t.name,
          description: t.description?.substring(0, 120),
        }));
        console.log(JSON.stringify({ tools: list }, null, 2));
        break;
      }

      case 'execute': {
        const toolSlug = rest[0];
        const argsJson = rest[1] || '{}';
        if (!toolSlug) {
          console.error(JSON.stringify({ error: 'Usage: execute <user_id> <tool_slug> [json_args]' }));
          process.exit(1);
        }
        let args;
        try {
          args = JSON.parse(argsJson);
        } catch {
          console.error(JSON.stringify({ error: 'Invalid JSON arguments' }));
          process.exit(1);
        }

        const result = await composio.tools.execute(toolSlug, {
          userId,
          arguments: args,
          dangerouslySkipVersionCheck: true,
        });
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(JSON.stringify({ error: `Unknown command: ${command}. Use: list-apps, list-tools, execute` }));
        process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  }
})();
