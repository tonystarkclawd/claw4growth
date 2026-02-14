# Claw4Growth — Customer Dashboard

Post-onboarding dashboard for Claw4Growth customers.

## Files

- **index.html** — Main dashboard page
- **dashboard.css** — Dashboard-specific styles (builds on top of landing page CSS)
- **dashboard.js** — Interactive functionality and data management

## Design

Inherits the exact brand identity from the Claw4Growth landing page:

- **Fonts:** Press Start 2P (pixel), Inter (body), JetBrains Mono (mono)
- **Colors:** 
  - Background: `#0a0a0a`
  - Accent green: `#5dba3b` / `#00ff00`
  - Yellow: `#fcdb05`
- **Visual elements:**
  - CRT overlay
  - Falling marketing words background
  - Beveled Minecraft-style panels
  - Dark terminal aesthetic

## Features

### Section 1: Connections

- Grid of 8 app integration cards:
  - LinkedIn
  - Gmail
  - Google Calendar
  - Google Sheets
  - Notion
  - Google Analytics
  - Meta Ads
  - Google Search Console

- Each card shows:
  - App icon and name
  - Connection status (Connected/Not connected)
  - For connected apps: green border + checkmark
  - For not connected: gray border

- **Multiple accounts support:**
  - Each app can have multiple connected accounts (e.g., 2 Gmail accounts)
  - Connected accounts shown as sub-items with email/identifier
  - Each account has a "Disconnect" button
  - "Add Another Account" button to connect additional accounts

- **Connect flow:**
  - "Connect" button triggers OAuth modal (placeholder for now)
  - In production, this would open OAuth popup for each service

### Section 2: Subscription

- Current plan display (Monthly €49.90 or Annual €39.90/mo)
- Next billing date
- API usage bar:
  - Visual progress bar showing percentage used
  - Example: 45% of included requests
  - Shows actual numbers: "4,500 / 10,000 requests"
- Action buttons:
  - "Manage Subscription" → links to Stripe Customer Portal
  - "Cancel Plan" → cancellation flow

## Usage

### Local Development

Open `index.html` in a browser. The dashboard uses `../style.css` as the base stylesheet (relative path to landing page CSS).

### Production Integration

1. **Replace placeholder data** in `dashboard.js`:
   - Fetch actual connected apps from backend API
   - Load subscription data from Stripe
   - Get real usage metrics from API usage tracking

2. **Implement OAuth flows:**
   - Replace modal placeholders with actual OAuth implementations
   - Use popup windows or redirect flows for each service
   - Store OAuth tokens securely in backend

3. **User authentication:**
   - Set operator name from authenticated user session
   - Personalize dashboard based on user data

4. **Stripe integration:**
   - "Manage Subscription" → Stripe Customer Portal URL
   - "Cancel Plan" → Stripe cancellation API
   - Fetch billing details from Stripe API

## Data Structure

Apps are stored in the `APPS` array in `dashboard.js`:

```javascript
{
    id: 'gmail',
    name: 'Gmail',
    icon: '📧',
    accounts: [
        { email: 'user@example.com', connected: true },
        { email: 'marketing@example.com', connected: true }
    ]
}
```

## Responsive Design

- Desktop: 4-column app grid
- Tablet: 2-column grid
- Mobile: Single column, stacked layout
- All panels and buttons adapt to screen size

## Next Steps

1. Connect to backend API for real data
2. Implement OAuth flows for each service
3. Integrate with Stripe for subscription management
4. Add loading states and error handling
5. Implement real-time usage updates
6. Add account sync status indicators
