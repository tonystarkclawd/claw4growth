// Claw4Growth Customer Dashboard — Real Data + Auth

const API_BASE = 'https://app.claw4growth.com';
const SUPABASE_URL = 'https://frejiknxricrkkcgzwdh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyZWppa254cmljcmtrY2d6d2RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQwNDcsImV4cCI6MjA4Njc1MDA0N30.dI_wSjcNHJZf-uw2TKNl4VK04vOAF-xWdv6f00E0C7M';

// ===== APP DEFINITIONS =====
const apps = [
    { id: 'googlesuper', name: 'Google Suite', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/google.svg', sub: 'Drive, Gmail, Sheets, Calendar, Ads, Analytics' },
    { id: 'facebook', name: 'Facebook', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/facebook.svg', sub: 'Pages, Messenger, Meta Ads, Insights' },
    { id: 'instagram', name: 'Instagram', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/instagram.svg' },
    { id: 'linkedin', name: 'LinkedIn', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/linkedin.svg' },
    { id: 'stripe', name: 'Stripe', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/stripe.svg' },
    { id: 'shopify', name: 'Shopify', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/shopify.svg' },
    { id: 'hubspot', name: 'HubSpot', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/hubspot.svg' },
    { id: 'notion', name: 'Notion', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/notion.svg' },
];

// State populated by API
var dashState = {
    user: null,
    instance: null,
    subscription: null,
    connections: {},
    entityId: null,
};

// ===== AUTH =====

function getToken() {
    return localStorage.getItem('c4g_access_token');
}

function loginWithGoogle() {
    var redirectTo = window.location.origin + '/dashboard/';
    var authUrl = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
    window.location.href = authUrl;
}

function logout() {
    localStorage.removeItem('c4g_access_token');
    localStorage.removeItem('c4g_logged_in');
    localStorage.removeItem('c4g_user_id');
    localStorage.removeItem('c4g_user_email');
    showLoginScreen();
}

// Handle OAuth hash callback
(function handleAuthCallback() {
    var hash = window.location.hash;
    if (hash && hash.includes('access_token')) {
        var hashParams = new URLSearchParams(hash.substring(1));
        var accessToken = hashParams.get('access_token');
        if (accessToken) {
            localStorage.setItem('c4g_access_token', accessToken);
            localStorage.setItem('c4g_logged_in', 'true');
            window.history.replaceState({}, '', window.location.pathname);
        }
    }

    // Handle ?connected=appName after Composio OAuth return
    var params = new URLSearchParams(window.location.search);
    if (params.get('connected')) {
        window.history.replaceState({}, '', window.location.pathname);
    }
})();

// ===== INIT =====

(function init() {
    var token = getToken();
    if (!token) {
        // Show login screen, hide dashboard
        showLoginScreen();
        return;
    }
    // Authenticated — hide login, show dashboard
    hideLoginScreen();
    loadDashboard(token);
})();

function showLoginScreen() {
    var login = document.getElementById('loginScreen');
    var nav = document.getElementById('dashNav');
    var main = document.getElementById('dashMain');
    if (login) login.style.display = '';
    if (nav) nav.style.display = 'none';
    if (main) main.style.display = 'none';
}

function hideLoginScreen() {
    var login = document.getElementById('loginScreen');
    var nav = document.getElementById('dashNav');
    var main = document.getElementById('dashMain');
    if (login) login.style.display = 'none';
    if (nav) nav.style.display = '';
    if (main) main.style.display = '';
}

function loadDashboard(token) {
    fetch(API_BASE + '/api/dashboard/status', {
        headers: { 'Authorization': 'Bearer ' + token },
    })
    .then(function(r) {
        if (r.status === 401) {
            logout();
            return null;
        }
        return r.json();
    })
    .then(function(data) {
        if (!data) return;
        dashState.user = data.user;
        dashState.instance = data.instance;
        dashState.subscription = data.subscription;
        dashState.connections = data.connections || {};

        // Derive entityId from onboarding state or user email
        var savedOnboarding = JSON.parse(localStorage.getItem('c4g_onboarding_state') || '{}');
        var opName = savedOnboarding.operatorName;
        dashState.entityId = opName
            ? opName.replace(/\s+/g, '_').toLowerCase()
            : 'default';

        renderNavUser();
        renderApps();
        renderSubscription();
    })
    .catch(function(err) {
        console.error('Dashboard load error:', err);
    });
}

// ===== RENDER: NAV =====

function renderNavUser() {
    var el = document.getElementById('dashUser');
    if (el && dashState.user) {
        var name = dashState.user.email ? dashState.user.email.split('@')[0] : 'User';
        el.textContent = name + "'s Dashboard";
    }
}

// ===== RENDER: APPS GRID =====

function renderApps() {
    var grid = document.getElementById('appsGrid');
    if (!grid) return;
    grid.innerHTML = '';

    apps.forEach(function(app) {
        var connected = !!dashState.connections[app.id];
        var card = document.createElement('div');
        card.className = 'dash-app-card' + (connected ? ' connected' : '');

        card.innerHTML =
            '<div class="dash-app-header">' +
                '<div class="dash-app-info">' +
                    '<div class="dash-app-icon"><img src="' + app.icon + '" alt="' + app.name + '" style="width:24px;height:24px;filter:invert(1);"></div>' +
                    '<span class="dash-app-name">' + app.name + '</span>' +
                '</div>' +
                '<span class="dash-app-status ' + (connected ? 'on' : 'off') + '">' + (connected ? 'CONNECTED' : 'NOT CONNECTED') + '</span>' +
            '</div>' +
            (app.sub ? '<div class="dash-app-sub">' + app.sub + '</div>' : '') +
            (connected
                ? '<button class="dash-app-btn add-account" onclick="connectApp(\'' + app.id + '\')">+ ADD ACCOUNT</button>'
                : '<button class="dash-app-btn connect" onclick="connectApp(\'' + app.id + '\')">CONNECT</button>'
            );

        grid.appendChild(card);
    });
}

// ===== RENDER: SUBSCRIPTION =====

function renderSubscription() {
    var sub = dashState.subscription;
    var planNameEl = document.getElementById('planName');
    var planPriceEl = document.getElementById('planPrice');
    var nextBillingEl = document.getElementById('nextBilling');

    if (!sub) {
        if (planNameEl) planNameEl.textContent = 'NO ACTIVE PLAN';
        if (planPriceEl) planPriceEl.textContent = '—';
        if (nextBillingEl) nextBillingEl.textContent = '—';
        return;
    }

    if (planNameEl) {
        var tierLabel = (sub.tier || 'pro').toUpperCase();
        planNameEl.textContent = tierLabel + ' MONTHLY';
    }

    if (nextBillingEl && sub.current_period_end) {
        var d = new Date(sub.current_period_end);
        nextBillingEl.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    if (sub.status === 'canceled') {
        if (planNameEl) planNameEl.textContent += ' (CANCELED)';
    }
}

// ===== ACTIONS =====

function connectApp(appId) {
    var entityId = dashState.entityId || 'default';
    // Map dashboard IDs to composio-connect expected IDs
    var composioAppMap = {
        googlesuper: 'google',
        meta: 'metaads',
    };
    var composioApp = composioAppMap[appId] || appId;
    var url = API_BASE + '/api/composio-connect?app=' + composioApp + '&entityId=' + entityId + '&redirectTo=/dashboard/';
    window.location.href = url;
}

function manageSubscription() {
    var token = getToken();
    if (!token) { logout(); return; }

    fetch(API_BASE + '/api/stripe/portal', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
    })
    .then(function(r) {
        if (r.status === 401) { logout(); return null; }
        return r.json();
    })
    .then(function(data) {
        if (data && data.url) {
            window.location.href = data.url;
        } else if (data && data.error) {
            alert('Error: ' + data.error);
        }
    })
    .catch(function(err) {
        console.error('Manage subscription error:', err);
        alert('Failed to open subscription portal.');
    });
}

function cancelSubscription() {
    if (!confirm('Are you sure you want to cancel your subscription? Your operator will stop at the end of the billing period.')) {
        return;
    }
    // The Stripe portal handles cancellation — same endpoint
    manageSubscription();
}
