/* ========================================
   CLAW4GROWTH — Interactions & Animations
   Slopcraft-inspired effects
   ======================================== */

document.addEventListener('DOMContentLoaded', () => {

    // ===== HERO ENTRANCE ANIMATION =====
    const heroEls = document.querySelectorAll('.hero-entrance');
    heroEls.forEach((el, i) => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(15px)';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                el.style.transition = `opacity 0.6s ease-out ${i * 0.1}s, transform 0.6s ease-out ${i * 0.1}s`;
                el.style.opacity = '1';
                el.style.transform = 'none';
            });
        });
    });

    // ===== FALLING TEXT (Matrix-style with marketing terms) =====
    const fallingContainer = document.getElementById('falling-text');
    const marketingWords = [
        'ROAS', 'CTR', 'CRO', 'SEO', 'CVR', 'SCALE', 'GROWTH',
        'FUNNEL', 'LEADS', 'CAC', 'LTV', 'ARPU', 'MRR', 'CHURN',
        'CONVERT', 'AUDIT', 'OPTIMIZE', 'SHIP', 'LAUNCH', 'TEST',
        'COPY', 'SPLIT', 'PIXEL', 'RETARGET', 'BOOST'
    ];

    function createFallingWord() {
        const word = document.createElement('span');
        word.className = 'falling-word';
        word.textContent = marketingWords[Math.floor(Math.random() * marketingWords.length)];
        word.style.left = Math.random() * 100 + 'vw';
        word.style.animationDuration = (8 + Math.random() * 12) + 's';
        word.style.animationDelay = (Math.random() * -20) + 's';
        word.style.fontSize = (8 + Math.random() * 4) + 'px';
        word.style.opacity = 0.08 + Math.random() * 0.1;
        fallingContainer.appendChild(word);
    }

    // Create 25 falling words
    for (let i = 0; i < 25; i++) {
        createFallingWord();
    }

    // ===== SCROLL REVEAL =====
    const revealElements = document.querySelectorAll('.reveal');

    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                revealObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.05,
        rootMargin: '50px 0px 0px 0px'
    });

    revealElements.forEach(el => revealObserver.observe(el));

    // Force-reveal elements already in viewport (safety net)
    requestAnimationFrame(() => {
        revealElements.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight + 50) {
                el.classList.add('visible');
            }
        });
    });

    // ===== NAV SCROLL EFFECT =====
    const nav = document.getElementById('nav');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    }, { passive: true });

    // ===== COUNTER ANIMATION =====
    const counters = document.querySelectorAll('.proof-count');

    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(el => counterObserver.observe(el));

    function animateCounter(el) {
        const target = parseInt(el.getAttribute('data-target'), 10);
        if (isNaN(target)) return;
        const duration = 1200;
        const start = performance.now();

        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            el.textContent = Math.round(eased * target);
            if (progress < 1) {
                requestAnimationFrame(tick);
            }
        }

        requestAnimationFrame(tick);
    }

    // ===== TERMINAL TYPING ANIMATION =====
    const terminalBody = document.getElementById('terminal-body');

    const terminalLines = [
        { text: '> claw4growth audit --url https://acme.io/pricing', cls: 't-cmd', delay: 0 },
        { text: '', cls: '', delay: 400 },
        { text: '  Scanning pricing page...', cls: 't-dim', delay: 600 },
        { text: '', cls: '', delay: 200 },
        { text: '  CRO Report — acme.io/pricing', cls: 't-white t-bold', delay: 500 },
        { text: '  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', cls: 't-dim', delay: 100 },
        { text: '', cls: '', delay: 300 },
        { text: '  ✖ Critical Issues (3)', cls: 't-red t-bold', delay: 400 },
        { text: '    → CTA button has 2.1:1 contrast ratio (needs 4.5:1)', cls: 't-red', delay: 300 },
        { text: '    → Pricing toggle defaults to annual — 73% want monthly first', cls: 't-red', delay: 300 },
        { text: '    → No social proof within 400px of CTA', cls: 't-red', delay: 300 },
        { text: '', cls: '', delay: 200 },
        { text: '  ⚠ Warnings (5)', cls: 't-yellow t-bold', delay: 400 },
        { text: '    → Hero copy is 47 words — optimal is 15-25 for pricing', cls: 't-yellow', delay: 300 },
        { text: '    → Missing urgency element near primary CTA', cls: 't-yellow', delay: 300 },
        { text: '', cls: '', delay: 200 },
        { text: '  ✓ Quick Wins', cls: 't-green t-bold', delay: 400 },
        { text: '    → Add "Most Popular" badge → est. +18% CTR', cls: 't-green', delay: 300 },
        { text: '    → Move testimonials above fold → est. +12% conversion', cls: 't-green', delay: 300 },
        { text: '    → A/B test: "Start Free" vs "Get Started"', cls: 't-green', delay: 300 },
        { text: '', cls: '', delay: 200 },
        { text: '  ⚡ Estimated total impact: +23-31% conversion rate', cls: 't-white t-bold', delay: 500 },
    ];

    let terminalStarted = false;

    const terminalObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !terminalStarted) {
                terminalStarted = true;
                runTerminalAnimation();
                terminalObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });

    if (terminalBody) {
        terminalObserver.observe(terminalBody);
    }

    function runTerminalAnimation() {
        terminalBody.innerHTML = '';
        let totalDelay = 0;

        terminalLines.forEach((line, i) => {
            totalDelay += line.delay;

            setTimeout(() => {
                const oldCursor = terminalBody.querySelector('.terminal-cursor');
                if (oldCursor) oldCursor.remove();

                const div = document.createElement('div');
                div.className = 't-line';
                if (line.text === '') {
                    div.innerHTML = '&nbsp;';
                    div.className = 't-line-gap';
                } else {
                    div.innerHTML = `<span class="${line.cls}">${line.text}</span>`;
                }

                if (i === terminalLines.length - 1) {
                    const cursor = document.createElement('span');
                    cursor.className = 'terminal-cursor';
                    div.appendChild(cursor);
                }

                terminalBody.appendChild(div);
                terminalBody.scrollTop = terminalBody.scrollHeight;
            }, totalDelay);
        });
    }

    // ===== FORM HANDLING =====
    const forms = document.querySelectorAll('.waitlist-form');

    forms.forEach(form => {
        form.addEventListener('submit', (e) => {
            e.preventDefault();

            const input = form.querySelector('.form-input');
            const email = input.value.trim();
            if (!email) return;

            const formGroup = form.querySelector('.form-group');
            const successMsg = form.querySelector('.form-success');

            formGroup.style.display = 'none';
            successMsg.classList.add('show');

            console.log('Waitlist signup:', email);

            // Increment counter
            counters.forEach(c => {
                const current = parseInt(c.textContent, 10);
                if (!isNaN(current)) {
                    c.textContent = current + 1;
                }
            });
        });
    });

    // ===== SMOOTH SCROLL =====
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });

});
