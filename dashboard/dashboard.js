// Claw4Growth Customer Dashboard

const apps = [
    { id: 'linkedin', name: 'LinkedIn', icon: 'in', accounts: [] },
    { id: 'gmail', name: 'Gmail', icon: 'M', accounts: [] },
    { id: 'calendar', name: 'Calendar', icon: 'C', accounts: [] },
    { id: 'sheets', name: 'Sheets', icon: 'S', accounts: [] },
    { id: 'notion', name: 'Notion', icon: 'N', accounts: [] },
    { id: 'analytics', name: 'Analytics', icon: 'A', accounts: [] },
    { id: 'meta', name: 'Meta Ads', icon: 'f', accounts: [] },
    { id: 'gsc', name: 'Search Console', icon: 'G', accounts: [] },
];

// Demo: simulate some connected accounts
apps[1].accounts = [{ email: 'hello@acme.com', id: 'demo1' }]; // Gmail
apps[5].accounts = [{ email: 'UA-12345678', id: 'demo2' }]; // Analytics

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
                    <div class="dash-app-icon">${app.icon}</div>
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
