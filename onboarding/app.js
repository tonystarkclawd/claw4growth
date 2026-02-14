/**
 * Claw4Growth Onboarding Flow
 * Handles screen navigation, form validation, and state management
 */

// ==========================================================================
// State Management
// ==========================================================================

const state = {
    currentScreen: 1,
    totalScreens: 7,
    operatorName: '',
    brandName: '',
    industry: '',
    description: '',
    website: '',
    tone: '',
    connectedApps: [],
    selectedPlan: 'monthly'
};

// ==========================================================================
// Screen Navigation
// ==========================================================================

function goToScreen(screenNumber) {
    // Hide current screen
    const currentScreen = document.querySelector('.screen.active');
    if (currentScreen) {
        currentScreen.classList.remove('active');
    }
    
    // Show new screen
    const newScreen = document.getElementById(`screen-${getScreenName(screenNumber)}`);
    if (newScreen) {
        newScreen.classList.add('active');
        state.currentScreen = screenNumber;
        updateProgress();
        window.scrollTo(0, 0);
    }
}

function getScreenName(screenNumber) {
    const screens = ['login', 'name', 'brand', 'tone', 'apps', 'payment', 'deploy'];
    return screens[screenNumber - 1] || 'login';
}

function updateProgress() {
    const progressFill = document.getElementById('progressFill');
    const progress = (state.currentScreen / state.totalScreens) * 100;
    progressFill.style.width = `${progress}%`;
}

// ==========================================================================
// Screen 2: Operator Name
// ==========================================================================

function saveNameAndContinue() {
    const nameInput = document.getElementById('operatorName');
    const name = nameInput.value.trim();
    
    if (!name) {
        nameInput.focus();
        nameInput.style.borderColor = '#ef4444';
        setTimeout(() => {
            nameInput.style.borderColor = '';
        }, 2000);
        return;
    }
    
    state.operatorName = name;
    goToScreen(3);
}

// Handle Enter key on name input
document.addEventListener('DOMContentLoaded', () => {
    const nameInput = document.getElementById('operatorName');
    if (nameInput) {
        nameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                saveNameAndContinue();
            }
        });
    }
});

// ==========================================================================
// Screen 3: Brand Info
// ==========================================================================

function saveBrandAndContinue() {
    const brandName = document.getElementById('brandName').value.trim();
    const industry = document.getElementById('industry').value;
    const description = document.getElementById('description').value.trim();
    const website = document.getElementById('website').value.trim();
    
    // Validation
    if (!brandName) {
        document.getElementById('brandName').focus();
        showFieldError('brandName');
        return;
    }
    
    if (!industry) {
        document.getElementById('industry').focus();
        showFieldError('industry');
        return;
    }
    
    if (!description) {
        document.getElementById('description').focus();
        showFieldError('description');
        return;
    }
    
    state.brandName = brandName;
    state.industry = industry;
    state.description = description;
    state.website = website;
    
    goToScreen(4);
}

function showFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    field.style.borderColor = '#ef4444';
    setTimeout(() => {
        field.style.borderColor = '';
    }, 2000);
}

// Character counter for description
document.addEventListener('DOMContentLoaded', () => {
    const descInput = document.getElementById('description');
    const descCount = document.getElementById('descCount');
    
    if (descInput && descCount) {
        descInput.addEventListener('input', () => {
            descCount.textContent = `${descInput.value.length}/150`;
        });
    }
});

// ==========================================================================
// Screen 4: Tone Selection
// ==========================================================================

function selectTone(tone) {
    // Remove previous selection
    document.querySelectorAll('.tone-card').forEach(card => {
        card.classList.remove('selected');
    });
    
    // Add new selection
    const selectedCard = document.querySelector(`.tone-card[data-tone="${tone}"]`);
    if (selectedCard) {
        selectedCard.classList.add('selected');
        state.tone = tone;
        
        // Enable continue button
        const toneBtn = document.getElementById('toneBtn');
        if (toneBtn) {
            toneBtn.disabled = false;
        }
    }
}

function saveToneAndContinue() {
    if (!state.tone) {
        return;
    }
    goToScreen(5);
}

// ==========================================================================
// Screen 5: Connect Apps
// ==========================================================================

function toggleApp(appName) {
    const appCard = document.querySelector(`.app-card[data-app="${appName}"]`);
    
    if (appCard.classList.contains('connected')) {
        // Disconnect
        appCard.classList.remove('connected');
        state.connectedApps = state.connectedApps.filter(app => app !== appName);
    } else {
        // Connect (simulate OAuth)
        appCard.classList.add('connected');
        state.connectedApps.push(appName);
        
        // In real implementation, this would trigger OAuth flow
        console.log(`OAuth flow for ${appName} would start here`);
    }
}

function saveAppsAndContinue() {
    goToScreen(6);
}

// ==========================================================================
// Screen 6: Payment
// ==========================================================================

function selectPlan(plan) {
    // Remove previous selection
    document.querySelectorAll('.pricing-card').forEach(card => {
        card.classList.remove('active');
    });
    
    // Add new selection
    const selectedCard = document.querySelector(`.pricing-card[data-plan="${plan}"]`);
    if (selectedCard) {
        selectedCard.classList.add('active');
        state.selectedPlan = plan;
    }
}

function processPayment() {
    // In real implementation, this would trigger Stripe checkout
    console.log('Stripe checkout would start here', {
        plan: state.selectedPlan,
        amount: state.selectedPlan === 'monthly' ? 49.90 : 479.00
    });
    
    // Move to deploy screen
    goToScreen(7);
    simulateDeployment();
}

// ==========================================================================
// Screen 7: Deploy
// ==========================================================================

function simulateDeployment() {
    const steps = [
        { selector: '.deploy-step:nth-child(1)', delay: 500 },
        { selector: '.deploy-step:nth-child(2)', delay: 1500 },
        { selector: '.deploy-step:nth-child(3)', delay: 2500 },
        { selector: '.deploy-step:nth-child(4)', delay: 3500 },
        { selector: '.deploy-step:nth-child(5)', delay: 4500 }
    ];
    
    steps.forEach(({ selector, delay }) => {
        setTimeout(() => {
            const step = document.querySelector(selector);
            if (step) {
                // Mark previous steps as completed
                const prevSteps = document.querySelectorAll('.deploy-step.active');
                prevSteps.forEach(s => {
                    s.classList.remove('active');
                    s.classList.add('completed');
                    const icon = s.querySelector('.step-icon');
                    if (icon) icon.textContent = '✓';
                });
                
                // Mark current step as active
                step.classList.add('active');
            }
        }, delay);
    });
    
    // Show ready state after all steps complete
    setTimeout(() => {
        const deployingState = document.getElementById('deployingState');
        const readyState = document.getElementById('readyState');
        const operatorNameDisplay = document.getElementById('operatorNameDisplay');
        
        if (deployingState) deployingState.classList.remove('active');
        if (readyState) readyState.classList.add('active');
        if (operatorNameDisplay) operatorNameDisplay.textContent = state.operatorName;
        
        // Mark all steps as completed
        document.querySelectorAll('.deploy-step').forEach(step => {
            step.classList.remove('active');
            step.classList.add('completed');
            const icon = step.querySelector('.step-icon');
            if (icon) icon.textContent = '✓';
        });
    }, 6000);
}

function openTelegram() {
    // In real implementation, this would open Telegram deep link
    const telegramUsername = 'claw4growth_bot'; // Placeholder
    const telegramUrl = `https://t.me/${telegramUsername}`;
    
    console.log('Opening Telegram:', telegramUrl);
    console.log('User data:', state);
    
    // For demo, just log the data
    alert(`Demo mode: Would open Telegram bot @${telegramUsername}\n\nYour configuration:\n- Operator: ${state.operatorName}\n- Brand: ${state.brandName}\n- Industry: ${state.industry}\n- Tone: ${state.tone}\n- Connected apps: ${state.connectedApps.join(', ') || 'None'}\n- Plan: ${state.selectedPlan}`);
    
    // In production:
    // window.open(telegramUrl, '_blank');
}

// ==========================================================================
// Data Export (for backend integration)
// ==========================================================================

function exportOnboardingData() {
    return {
        operatorName: state.operatorName,
        brand: {
            name: state.brandName,
            industry: state.industry,
            description: state.description,
            website: state.website
        },
        tone: state.tone,
        connectedApps: state.connectedApps,
        plan: state.selectedPlan,
        timestamp: new Date().toISOString()
    };
}

// Expose for backend integration
window.getOnboardingData = exportOnboardingData;

// ==========================================================================
// Initialize
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('Claw4Growth Onboarding initialized');
    updateProgress();
    
    // Log state changes for debugging
    if (window.location.search.includes('debug=true')) {
        console.log('Debug mode enabled');
        window.state = state;
    }
});
