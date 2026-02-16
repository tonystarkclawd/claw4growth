// Supabase config
const SUPABASE_URL = 'https://frejiknxricrkkcgzwdh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZyZWppa254cmljcmtrY2d6d2RoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNzQwNDcsImV4cCI6MjA4Njc1MDA0N30.dI_wSjcNHJZf-uw2TKNl4VK04vOAF-xWdv6f00E0C7M';

function loginWithGoogle() {
    const redirectTo = 'https://claw4growth.com/onboarding/';
    const authUrl = SUPABASE_URL + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirectTo);
    window.location.href = authUrl;
}

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
            setTimeout(function() { goToScreen(2); }, 100);
            return;
        }
    }
    // If already logged in, skip to screen 2
    if (params.get('auth') === 'callback' || localStorage.getItem('c4g_logged_in') === 'true') {
        setTimeout(function() { goToScreen(2); }, 100);
    }
    // Handle step parameter (e.g. after Stripe checkout)
    var step = params.get('step');
    if (step) {
        window.history.replaceState({}, '', window.location.pathname);
        setTimeout(function() { goToScreen(parseInt(step)); }, 100);
    }
})();

// Claw4Growth Onboarding Logic
const state = {
    screen: 1,
    totalScreens: 7,
    operatorName: '',
    brand: { name: '', industry: '', description: '', website: '' },
    tone: '',
    connectedApps: [],
    plan: 'earlybird'
};

function goToScreen(n) {
    document.querySelectorAll('.ob-screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + n).classList.add('active');
    state.screen = n;
    document.getElementById('progressBar').style.width = (n / state.totalScreens * 100) + '%';
}

// Screen 2: Name
function saveNameAndContinue() {
    const name = document.getElementById('operatorName').value.trim();
    if (!name) {
        document.getElementById('operatorName').style.borderColor = '#ff5555';
        return;
    }
    state.operatorName = name;
    goToScreen(3);
}

// Screen 3: Brand
document.getElementById('brandDescription')?.addEventListener('input', function() {
    document.getElementById('descCount').textContent = this.value.length;
});

function saveBrandAndContinue() {
    const name = document.getElementById('brandName').value.trim();
    const industry = document.getElementById('brandIndustry').value;
    if (!name || !industry) {
        if (!name) document.getElementById('brandName').style.borderColor = '#ff5555';
        if (!industry) document.getElementById('brandIndustry').style.borderColor = '#ff5555';
        return;
    }
    state.brand = {
        name: name,
        industry: industry,
        description: document.getElementById('brandDescription').value.trim(),
        website: document.getElementById('brandUrl').value.trim()
    };
    goToScreen(4);
}

// Screen 4: Tone
function selectTone(el) {
    document.querySelectorAll('.ob-tone-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    state.tone = el.dataset.tone;
    document.getElementById('toneContinueBtn').disabled = false;
}

function saveToneAndContinue() {
    if (!state.tone) return;
    goToScreen(5); // → Payment
}

// Screen 5: Payment
function selectPlan(el) {
    document.querySelectorAll('.ob-plan-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    state.plan = el.dataset.plan;
}

function startPayment() {
    // Redirect to Stripe Checkout (test mode)
    window.location.href = 'https://app.claw4growth.com/api/checkout-public';
}

// Screen 6: Apps
function toggleApp(el) {
    const app = el.dataset.app;
    // If not connected yet, launch Composio OAuth
    if (!el.classList.contains('connected')) {
        const entityId = state.name ? state.name.replace(/\s+/g, '_').toLowerCase() : 'default';
        window.open(
            'https://app.claw4growth.com/api/composio-connect?app=' + app + '&entityId=' + entityId,
            'composio_oauth',
            'width=600,height=700,popup=yes'
        );
        el.classList.add('connecting');
    } else {
        el.classList.remove('connected');
        state.connectedApps = state.connectedApps.filter(a => a !== app);
    }
}

// Listen for OAuth callback
window.addEventListener('message', function(e) {
    if (e.data && e.data.composioConnected) {
        const app = e.data.composioConnected;
        const card = document.querySelector('[data-app="' + app + '"]');
        if (card) {
            card.classList.remove('connecting');
            card.classList.add('connected');
            if (!state.connectedApps.includes(app)) state.connectedApps.push(app);
        }
    }
});

// Also check URL params for OAuth return
(function checkOAuthReturn() {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (connected) {
        const card = document.querySelector('[data-app="' + connected + '"]');
        if (card) {
            card.classList.remove('connecting');
            card.classList.add('connected');
            if (!state.connectedApps.includes(connected)) state.connectedApps.push(connected);
        }
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
    }
})();

function saveAppsAndContinue() { goToScreen(7); simulateDeploy(); }
function skipApps() { state.connectedApps = []; goToScreen(7); simulateDeploy(); }

// Screen 7: Deploy
function simulateDeploy() {
    const steps = ['ds1', 'ds2', 'ds3', 'ds4', 'ds5'];
    const delays = [800, 1500, 2200, 3200, 4000];
    
    steps.forEach((id, i) => {
        setTimeout(() => {
            document.getElementById(id).classList.add('done');
            if (i === steps.length - 1) {
                setTimeout(() => {
                    document.getElementById('deployLoading').style.display = 'none';
                    document.getElementById('deployDone').style.display = 'flex';
                    document.getElementById('deployMessage').textContent = 
                        'Meet ' + state.operatorName + ', your new marketing operator for ' + state.brand.name;
                }, 800);
            }
        }, delays[i]);
    });
}

// Enter key navigation
document.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
        if (state.screen === 2) saveNameAndContinue();
        else if (state.screen === 3) saveBrandAndContinue();
        else if (state.screen === 4) saveToneAndContinue();
    }
});

// Export state
window.getOnboardingData = () => ({ ...state, timestamp: new Date().toISOString() });
