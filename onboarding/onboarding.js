// Claw4Growth Onboarding Logic
const state = {
    screen: 1,
    totalScreens: 7,
    operatorName: '',
    brand: { name: '', industry: '', description: '', website: '' },
    tone: '',
    connectedApps: [],
    plan: 'monthly'
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
    goToScreen(5);
}

// Screen 5: Apps
function toggleApp(el) {
    el.classList.toggle('connected');
    const app = el.dataset.app;
    if (el.classList.contains('connected')) {
        if (!state.connectedApps.includes(app)) state.connectedApps.push(app);
    } else {
        state.connectedApps = state.connectedApps.filter(a => a !== app);
    }
}

function saveAppsAndContinue() { goToScreen(6); }
function skipApps() { state.connectedApps = []; goToScreen(6); }

// Screen 6: Payment
function selectPlan(el) {
    document.querySelectorAll('.ob-plan-card').forEach(c => c.classList.remove('selected'));
    el.classList.add('selected');
    state.plan = el.dataset.plan;
}

function startPayment() {
    // TODO: Stripe Checkout integration
    goToScreen(7);
    simulateDeploy();
}

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
