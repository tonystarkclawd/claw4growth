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

    // Fetch real count from API
    fetch('https://leads.ironads.agency/count')
        .then(r => r.json())
        .then(data => {
            if (data.count) {
                counters.forEach(c => c.setAttribute('data-target', data.count));
            }
        })
        .catch(() => {}); // Keep hardcoded fallback

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

    // ===== TELEGRAM CHAT ANIMATION =====
    if (!window.__skipTgDemo) {
    const tgChat = document.getElementById('tg-chat');

    const botAvatarSVG = `<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="60" cy="60" r="60" fill="#1a1a2e"/><path d="M60 25 C45 25 35 40 35 50 C35 60 42 72 50 75 L50 80 L54 80 L54 75 C54 75 57 76 60 75 L60 80 L64 80 L64 75 C72 72 79 60 79 50 C79 40 75 25 60 25Z" fill="url(#ab)"/><rect x="42" y="32" width="12" height="8" rx="2" fill="none" stroke="#e0e0e0" stroke-width="1.5"/><rect x="62" y="32" width="12" height="8" rx="2" fill="none" stroke="#e0e0e0" stroke-width="1.5"/><path d="M54 36 L62 36" stroke="#e0e0e0" stroke-width="1.2"/><circle cx="48" cy="36" r="2" fill="#00e5cc"/><circle cx="68" cy="36" r="2" fill="#00e5cc"/><defs><linearGradient id="ab" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#ff4d4d"/><stop offset="100%" stop-color="#991b1b"/></linearGradient></defs></svg>`;

    // Chat script: 3 scenarios — Meta report, CRO audit, scheduled competitor analysis
    const chatScript = [
        // === SCENARIO 1: Bot proactively sends Meta Ads performance recap ===
        {
            who: 'bot',
            html: `📊 <strong>Daily Meta Ads Recap — Feb 8</strong>

<div class="tg-result-section">
<div class="tg-result-item"><span class="tg-bullet green">•</span> <strong>Spend:</strong> $284.50 / $350 daily budget</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> <strong>ROAS:</strong> 4.2x (target: 3.5x) ✅</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> <strong>Leads:</strong> 47 (CPL $6.05, down 12% vs. yesterday)</div>
<div class="tg-result-item"><span class="tg-bullet yellow">•</span> <strong>Top campaign:</strong> "Spring Launch — Lookalike 2%" — 6.1x ROAS</div>
<div class="tg-result-item"><span class="tg-bullet red">•</span> <strong>Underperforming:</strong> "Retarget — Cart Abandoners" — 1.3x ROAS, paused automatically</div>
</div>

Want me to reallocate the paused budget to the Lookalike campaign? <span class="tg-time">9:00</span>`,
            delay: 0,
        },
        {
            who: 'user',
            html: 'Yes, move it. Also run a CRO audit on acme.io/pricing <span class="tg-time">9:02</span>',
            delay: 2800,
        },
        // === SCENARIO 2: CRO Audit ===
        {
            who: 'typing',
            delay: 1500,
            duration: 2500,
        },
        {
            who: 'bot',
            html: `✅ Done — $65.50 reallocated to "Spring Launch — Lookalike 2%".

Now scanning your pricing page... <span class="tg-time">9:02</span>`,
            delay: 0,
        },
        {
            who: 'typing',
            delay: 2000,
            duration: 3000,
        },
        {
            who: 'bot',
            html: `🔍 <strong>CRO Report — acme.io/pricing</strong>

<div class="tg-result-section">
<div class="tg-result-title critical">❌ Critical (3)</div>
<div class="tg-result-item"><span class="tg-bullet red">•</span> CTA contrast ratio 2.1:1 (needs 4.5:1)</div>
<div class="tg-result-item"><span class="tg-bullet red">•</span> Pricing defaults to annual — 73% expect monthly first</div>
<div class="tg-result-item"><span class="tg-bullet red">•</span> No social proof near CTA</div>
</div>

<div class="tg-result-section">
<div class="tg-result-title win">✅ Quick Wins</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> Add "Most Popular" badge — est. +18% CTR</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> Move testimonials above fold — est. +12% conv.</div>
</div>

<div class="tg-result-section">
<div class="tg-result-title impact">⚡ Est. total impact: +23-31% conversion rate</div>
</div>
<span class="tg-time">9:03</span>`,
            delay: 0,
        },
        {
            who: 'user',
            html: 'Great. Can you also keep an eye on Competitor X? <span class="tg-time">9:04</span>',
            delay: 3000,
        },
        // === SCENARIO 3: Scheduled competitor analysis ===
        {
            who: 'typing',
            delay: 1200,
            duration: 2000,
        },
        {
            who: 'bot',
            html: `🕐 <strong>Competitor monitoring scheduled.</strong>

I'll check competitorx.com every Monday at 9:00 AM and send you a briefing with:
<div class="tg-result-section" style="margin-top:4px">
<div class="tg-result-item"><span class="tg-bullet green">•</span> Pricing changes</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> New features / landing pages</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> Ad creative updates (Meta Library)</div>
<div class="tg-result-item"><span class="tg-bullet green">•</span> Content & SEO shifts</div>
</div>

First report drops Monday 9 AM. I'll ping you right here. <span class="tg-time">9:04</span>`,
            delay: 0,
        },
    ];

    let chatStarted = false;

    const chatObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !chatStarted) {
                chatStarted = true;
                runChatAnimation();
                chatObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });

    if (tgChat) {
        chatObserver.observe(tgChat);
        // Safety: if already in viewport on load, start immediately
        requestAnimationFrame(() => {
            if (!chatStarted) {
                const rect = tgChat.getBoundingClientRect();
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    chatStarted = true;
                    runChatAnimation();
                }
            }
        });
    }

    function createMsgEl(who, html) {
        const wrapper = document.createElement('div');
        wrapper.className = `tg-msg tg-msg-${who}`;

        if (who === 'bot') {
            const avatar = document.createElement('div');
            avatar.className = 'tg-msg-avatar';
            avatar.innerHTML = botAvatarSVG;
            wrapper.appendChild(avatar);
        }

        const bubble = document.createElement('div');
        bubble.className = 'tg-bubble';
        bubble.innerHTML = html;
        wrapper.appendChild(bubble);

        return wrapper;
    }

    function createTypingEl() {
        const wrapper = document.createElement('div');
        wrapper.className = 'tg-msg tg-msg-bot';

        const avatar = document.createElement('div');
        avatar.className = 'tg-msg-avatar';
        avatar.innerHTML = botAvatarSVG;
        wrapper.appendChild(avatar);

        const bubble = document.createElement('div');
        bubble.className = 'tg-bubble';
        bubble.innerHTML = '<div class="tg-typing"><div class="tg-typing-dot"></div><div class="tg-typing-dot"></div><div class="tg-typing-dot"></div></div>';
        wrapper.appendChild(bubble);

        return wrapper;
    }

    function runChatAnimation() {
        tgChat.innerHTML = '';
        let totalDelay = 400;

        chatScript.forEach((msg) => {
            totalDelay += msg.delay;

            if (msg.who === 'typing') {
                const showAt = totalDelay;
                const removeAt = totalDelay + msg.duration;

                setTimeout(() => {
                    const typing = createTypingEl();
                    typing.id = 'tg-typing-indicator';
                    tgChat.appendChild(typing);
                    tgChat.scrollTop = tgChat.scrollHeight;
                }, showAt);

                setTimeout(() => {
                    const el = document.getElementById('tg-typing-indicator');
                    if (el) el.remove();
                }, removeAt);

                totalDelay = removeAt;
            } else {
                const showAt = totalDelay;
                setTimeout(() => {
                    const el = createMsgEl(msg.who, msg.html);
                    tgChat.appendChild(el);
                    tgChat.scrollTop = tgChat.scrollHeight;
                }, showAt);
                totalDelay += 300;
            }
        });
    }
    } // end __skipTgDemo check

    // ===== FORM HANDLING =====
    const forms = document.querySelectorAll('.waitlist-form');

    forms.forEach(form => {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const input = form.querySelector('.form-input');
            const email = input.value.trim();
            if (!email) return;

            const formGroup = form.querySelector('.form-group');
            const successMsg = form.querySelector('.form-success');
            const submitBtn = form.querySelector('.form-btn');

            submitBtn.disabled = true;
            submitBtn.textContent = 'SENDING...';

            // Save to our DB via HTTPS API (Cloudflare tunnel)
            try {
                const response = await fetch('https://leads.ironads.agency/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: email })
                });

                if (response.ok || response.status === 409) {
                    formGroup.style.display = 'none';
                    if (response.status === 409) {
                        successMsg.textContent = '✓ YOU\'RE ALREADY IN!';
                    }
                    successMsg.classList.add('show');
                    counters.forEach(c => {
                        const current = parseInt(c.textContent, 10);
                        if (!isNaN(current)) c.textContent = current + 1;
                    });
                } else {
                    alert('Something went wrong. Please try again.');
                    submitBtn.disabled = false;
                    submitBtn.textContent = originalBtnText;
                }
            } catch (err) {
                console.error('Error:', err);
                alert('Connection failed. Please try again.');
                submitBtn.disabled = false;
                submitBtn.textContent = originalBtnText;
            }
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
