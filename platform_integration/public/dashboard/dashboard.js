// Claw4Growth Customer Dashboard — Real Data + Auth

const API_BASE = 'https://app.claw4growth.com';
const SUPABASE_URL = 'https://frejiknxricrkkcgzwdh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyZWppa254cmljcmtrY2d6d2RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQwNDcsImV4cCI6MjA4Njc1MDA0N30.dI_wSjcNHJZf-uw2TKNl4VK04vOAF-xWdv6f00E0C7M';

// ===== APP DEFINITIONS =====
// Groups: apps with a `group` key are rendered inside a collapsible section.
const apps = [
    // — Google —
    { id: 'gmail',              name: 'Gmail',              icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/gmail.svg',            sub: 'Email, contacts, drafts',          group: 'Google' },
    { id: 'googlecalendar',     name: 'Google Calendar',    icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googlecalendar.svg',   sub: 'Events, scheduling',               group: 'Google' },
    { id: 'googlesheets',       name: 'Google Sheets',      icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googlesheets.svg',     sub: 'Spreadsheets, data tracking',      group: 'Google' },
    { id: 'googledrive',        name: 'Google Drive',       icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googledrive.svg',      sub: 'Files, folders, sharing',           group: 'Google' },
    { id: 'googledocs',         name: 'Google Docs',        icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googledocs.svg',       sub: 'Documents, reports',                group: 'Google' },
    { id: 'google_analytics',   name: 'Google Analytics',   icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googleanalytics.svg',  sub: 'GA4 reports, audiences, events',    group: 'Google' },
    { id: 'googleads',          name: 'Google Ads',         icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/googleads.svg',        sub: 'Campaigns, customer lists',         group: 'Google' },
    // — Meta —
    { id: 'facebook',           name: 'Facebook',           icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/facebook.svg',         sub: 'Pages, Messenger, insights',        group: 'Meta' },
    { id: 'instagram',          name: 'Instagram',          icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/instagram.svg',        sub: 'Posts, stories, DMs, analytics',    group: 'Meta' },
    { id: 'metaads',            name: 'Meta Ads',           icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/meta.svg',             sub: 'Ad campaigns, audiences, insights', group: 'Meta' },
    // — Other —
    { id: 'linkedin', name: 'LinkedIn', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/linkedin.svg' },
    { id: 'reddit', name: 'Reddit', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/reddit.svg', sub: 'Posts, comments, subreddit search' },
    { id: 'stripe', name: 'Stripe', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/stripe.svg' },
    { id: 'shopify', name: 'Shopify', icon: 'https://cdn.jsdelivr.net/npm/simple-icons@v13/icons/shopify.svg', sub: 'Products, orders, customers, inventory', inputField: { key: 'subdomain', label: 'Store name (e.g. my-store)', placeholder: 'my-store' } },
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
        showLoginScreen();
        return;
    }
    // Token exists — hide login immediately, show loading state
    var login = document.getElementById('loginScreen');
    var nav = document.getElementById('dashNav');
    var main = document.getElementById('dashMain');
    if (login) login.style.display = 'none';
    if (nav) nav.style.display = '';
    if (main) { main.style.display = ''; main.style.opacity = '0.5'; }
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

        // No instance = user hasn't completed onboarding → redirect
        if (!data.instance) {
            window.location.href = '/onboarding/';
            return;
        }

        dashState.user = data.user;
        dashState.instance = data.instance;
        dashState.subscription = data.subscription;
        dashState.connections = data.connections || {};
        dashState.usage = data.usage || null;

        // Use Supabase user ID as Composio entityId (stable, unique per user)
        dashState.entityId = data.user.id || 'default';

        hideLoginScreen();
        var main = document.getElementById('dashMain');
        if (main) main.style.opacity = '';
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

    // Group apps by their group key; ungrouped apps rendered individually
    var groups = {};
    var ungrouped = [];
    apps.forEach(function(app) {
        if (app.group) {
            if (!groups[app.group]) groups[app.group] = [];
            groups[app.group].push(app);
        } else {
            ungrouped.push(app);
        }
    });

    // Render groups first
    var groupOrder = ['Google', 'Meta'];
    groupOrder.forEach(function(groupName) {
        var groupApps = groups[groupName];
        if (!groupApps) return;

        var section = document.createElement('div');
        section.className = 'dash-app-group';

        // Count connected in group
        var connCount = 0;
        groupApps.forEach(function(a) {
            if (dashState.connections[a.id] && dashState.connections[a.id].connected) connCount++;
        });

        var header = document.createElement('div');
        header.className = 'dash-app-group-header';
        header.innerHTML =
            '<span class="dash-app-group-name">' + groupName + '</span>' +
            '<span class="dash-app-group-count">' + connCount + '/' + groupApps.length + ' connected</span>' +
            '<span class="dash-app-group-toggle">▼</span>';
        header.onclick = function() {
            var inner = section.querySelector('.dash-app-group-inner');
            var toggle = header.querySelector('.dash-app-group-toggle');
            if (inner.style.display === 'none') {
                inner.style.display = '';
                toggle.textContent = '▼';
            } else {
                inner.style.display = 'none';
                toggle.textContent = '▶';
            }
        };
        section.appendChild(header);

        var inner = document.createElement('div');
        inner.className = 'dash-app-group-inner';
        groupApps.forEach(function(app) {
            inner.appendChild(renderAppCard(app));
        });
        section.appendChild(inner);
        grid.appendChild(section);
    });

    // Render ungrouped apps inside an "Other" group container
    if (ungrouped.length > 0) {
        var otherSection = document.createElement('div');
        otherSection.className = 'dash-app-group';

        var otherConnCount = 0;
        ungrouped.forEach(function(a) {
            if (dashState.connections[a.id] && dashState.connections[a.id].connected) otherConnCount++;
        });

        var otherHeader = document.createElement('div');
        otherHeader.className = 'dash-app-group-header';
        otherHeader.innerHTML =
            '<span class="dash-app-group-name">Other</span>' +
            '<span class="dash-app-group-count">' + otherConnCount + '/' + ungrouped.length + ' connected</span>' +
            '<span class="dash-app-group-toggle">▼</span>';
        otherHeader.onclick = function() {
            var inner = otherSection.querySelector('.dash-app-group-inner');
            var toggle = otherHeader.querySelector('.dash-app-group-toggle');
            if (inner.style.display === 'none') {
                inner.style.display = '';
                toggle.textContent = '▼';
            } else {
                inner.style.display = 'none';
                toggle.textContent = '▶';
            }
        };
        otherSection.appendChild(otherHeader);

        var otherInner = document.createElement('div');
        otherInner.className = 'dash-app-group-inner';
        ungrouped.forEach(function(app) {
            otherInner.appendChild(renderAppCard(app));
        });
        otherSection.appendChild(otherInner);
        grid.appendChild(otherSection);
    }
}

function renderAppCard(app) {
    var conn = dashState.connections[app.id] || {};
    var connected = !!conn.connected;
    var card = document.createElement('div');
    card.className = 'dash-app-card' + (connected ? ' connected' : '') + (app.comingSoon ? ' coming-soon' : '');

    var btnHtml;
    var inputHtml = '';
    if (app.comingSoon) {
        btnHtml = '<button class="dash-app-btn coming-soon" disabled>COMING SOON</button>';
    } else if (connected) {
        btnHtml = '<button class="dash-app-btn disconnect" onclick="disconnectApp(\'' + app.id + '\', \'' + (conn.connectionId || '') + '\')">DISCONNECT</button>';
    } else if (app.inputField) {
        var f = app.inputField;
        inputHtml = '<div class="dash-app-input-row">' +
            '<input type="text" id="input_' + app.id + '_' + f.key + '" class="dash-app-input" placeholder="' + (f.placeholder || f.label) + '">' +
            '</div>';
        btnHtml = '<button class="dash-app-btn connect" onclick="connectAppWithInput(\'' + app.id + '\', \'' + f.key + '\')">CONNECT</button>';
    } else {
        btnHtml = '<button class="dash-app-btn connect" onclick="connectApp(\'' + app.id + '\')">CONNECT</button>';
    }

    card.innerHTML =
        '<div class="dash-app-header">' +
            '<div class="dash-app-info">' +
                '<div class="dash-app-icon"><img src="' + app.icon + '" alt="' + app.name + '" style="width:24px;height:24px;filter:invert(1);"></div>' +
                '<span class="dash-app-name">' + app.name + '</span>' +
            '</div>' +
            '<span class="dash-app-status ' + (connected ? 'on' : 'off') + '">' + (connected ? 'CONNECTED' : (app.comingSoon ? 'COMING SOON' : 'NOT CONNECTED')) + '</span>' +
        '</div>' +
        (app.sub ? '<div class="dash-app-sub">' + app.sub + '</div>' : '') +
        inputHtml +
        btnHtml;

    return card;
}

// ===== RENDER: SUBSCRIPTION =====

// Price per tier (EUR)
var TIER_PRICES = {
    pro: '€34.90',
    enterprise: 'Custom',
};

function renderSubscription() {
    var sub = dashState.subscription;
    var planNameEl = document.getElementById('planName');
    var planPriceEl = document.getElementById('planPrice');
    var nextBillingEl = document.getElementById('nextBilling');
    var usageSection = document.getElementById('usageSection');

    if (!sub) {
        if (planNameEl) planNameEl.textContent = 'NO ACTIVE PLAN';
        if (planPriceEl) planPriceEl.textContent = '—';
        if (nextBillingEl) nextBillingEl.textContent = '—';
        if (usageSection) usageSection.style.display = 'none';
        return;
    }

    var tier = (sub.tier || 'pro');
    if (planNameEl) {
        planNameEl.textContent = tier.toUpperCase() + ' MONTHLY';
    }

    if (planPriceEl) {
        planPriceEl.textContent = TIER_PRICES[tier] || '€34.90';
    }

    if (nextBillingEl && sub.current_period_end) {
        var d = new Date(sub.current_period_end);
        nextBillingEl.textContent = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    }

    if (sub.status === 'canceled') {
        if (planNameEl) planNameEl.textContent += ' (CANCELED)';
    }

    // Show real API usage data
    var usage = dashState.usage;
    if (usageSection && usage) {
        usageSection.style.display = '';
        var pctEl = document.getElementById('usagePct');
        var fillEl = document.getElementById('usageFill');
        var noteEl = document.querySelector('.dash-usage-note');
        if (pctEl) pctEl.textContent = usage.pct + '%';
        if (fillEl) fillEl.style.width = usage.pct + '%';
        if (noteEl) noteEl.textContent = 'AI usage this month — Resets monthly.';
    } else if (usageSection) {
        usageSection.style.display = 'none';
    }
}

// ===== ACTIONS =====

function connectApp(appId) {
    var entityId = dashState.entityId || 'default';
    var url = API_BASE + '/api/composio-connect?app=' + appId + '&entityId=' + entityId + '&redirectTo=/dashboard/';
    window.location.href = url;
}

function connectAppWithInput(appId, fieldKey) {
    var input = document.getElementById('input_' + appId + '_' + fieldKey);
    var value = input ? input.value.trim() : '';
    if (!value) {
        input.style.borderColor = 'var(--red)';
        input.focus();
        return;
    }
    var entityId = dashState.entityId || 'default';
    var url = API_BASE + '/api/composio-connect?app=' + appId + '&entityId=' + entityId + '&redirectTo=/dashboard/&' + fieldKey + '=' + encodeURIComponent(value);
    window.location.href = url;
}

function disconnectApp(appId, connectionId) {
    if (!confirm('Disconnect ' + appId + '? Your operator will lose access to this tool.')) {
        return;
    }
    var token = getToken();
    if (!token) { logout(); return; }

    fetch(API_BASE + '/api/composio-disconnect', {
        method: 'POST',
        headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ connectionId: connectionId }),
    })
    .then(function(r) {
        if (r.status === 401) { logout(); return null; }
        return r.json();
    })
    .then(function(data) {
        if (data && data.ok) {
            // Update local state and re-render
            dashState.connections[appId] = { connected: false };
            renderApps();
        } else if (data && data.error) {
            alert('Error: ' + data.error);
        }
    })
    .catch(function(err) {
        console.error('Disconnect error:', err);
        alert('Failed to disconnect.');
    });
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
