// Supabase config
const SUPABASE_URL = 'https://frejiknxricrkkcgzwdh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyZWppa254cmljcmtrY2d6d2RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQwNDcsImV4cCI6MjA4Njc1MDA0N30.dI_wSjcNHJZf-uw2TKNl4VK04vOAF-xWdv6f00E0C7M';

function loginWithGoogle() {
    const redirectTo = 'https://claw4growth.com/onboarding/';
    const authUrl = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
    window.location.href = authUrl;
}

// ===== STATE MANAGEMENT (must be BEFORE handleAuthCallback IIFE) =====
const savedState = JSON.parse(localStorage.getItem('c4g_onboarding_state') || '{}');

const state = {
    screen: savedState.screen || 1,
    totalScreens: 6, // Screen 6 (Connect Tools) removed from flow
    userId: savedState.userId || null,
    userEmail: savedState.userEmail || null,
    operatorName: savedState.operatorName || '',
    brand: savedState.brand || { name: '', industry: '', description: '', website: '' },
    tone: savedState.tone || '',
    connectedApps: savedState.connectedApps || [],
    plan: savedState.plan || 'earlybird',
    paid: savedState.paid || false,
    instanceId: savedState.instanceId || null,
    subdomain: savedState.subdomain || null
};

function saveState() {
    localStorage.setItem('c4g_onboarding_state', JSON.stringify(state));
}

function goToScreen(n) {
    document.querySelectorAll('.ob-screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + n).classList.add('active');
    state.screen = n;
    saveState();
    document.getElementById('progressBar').style.width = (n / state.totalScreens * 100) + '%';
    // Show paid message on screen 5 if already paid
    if (n === 5 && state.paid) {
        const paymentBtn = document.getElementById('paymentBtn');
        const paidMsg = document.getElementById('paidMessage');
        if (paymentBtn) paymentBtn.style.display = 'none';
        if (paidMsg) paidMsg.style.display = 'block';
    }
}

// ===== AUTH CALLBACK HANDLER =====
// Handle OAuth callback - check URL for auth tokens
(function handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash;
    // Supabase returns tokens in hash fragment
    if (hash && hash.includes('access_token')) {
        const hashParams = new URLSearchParams(hash.substring(1));
        const accessToken = hashParams.get('access_token');
        if (accessToken) {
            localStorage.setItem('c4g_access_token', accessToken);
            localStorage.setItem('c4g_logged_in', 'true');
            // Clean URL and go to screen 2
            window.history.replaceState({}, '', window.location.pathname);
            setTimeout(function () { goToScreen(2); }, 100);
            return;
        }
    }
    // Handle step parameter FIRST (e.g. after Stripe checkout or Composio OAuth)
    var step = params.get('step');
    var connected = params.get('connected');
    var unsupported = params.get('unsupported');

    // Handle Stripe checkout success - go to integrations (Screen 6)
    var checkoutSuccess = params.get('checkout_success') || params.get('session_id');

    if (checkoutSuccess) {
        window.history.replaceState({}, '', window.location.pathname);
        state.paid = true;
        saveState();
        setTimeout(function () {
            goToScreen(7);
            simulateDeploy();
        }, 100);
        return;
    }

    if (step) {
        window.history.replaceState({}, '', window.location.pathname);
        var targetStep = parseInt(step);
        // Screen 6 (Connect Tools) removed — redirect to deploy
        if (targetStep === 6) {
            state.paid = true;
            saveState();
            setTimeout(function () {
                goToScreen(7);
                simulateDeploy();
            }, 100);
        } else {
            setTimeout(function () {
                goToScreen(targetStep);
                // After screen loads, mark connected apps
                setTimeout(function () {
                    if (connected) markAppConnected(connected);
                    if (unsupported) showUnsupportedMessage(unsupported);
                }, 200);
            }, 100);
        }
    }
    // If no URL params but saved state exists, restore to saved screen (skip payment if already paid)
    else if (state.screen > 1) {
        if (state.screen === 5 && state.paid) {
            setTimeout(function () { goToScreen(7); simulateDeploy(); }, 100);
        } else {
            setTimeout(function () { goToScreen(state.screen); }, 100);
        }
    }
    // If no step but logged in, go to screen 2
    else if (params.get('auth') === 'callback' || localStorage.getItem('c4g_logged_in') === 'true') {
        setTimeout(function () { goToScreen(2); }, 100);
    }
})();

function markAppConnected(app) {
    const card = document.querySelector('[data-app="' + app + '"]');
    if (card) {
        card.classList.remove('connecting');
        card.classList.add('connected');
        if (!state.connectedApps.includes(app)) {
            state.connectedApps.push(app);
            saveState();
        }
        // Add visual feedback
        const statusEl = card.querySelector('.ob-app-status');
        if (statusEl) statusEl.textContent = '✓ Connected';
    }
}

function showUnsupportedMessage(app) {
    const card = document.querySelector('[data-app="' + app + '"]');
    if (card) {
        card.classList.remove('connecting');
        card.classList.add('unsupported');
        const statusEl = card.querySelector('.ob-app-status');
        if (statusEl) statusEl.textContent = 'Coming Soon';
    }
}

// Restore saved state on page load
(function restoreState() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', doRestore);
    } else {
        doRestore();
    }

    function doRestore() {
        // Restore form fields
        if (state.operatorName && document.getElementById('operatorName')) {
            document.getElementById('operatorName').value = state.operatorName;
        }
        if (state.brand.name && document.getElementById('brandName')) {
            document.getElementById('brandName').value = state.brand.name;
        }
        if (state.brand.industry && document.getElementById('brandIndustry')) {
            document.getElementById('brandIndustry').value = state.brand.industry;
        }
        if (state.brand.description && document.getElementById('brandDescription')) {
            document.getElementById('brandDescription').value = state.brand.description;
            document.getElementById('descCount').textContent = state.brand.description.length;
        }
        if (state.brand.website && document.getElementById('brandWebsite')) {
            document.getElementById('brandWebsite').value = state.brand.website;
        }
        if (state.tone) {
            document.querySelectorAll('.ob-tone-card').forEach(c => {
                if (c.dataset.tone === state.tone) c.classList.add('selected');
            });
            const toneBtn = document.getElementById('toneContinueBtn');
            if (toneBtn) toneBtn.disabled = false;
        }
        // Restore connected apps visual state
        state.connectedApps.forEach(app => {
            const card = document.querySelector('[data-app="' + app + '"]');
            if (card) {
                card.classList.add('connected');
                const statusEl = card.querySelector('.ob-app-status');
                if (statusEl) statusEl.textContent = '✓ Connected';
            }
        });
    }
})();

// Screen 2: Name
function saveNameAndContinue() {
    const name = document.getElementById('operatorName').value.trim();
    if (!name) {
        document.getElementById('operatorName').style.borderColor = '#ff5555';
        return;
    }
    state.operatorName = name;
    saveState();
    goToScreen(3);
}

// Screen 3: Brand
document.getElementById('brandDescription')?.addEventListener('input', function () {
    document.getElementById('descCount').textContent = this.value.length;
});

function saveBrandAndContinue() {
    const name = document.getElementById('brandName').value.trim();
    const industry = document.getElementById('brandIndustry').value;
    const description = document.getElementById('brandDescription').value.trim();
    const website = document.getElementById('brandUrl').value.trim();

    if (!name || !industry) {
        if (!name) document.getElementById('brandName').style.borderColor = '#ff5555';
        if (!industry) document.getElementById('brandIndustry').style.borderColor = '#ff5555';
        return;
    }

    state.brand = { name, industry, description, website };
    saveState();
    goToScreen(4);
}

// Screen 4: Tone
function selectTone(el) {
    document.querySelectorAll('.ob-tone-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    state.tone = el.dataset.tone;
    saveState();
    document.getElementById('toneContinueBtn').disabled = false;
}

function saveToneAndContinue() {
    if (!state.tone) return;
    saveState();
    // Skip payment if already paid — go directly to deploy
    if (state.paid) {
        goToScreen(7);
        simulateDeploy();
    } else {
        goToScreen(5);
    }
}

// Screen 5: Payment
function startPayment() {
    // Redirect to Stripe Checkout (test mode)
    window.location.href = 'https://app.claw4growth.com/api/checkout-public';
}

// Screen 6: Apps
function toggleApp(el) {
    const app = el.dataset.app;
    // Check if app needs full redirect vs popup
    const needsRedirect = ['facebook', 'instagram', 'metaads', 'shopify', 'linkedin', 'notion', 'hubspot', 'stripe'].includes(app);

    // If not connected yet, launch Composio OAuth
    if (!el.classList.contains('connected')) {
        const entityId = state.name ? state.name.replace(/\s+/g, '_').toLowerCase() : 'default';
        const authUrl = 'https://app.claw4growth.com/api/composio-connect?app=' + app + '&entityId=' + entityId;

        if (needsRedirect) {
            // Full redirect for apps that don't work well with popup
            window.location.href = authUrl;
        } else {
            // Popup for others
            window.open(authUrl, 'composio_oauth', 'width=600,height=700,popup=yes');
            el.classList.add('connecting');
        }
    } else {
        el.classList.remove('connected');
        state.connectedApps = state.connectedApps.filter(a => a !== app);
        saveState();
        const statusEl = el.querySelector('.ob-app-status');
        if (statusEl) statusEl.textContent = '';
    }
}

function saveAppsAndContinue() {
    saveState();
    goToScreen(7);
    simulateDeploy();
}

function skipApps() {
    state.connectedApps = [];
    saveState();
    goToScreen(7);
    simulateDeploy();
}

// Screen 7: Deploy
function simulateDeploy() {
    const steps = ['ds1', 'ds2', 'ds3', 'ds4', 'ds5'];
    const delays = [800, 1500, 2200, 3200, 4000];

    // Safety check: ensure deploy container exists
    const deployContainer = document.querySelector('.ob-deploy-container');
    if (!deployContainer) {
        console.error('Deploy container not found');
        return;
    }

    steps.forEach((id, i) => {
        setTimeout(() => {
            const el = document.getElementById(id);
            if (el) {
                el.classList.add('done');
            }
            if (i === steps.length - 1) {
                // Trigger real deploy
                triggerDeploy();
            }
        }, delays[i]);
    });
}

async function triggerDeploy() {
    const deployData = {
        userId: state.userId || localStorage.getItem('c4g_user_id'),
        email: state.userEmail || localStorage.getItem('c4g_user_email'),
        onboardingData: {
            operatorName: state.operatorName,
            brand: state.brand,
            tone: state.tone,
            connectedApps: state.connectedApps,
        },
        composioEntityId: state.operatorName ? state.operatorName.replace(/\s+/g, '_').toLowerCase() : null,
    };

    // Use relative /api/deploy (works on both localhost and production domain)
    const apiUrl = '/api/deploy';

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(deployData),
        });

        const result = await response.json();

        if (result.success) {
            state.instanceId = result.instanceId;
            state.subdomain = result.subdomain;
            saveState();

            // Show the power mascot glow-up
            setTimeout(() => {
                const loadingEl = document.getElementById('deployLoading');
                const doneEl = document.getElementById('deployDone');
                if (loadingEl) loadingEl.style.display = 'none';
                if (doneEl) doneEl.style.display = 'block';

                // Update deploy message with operator name
                const msgEl = document.getElementById('deployMessage');
                if (msgEl && state.operatorName) {
                    msgEl.textContent = state.operatorName + ' is ready to work';
                }

                // Update Telegram link with pairing deep link
                const telegramLinkEl = document.getElementById('telegramLink');
                const botUsername = result.telegramBotUsername || 'Claw4Growth_bot';
                const pairingCode = result.pairingCode;
                const deepLink = pairingCode
                    ? 'https://t.me/' + botUsername + '?start=' + pairingCode
                    : 'https://t.me/' + botUsername;

                if (telegramLinkEl) {
                    telegramLinkEl.href = deepLink;
                    telegramLinkEl.target = '_blank';
                }
            }, 1200);
        } else {
            showDeployError(result.error || 'Deploy failed');
        }
    } catch (error) {
        console.error('Deploy error:', error);
        showDeployError('Network error. Please try again.');
    }
}

function showDeployError(message) {
    const container = document.querySelector('.ob-deploy-container');
    if (container) {
        container.innerHTML = `<div class="ob-deploy-success"><div class="ob-deploy-icon" style="color:#ff5555;">✗</div><h3>Deploy Failed</h3><p>${message}</p><button class="ob-btn" onclick="retryDeploy()">RETRY</button><p style="margin-top:20px; font-size:11px; color:#666; font-family:var(--font-mono, monospace);">Persistent issues? Contact <a href="mailto:hello@claw4growth.com" style="color:var(--yellow, #f5c842);">hello@claw4growth.com</a></p></div>`;
    }
}

function retryDeploy() {
    const loadingEl = document.getElementById('deployLoading');
    const doneEl = document.getElementById('deployDone');
    if (loadingEl) loadingEl.style.display = 'block';
    if (doneEl) doneEl.style.display = 'none';
    simulateDeploy();
}
