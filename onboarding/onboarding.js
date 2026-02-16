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
