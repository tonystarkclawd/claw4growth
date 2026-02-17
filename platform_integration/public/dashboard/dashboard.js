// Claw4Growth Customer Dashboard

const apps = [
    { id: 'googlesuper', name: 'Google Suite', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/google.svg', sub: 'Drive, Gmail, Sheets, Calendar, Ads, Analytics', accounts: [] },
    { id: 'facebook', name: 'Facebook', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/facebook.svg', accounts: [] },
    { id: 'meta', name: 'Meta Ads', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/meta.svg', accounts: [] },
    { id: 'instagram', name: 'Instagram', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/instagram.svg', accounts: [] },
    { id: 'linkedin', name: 'LinkedIn', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/linkedin.svg', accounts: [] },
    { id: 'tiktok', name: 'TikTok', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/tiktok.svg', accounts: [] },
    { id: 'stripe', name: 'Stripe', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/stripe.svg', accounts: [] },
    { id: 'shopify', name: 'Shopify', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/shopify.svg', accounts: [] },
    { id: 'hubspot', name: 'HubSpot', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/hubspot.svg', accounts: [] },
    { id: 'notion', name: 'Notion', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/notion.svg', accounts: [] },
];

// Demo: simulate some connected accounts
apps[0].accounts = [{ email: 'hello@acme.com', id: 'demo1' }]; // Google Suite

function renderApps() {
    const grid = document.getElementById('appsGrid');
    grid.innerHTML = '';

    apps.forEach(app => {
        const connected = app.accounts.length > 0;
        const card = document.createElement('div');
        card.className = 'dash-app-card' + (connected ? ' connected' : '');
        
        let accountsHTML = '';
        if (app.accounts.length > 0) {
            accountsHTML = '<div class="dash-app-accounts">';
            app.accounts.forEach(acc => {
                accountsHTML += `
                    <div class="dash-account">
                        <span class="dash-account-email">${acc.email}</span>
                        <button class="dash-account-remove" onclick="removeAccount('${app.id}','${acc.id}')">REMOVE</button>
                    </div>`;
            });
            accountsHTML += '</div>';
        }

        card.innerHTML = `
            <div class="dash-app-header">
                <div class="dash-app-info">
                    <div class="dash-app-icon"><img src="${app.icon}" alt="${app.name}" style="width:24px;height:24px;filter:invert(1);"></div>
                    <span class="dash-app-name">${app.name}</span>
                </div>
                <span class="dash-app-status ${connected ? 'on' : 'off'}">${connected ? 'CONNECTED' : 'NOT CONNECTED'}</span>
            </div>
            ${accountsHTML}
            ${connected 
                ? `<button class="dash-app-btn add-account" onclick="connectApp('${app.id}')">+ ADD ACCOUNT</button>`
                : `<button class="dash-app-btn connect" onclick="connectApp('${app.id}')">CONNECT</button>`
            }
        `;
        grid.appendChild(card);
    });
}

function connectApp(appId) {
    // TODO: Composio OAuth popup
    const app = apps.find(a => a.id === appId);
    const demoEmail = prompt(`Connect ${app.name} account (enter email/ID):`);
    if (demoEmail) {
        app.accounts.push({ email: demoEmail, id: 'acc_' + Date.now() });
        renderApps();
    }
}

function removeAccount(appId, accId) {
    const app = apps.find(a => a.id === appId);
    app.accounts = app.accounts.filter(a => a.id !== accId);
    renderApps();
}

function manageSubscription() {
    // TODO: Stripe Customer Portal redirect
    alert('Redirecting to Stripe Customer Portal...');
}

function cancelSubscription() {
    if (confirm('Are you sure you want to cancel your subscription? Your operator will stop at the end of the billing period.')) {
        // TODO: Stripe cancellation
        alert('Subscription cancelled. Active until March 14, 2026.');
    }
}

// Init
renderApps();
