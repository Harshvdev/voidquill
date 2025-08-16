// src/main.js

import { db, auth, serverTimestamp, signInAnonymously, onAuthStateChanged } from '../firebase/config.js';
import { collection, doc, writeBatch, query, where, limit, getDocs, documentId, setDoc } from "firebase/firestore";

document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURATION ---
    const CONFIG = {
        POST_COOLDOWN_SECONDS: 60,
        POST_MAX_LENGTH: 1000,
        BLOCKLIST: ['spamword', 'badword', 'someotherword'],
        CANVAS_VERTICAL_CENTER_RATIO: 0.4,
        PARTICLE_COUNT: 300,
        STAR_COUNT: 150,
        EVENT_HORIZON_RADIUS: 45,
        RELEASE_ANIMATION_DURATION_MS: 600,
        LISTEN_QUERY_LIMIT: 15,
        SEEN_POSTS_HISTORY_LENGTH: 10,
        ANIMATOR_HEIGHT: 150,
        ANIMATOR_SPACING: 20,
        CONNECTION_TIMEOUT_MS: 15000,
    };

    // --- ELEMENT REFERENCES ---
    const canvas = document.getElementById('blackhole-canvas');
    const ctx = canvas.getContext('2d');
    const composeButton = document.getElementById('compose-button');
    const composeModal = document.getElementById('compose-modal');
    const composeCloseButton = document.getElementById('compose-close-button');
    const postContentEl = document.getElementById('post-content');
    const releaseButtonEl = document.getElementById('release-button');
    const listenButtonEl = document.getElementById('listen-button');
    const feedbackMessageEl = document.getElementById('feedback-message');
    const postModal = document.getElementById('post-modal');
    const modalTextEl = postModal.querySelector('.modal-text');
    const modalCloseButton = document.getElementById('modal-close-button');
    const mainActionContainer = document.querySelector('.main-action');
    const toggleAnimationButton = document.getElementById('toggle-animation-button');

    // --- STATE AND CONFIG ---
    let currentUser = null;
    let isCurrentUserAdmin = false;
    let particles = [];
    let transitionParticles = [];
    let stars = [];
    const blocklist = CONFIG.BLOCKLIST;
    let centerX, centerY;
    const eventHorizonRadius = CONFIG.EVENT_HORIZON_RADIUS;
    let cooldownInterval = null;
    let cooldownEndTime = 0;
    let dustGradient = null;
    let thoughtGradient = null;
    let elementToFocusOnClose = null; 
    let animationEnabled = true;

    // --- HELPER FUNCTION ---
    const lerp = (a, b, t) => a * (1 - t) + b * t;

    // --- PARTICLE CLASSES ---
    class TransitionParticle {
        constructor(startX, startY) {
            this.state = 'traveling'; this.travelProgress = 0; this.fadeProgress = 1.0;
            this.startX = startX; this.startY = startY; this.endRadius = centerX * 0.75;
            this.endAngle = Math.PI; this.endX = centerX + Math.cos(this.endAngle) * this.endRadius;
            this.endY = centerY + Math.sin(this.endAngle) * this.endRadius * 0.4;
            this.controlX = this.endX; this.controlY = this.startY; this.travelSpeed = 0.01;
            this.fadeSpeed = 0.01; this.size = 8;
        }
        update() {
            if (this.state === 'traveling') {
                this.travelProgress += this.travelSpeed;
                if (this.travelProgress >= 1.0) {
                    this.travelProgress = 1.0; this.state = 'fading'; this.radius = this.endRadius;
                    this.angle = this.endAngle; this.angularSpeed = 2 / this.radius;
                }
            } else if (this.state === 'fading') {
                this.radius -= 0.4; this.angle += this.angularSpeed; this.fadeProgress -= this.fadeSpeed;
                if (this.fadeProgress <= 0) { return { done: true, radius: this.radius, angle: this.angle }; }
            }
            return { done: false };
        }
        draw() {
            if (this.state === 'traveling') {
                const t = this.travelProgress; const t_inv = 1 - t; const t_inv_sq = t_inv * t_inv; const t_sq = t * t;
                this.x = t_inv_sq * this.startX + 2 * t_inv * t * this.controlX + t_sq * this.endX;
                this.y = t_inv_sq * this.startY + 2 * t_inv * t * this.controlY + t_sq * this.endY;
            } else {
                this.x = centerX + Math.cos(this.angle) * this.radius;
                this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
            }
            const p_inner = { r: 224, g: 195, b: 255 }; const p_outer = { r: 157, g: 78, b: 221 };
            const w_inner = { r: 255, g: 255, b: 255 }; const w_outer = { r: 224, g: 195, b: 255 };
            const t = this.fadeProgress;
            const innerR = lerp(w_inner.r, p_inner.r, t); const innerG = lerp(w_inner.g, p_inner.g, t); const innerB = lerp(w_inner.b, p_inner.b, t);
            const outerR = lerp(w_outer.r, p_outer.r, t); const outerG = lerp(w_outer.g, p_outer.g, t); const outerB = lerp(w_outer.b, p_outer.b, t);
            const dynamicGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
            dynamicGradient.addColorStop(0, `rgba(${innerR}, ${innerG}, ${innerB}, 1)`);
            dynamicGradient.addColorStop(0.5, `rgba(${outerR}, ${outerG}, ${outerB}, 0.9)`);
            dynamicGradient.addColorStop(1, `rgba(${outerR}, ${outerG}, ${outerB}, 0)`);
            ctx.save(); ctx.translate(this.x, this.y); ctx.fillStyle = dynamicGradient;
            ctx.beginPath(); ctx.arc(0, 0, this.size, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
    }
    class Particle {
        constructor(orbitRadius, orbitAngle) {
            this.radius = orbitRadius; this.angle = orbitAngle; this.isUserThought = !!orbitRadius;
            if (!this.isUserThought) { this.reset(); }
            this.angularSpeed = 2 / this.radius;
            this.speed = 0.4;
            this.size = this.isUserThought ? 8 : Math.random() * 4 + 2;
            this.gradient = this.isUserThought ? thoughtGradient : dustGradient;
            this.x = centerX + Math.cos(this.angle) * this.radius;
            this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
        }
        reset() {
            this.radius = Math.random() * (canvas.width * 0.5) + (canvas.width * 0.2);
            this.angle = Math.random() * Math.PI * 2;
            this.angularSpeed = 2 / this.radius;
        }
        update() {
            this.radius -= this.speed; this.angle += this.angularSpeed;
            this.x = centerX + Math.cos(this.angle) * this.radius;
            this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
            if (this.radius < eventHorizonRadius) {
                if (this.isUserThought) { return false; } else { this.reset(); }
            }
            return true;
        }
        draw() {
            ctx.save(); const p = (this.y / canvas.height) * 0.8 + 0.2; const displaySize = this.size * p;
            ctx.translate(this.x, this.y); ctx.scale(displaySize, displaySize);
            ctx.fillStyle = this.gradient; ctx.beginPath();
            ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        }
    }

    // --- CANVAS & ANIMATION ---
    function initializeAnimationState() {
        const osPrefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const userOverride = localStorage.getItem('voidquill_animation_override');

        if (userOverride === 'true') {
            animationEnabled = true;
        } else if (userOverride === 'false') {
            animationEnabled = false;
        } else {
            animationEnabled = !osPrefersReduced;
        }

        particles = [];
        transitionParticles = [];
        if (animationEnabled) {
            for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) particles.push(new Particle());
        }
    }

    function setupCanvas() {
        canvas.width = window.innerWidth; canvas.height = window.innerHeight;
        centerX = canvas.width / 2; centerY = canvas.height * CONFIG.CANVAS_VERTICAL_CENTER_RATIO;
        const thoughtSize = 8;
        thoughtGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, thoughtSize);
        thoughtGradient.addColorStop(0, '#e0c3ff'); thoughtGradient.addColorStop(0.5, '#9D4EDD');
        thoughtGradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        const dustSize = 4;
        dustGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, dustSize);
        dustGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        dustGradient.addColorStop(0.2, 'rgba(224, 195, 255, 0.9)');
        dustGradient.addColorStop(0.8, 'rgba(157, 78, 221, 0.3)');
        dustGradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        stars = [];
        for (let i = 0; i < CONFIG.STAR_COUNT; i++) stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: Math.random() * 1.5, opacity: Math.random() * 0.5 + 0.1 });
        
        initializeAnimationState();
    }

    function animate() {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(4, 2, 10, 0.25)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        stars.forEach(star => {
            ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
            ctx.fillRect(star.x, star.y, star.size, star.size);
        });
        
        if (animationEnabled) {
            ctx.globalCompositeOperation = 'lighter';
            
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i];
                if (!p.update()) {
                    particles.splice(i, 1);
                } else {
                    p.draw();
                }
            }

            for (let i = transitionParticles.length - 1; i >= 0; i--) {
                const tp = transitionParticles[i];
                const result = tp.update();
                if (result.done) {
                    particles.push(new Particle(result.radius, result.angle));
                    transitionParticles.splice(i, 1);
                } else {
                    tp.draw();
                }
            }
        }

        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(centerX, centerY, eventHorizonRadius, 0, Math.PI * 2);
        ctx.fill();

        requestAnimationFrame(animate);
    }
    
    // --- INITIALIZATION ---
    setupCanvas();
    animate();
    window.addEventListener('resize', setupCanvas);
    toggleAnimationButton.addEventListener('click', () => {
        // Toggle the current state and save it as the override
        animationEnabled = !animationEnabled;
        localStorage.setItem('voidquill_animation_override', animationEnabled);
        initializeAnimationState();
    });

    // --- FRONT-END COOLDOWN LOGIC (ADMIN AWARE) ---
    function updateCooldownDisplay() {
        const now = Date.now();
        const secondsLeft = Math.ceil((cooldownEndTime - now) / 1000);
        if (secondsLeft > 0 && !isCurrentUserAdmin) {
            releaseButtonEl.disabled = true;
            releaseButtonEl.textContent = `On Cooldown (${secondsLeft}s)`;
        } else {
            releaseButtonEl.disabled = false;
            releaseButtonEl.textContent = 'Release into the Void';
            if (cooldownInterval) {
                clearInterval(cooldownInterval);
                cooldownInterval = null;
            }
        }
    }
    function startCooldown() {
        if (isCurrentUserAdmin) return;
        cooldownEndTime = Date.now() + CONFIG.POST_COOLDOWN_SECONDS * 1000;
        if (cooldownInterval) clearInterval(cooldownInterval);
        cooldownInterval = setInterval(updateCooldownDisplay, 1000);
        updateCooldownDisplay();
    }

    // --- ACCESSIBILITY: FOCUS TRAPPING FOR MODALS ---
    const trapFocus = (e) => {
        if (e.key !== 'Tab') return;
        const modal = e.currentTarget;
        const focusableElements = Array.from(
            modal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
        ).filter(el => el.offsetParent !== null); 
        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (e.shiftKey) { 
            if (document.activeElement === firstElement) { lastElement.focus(); e.preventDefault(); }
        } else { 
            if (document.activeElement === lastElement) { firstElement.focus(); e.preventDefault(); }
        }
    };

    // --- MODAL CONTROLS (WITH ACCESSIBILITY) ---
    const openComposeModal = () => { elementToFocusOnClose = document.activeElement; composeModal.classList.add('is-visible'); composeModal.addEventListener('keydown', trapFocus); postContentEl.focus(); updateCooldownDisplay(); };
    const closeComposeModal = () => { composeModal.classList.remove('is-visible'); composeModal.removeEventListener('keydown', trapFocus); if (elementToFocusOnClose) elementToFocusOnClose.focus(); };
    const openListenModal = () => { elementToFocusOnClose = document.activeElement; postModal.classList.add('is-visible'); postModal.addEventListener('keydown', trapFocus); modalCloseButton.focus(); };
    const closeListenModal = () => { postModal.classList.remove('is-visible'); postModal.removeEventListener('keydown', trapFocus); if (elementToFocusOnClose) elementToFocusOnClose.focus(); };

    // --- CORE APP LOGIC ---
    async function handleReleasePost() {
        const content = postContentEl.value.trim();
        if (!currentUser || content.length === 0 || !isTextClean(content)) {
            showFeedback('Your thought is empty or contains invalid words.', 'error');
            return;
        }
        releaseButtonEl.disabled = true;
        releaseButtonEl.textContent = 'Releasing...';
        try {
            await savePostToFirebase(content);
            postContentEl.value = '';
            const actionRect = mainActionContainer.getBoundingClientRect();
            closeComposeModal();
            const animator = document.createElement('div');
            animator.className = 'release-animator';
            animator.style.width = '350px';
            animator.style.height = `${CONFIG.ANIMATOR_HEIGHT}px`;
            animator.style.left = '50%';
            animator.style.top = `${actionRect.top - CONFIG.ANIMATOR_HEIGHT - CONFIG.ANIMATOR_SPACING}px`;
            animator.style.transform = 'translateX(-50%)';
            animator.textContent = content;
            document.body.appendChild(animator);
            setTimeout(() => {
                animator.style.width = '10px'; animator.style.height = '10px'; animator.style.borderRadius = '50%';
                animator.style.color = 'transparent'; animator.style.padding = '0';
                animator.style.background = 'var(--void-purple)'; animator.style.opacity = '0.5';
                setTimeout(() => {
                    const finalRect = animator.getBoundingClientRect();
                    const startX = finalRect.left + finalRect.width / 2;
                    const startY = finalRect.top + finalRect.height / 2;
                    if (animationEnabled) {
                        transitionParticles.push(new TransitionParticle(startX, startY));
                    }
                    animator.remove();
                }, CONFIG.RELEASE_ANIMATION_DURATION_MS);
            }, 100);
            startCooldown();
        } catch (error) {
            console.error("Failed to release thought:", error);
            if (error.code === 'permission-denied') { showFeedback('You are posting too frequently. Please wait.', 'error'); startCooldown(); } 
            else { showFeedback('Your thought was lost in the ether. Please try again.', 'error'); }
            updateCooldownDisplay();
        }
    }
    async function savePostToFirebase(content) {
        if (!currentUser) throw new Error("User not authenticated.");
        const postBatch = writeBatch(db);
        const postRef = doc(collection(db, 'public_posts'));
        const contentWords = content.toLowerCase().split(/\s+/).filter(Boolean);
        postBatch.set(postRef, { content, authorId: currentUser.uid, createdAt: serverTimestamp(), content_words: contentWords });
        const userActivityRef = doc(db, 'user_activity', currentUser.uid);
        postBatch.set(userActivityRef, { lastPostTimestamp: serverTimestamp() }, { merge: true });
        await postBatch.commit();
    }
    async function handleListenToVoid() {
        if (!currentUser) return;
        listenButtonEl.disabled = true; listenButtonEl.textContent = 'Listening...';
        modalTextEl.textContent = 'The void is vast...'; openListenModal();
        try {
            const seenIds = JSON.parse(localStorage.getItem('voidquill_seen_posts')) || [];
            const postsRef = collection(db, 'public_posts'); const MAX_ATTEMPTS = 5; let foundPostDoc = null;
            for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
                const randomId = doc(postsRef).id;
                const q = query(postsRef, where(documentId(), '>=', randomId), limit(CONFIG.LISTEN_QUERY_LIMIT * 2));
                const snapshot = await getDocs(q);
                if (snapshot.empty) continue;
                const eligibleDocs = snapshot.docs.filter(doc => doc.data().authorId !== currentUser.uid && !seenIds.includes(doc.id));
                if (eligibleDocs.length > 0) { const randomIndex = Math.floor(Math.random() * eligibleDocs.length); foundPostDoc = eligibleDocs[randomIndex]; break; }
            }
            if (foundPostDoc) {
                const foundPostContent = foundPostDoc.data().content; const foundPostId = foundPostDoc.id;
                modalTextEl.textContent = foundPostContent; seenIds.push(foundPostId);
                while (seenIds.length > CONFIG.SEEN_POSTS_HISTORY_LENGTH) { seenIds.shift(); }
                localStorage.setItem('voidquill_seen_posts', JSON.stringify(seenIds));
            } else { modalTextEl.textContent = "The void is silent. No other thoughts were found, or you've seen them all recently."; }
        } catch (error) { console.error("An error occurred while listening to the void:", error); modalTextEl.textContent = "A cosmic interference prevented listening. Please try again.";
        } finally { listenButtonEl.disabled = false; listenButtonEl.textContent = 'Listen to the Void'; }
    }
    // --- EVENT LISTENERS ---
    composeButton.addEventListener('click', openComposeModal);
    composeCloseButton.addEventListener('click', closeComposeModal);
    composeModal.addEventListener('click', (e) => { if (e.target === composeModal) closeComposeModal(); });
    releaseButtonEl.addEventListener('click', handleReleasePost);
    listenButtonEl.addEventListener('click', handleListenToVoid);
    modalCloseButton.addEventListener('click', closeListenModal);
    postModal.addEventListener('click', (e) => { if (e.target === postModal) closeListenModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeComposeModal(); closeListenModal(); } });
    // --- HELPER FUNCTIONS ---
    function showFeedback(message, type) { feedbackMessageEl.textContent = message; feedbackMessageEl.className = `feedback ${type}`; setTimeout(() => { feedbackMessageEl.textContent = ''; feedbackMessageEl.className = 'feedback'; }, 4000); }
    function isTextClean(text) { const lowerCaseText = text.toLowerCase(); return !blocklist.some(word => lowerCaseText.includes(word)); }
    // --- AUTHENTICATION (WITH LOADING STATE) ---
    let authTimeout = null;
    composeButton.disabled = true; listenButtonEl.disabled = true;
    composeButton.textContent = "Connecting..."; listenButtonEl.textContent = "Connecting...";
    authTimeout = setTimeout(() => {
        if (!currentUser) { console.warn("Authentication timed out."); composeButton.textContent = "Connection Failed"; listenButtonEl.textContent = "Please Refresh"; }
    }, CONFIG.CONNECTION_TIMEOUT_MS);
    onAuthStateChanged(auth, (user) => {
        if (authTimeout) clearTimeout(authTimeout);
        if (user) {
            currentUser = user;
            user.getIdTokenResult(true).then((idTokenResult) => {
                isCurrentUserAdmin = !!idTokenResult.claims.admin;
                if (isCurrentUserAdmin) { console.log("Admin user detected. UI cooldown will be disabled."); }
                composeButton.disabled = false; listenButtonEl.disabled = false;
                composeButton.textContent = "Compose Thought"; listenButtonEl.textContent = "Listen to the Void";
            });
        } else {
            currentUser = null; isCurrentUserAdmin = false;
            composeButton.disabled = true; listenButtonEl.disabled = true;
            composeButton.textContent = "Compose Thought"; listenButtonEl.textContent = "Listen to the Void";
            signInAnonymously(auth).catch((error) => {
                console.error("Anonymous authentication failed", error);
                document.querySelector('.main-title').textContent = 'Connection Lost';
                composeButton.textContent = "Connection Failed"; listenButtonEl.textContent = "Please Refresh";
            });
        }
    });
});