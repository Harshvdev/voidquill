// src/main.js

import { db, auth, serverTimestamp, signInAnonymously, onAuthStateChanged } from '../firebase/config.js';
import { collection, doc, writeBatch, query, where, limit, getDocs, documentId, setDoc } from "firebase/firestore";

document.addEventListener('DOMContentLoaded', () => {

    // --- CONFIGURATION ---
    const CONFIG = {
        // Behavior - Ensure these match your Firebase Rules
        POST_COOLDOWN_SECONDS: 60,
        POST_MAX_LENGTH: 1000,
        BLOCKLIST: ['spamword', 'badword', 'someotherword'],

        // FIX: Animation performance is improved by reducing particle counts.
        // These values provide a good visual experience on a wider range of devices.
        PARTICLE_COUNT: 300,
        STAR_COUNT: 150,

        // Visuals
        CANVAS_VERTICAL_CENTER_RATIO: 0.4,
        EVENT_HORIZON_RADIUS: 45,
        RELEASE_ANIMATION_DURATION_MS: 600,

        // API & UX
        LISTEN_QUERY_LIMIT: 10,
        // FIX: The number of recent posts to remember to avoid repetition.
        SEEN_POSTS_HISTORY_LENGTH: 10
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

    // --- STATE AND CONFIG ---
    let currentUser = null;
    let particles = [];
    let transitionParticles = [];
    let stars = [];
    const blocklist = CONFIG.BLOCKLIST;
    let centerX, centerY;
    const eventHorizonRadius = CONFIG.EVENT_HORIZON_RADIUS;

    // --- COOLDOWN STATE ---
    let cooldownInterval = null;
    let cooldownEndTime = 0;

    // --- PRE-COMPUTED GRADIENTS (MEMORY OPTIMIZATION) ---
    let dustGradient = null;
    let thoughtGradient = null;

    // --- HELPER FUNCTION ---
    const lerp = (a, b, t) => a * (1 - t) + b * t;

    // --- PARTICLE CLASSES (No Changes) ---
    class TransitionParticle {
        constructor(startX, startY) {
            this.state = 'traveling';
            this.travelProgress = 0;
            this.fadeProgress = 1.0;
            this.startX = startX;
            this.startY = startY;
            this.endRadius = centerX * 0.75;
            this.endAngle = Math.PI;
            this.endX = centerX + Math.cos(this.endAngle) * this.endRadius;
            this.endY = centerY + Math.sin(this.endAngle) * this.endRadius * 0.4;
            this.controlX = this.endX;
            this.controlY = this.startY;
            this.travelSpeed = 0.01;
            this.fadeSpeed = 0.01;
            this.size = 8;
        }
        update() {
            if (this.state === 'traveling') {
                this.travelProgress += this.travelSpeed;
                if (this.travelProgress >= 1.0) {
                    this.travelProgress = 1.0;
                    this.state = 'fading';
                    this.radius = this.endRadius;
                    this.angle = this.endAngle;
                    this.angularSpeed = 2 / this.radius;
                }
            } else if (this.state === 'fading') {
                this.radius -= 0.4;
                this.angle += this.angularSpeed;
                this.fadeProgress -= this.fadeSpeed;
                if (this.fadeProgress <= 0) {
                    return { done: true, radius: this.radius, angle: this.angle };
                }
            }
            return { done: false };
        }
        draw() {
            if (this.state === 'traveling') {
                const t = this.travelProgress;
                const t_inv = 1 - t;
                const t_inv_sq = t_inv * t_inv;
                const t_sq = t * t;
                this.x = t_inv_sq * this.startX + 2 * t_inv * t * this.controlX + t_sq * this.endX;
                this.y = t_inv_sq * this.startY + 2 * t_inv * t * this.controlY + t_sq * this.endY;
            } else {
                this.x = centerX + Math.cos(this.angle) * this.radius;
                this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
            }
            const p_inner = { r: 224, g: 195, b: 255 };
            const p_outer = { r: 157, g: 78, b: 221 };
            const w_inner = { r: 255, g: 255, b: 255 };
            const w_outer = { r: 224, g: 195, b: 255 };
            const t = this.fadeProgress;
            const innerR = lerp(w_inner.r, p_inner.r, t);
            const innerG = lerp(w_inner.g, p_inner.g, t);
            const innerB = lerp(w_inner.b, p_inner.b, t);
            const outerR = lerp(w_outer.r, p_outer.r, t);
            const outerG = lerp(w_outer.g, p_outer.g, t);
            const outerB = lerp(w_outer.b, p_outer.b, t);
            const dynamicGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
            dynamicGradient.addColorStop(0, `rgba(${innerR}, ${innerG}, ${innerB}, 1)`);
            dynamicGradient.addColorStop(0.5, `rgba(${outerR}, ${outerG}, ${outerB}, 0.9)`);
            dynamicGradient.addColorStop(1, `rgba(${outerR}, ${outerG}, ${outerB}, 0)`);
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.fillStyle = dynamicGradient;
            ctx.beginPath();
            ctx.arc(0, 0, this.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
    class Particle {
        constructor(orbitRadius, orbitAngle) {
            this.radius = orbitRadius;
            this.angle = orbitAngle;
            this.isUserThought = !!orbitRadius;
            if (!this.isUserThought) { this.reset(); }
            this.angularSpeed = 2 / this.radius;
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
            this.radius -= 0.4;
            this.angle += this.angularSpeed;
            this.x = centerX + Math.cos(this.angle) * this.radius;
            this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
            if (this.radius < eventHorizonRadius) {
                if (this.isUserThought) { return false; }
                else { this.reset(); }
            }
            return true;
        }
        draw() {
            ctx.save();
            const p = (this.y / canvas.height) * 0.8 + 0.2;
            const displaySize = this.size * p;
            ctx.translate(this.x, this.y);
            ctx.scale(displaySize, displaySize);
            ctx.fillStyle = this.gradient;
            ctx.beginPath();
            ctx.arc(0, 0, 1, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // --- CANVAS & ANIMATION ---
    function setupCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        centerX = canvas.width / 2;
        centerY = canvas.height * CONFIG.CANVAS_VERTICAL_CENTER_RATIO;
        const thoughtSize = 8;
        thoughtGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, thoughtSize);
        thoughtGradient.addColorStop(0, '#e0c3ff');
        thoughtGradient.addColorStop(0.5, '#9D4EDD');
        thoughtGradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        const dustSize = 4;
        dustGradient = ctx.createRadialGradient(0, 0, 0, 0, 0, dustSize);
        dustGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        dustGradient.addColorStop(0.2, 'rgba(224, 195, 255, 0.9)');
        dustGradient.addColorStop(0.8, 'rgba(157, 78, 221, 0.3)');
        dustGradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        stars = [];
        for (let i = 0; i < CONFIG.STAR_COUNT; i++) stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: Math.random() * 1.5, opacity: Math.random() * 0.5 + 0.1 });
        particles = [];
        for (let i = 0; i < CONFIG.PARTICLE_COUNT; i++) particles.push(new Particle());
    }

    function animate() {
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = 'rgba(4, 2, 10, 0.25)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        stars.forEach(star => {
            ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
            ctx.fillRect(star.x, star.y, star.size, star.size);
        });
        ctx.globalCompositeOperation = 'lighter';
        particles = particles.filter(p => p.update());
        particles.forEach(p => p.draw());
        transitionParticles.forEach((tp, index) => {
            const result = tp.update();
            if (result.done) {
                particles.push(new Particle(result.radius, result.angle));
                transitionParticles.splice(index, 1);
            } else {
                tp.draw();
            }
        });
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

    // --- FRONT-END COOLDOWN LOGIC (No Changes) ---
    function updateCooldownDisplay() {
        const now = Date.now();
        const secondsLeft = Math.ceil((cooldownEndTime - now) / 1000);
        if (secondsLeft > 0) {
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
        cooldownEndTime = Date.now() + CONFIG.POST_COOLDOWN_SECONDS * 1000;
        if (cooldownInterval) clearInterval(cooldownInterval);
        cooldownInterval = setInterval(updateCooldownDisplay, 1000);
        updateCooldownDisplay();
    }

    // --- MODAL CONTROLS (No Changes) ---
    const openComposeModal = () => {
        composeModal.classList.add('is-visible');
        updateCooldownDisplay();
    };
    const closeComposeModal = () => composeModal.classList.remove('is-visible');
    const openListenModal = () => postModal.classList.add('is-visible');
    const closeListenModal = () => postModal.classList.remove('is-visible');

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
            animator.style.height = '150px';
            animator.style.left = '50%';
            animator.style.top = `${actionRect.top - 150 - 20}px`;
            animator.style.transform = 'translateX(-50%)';
            animator.textContent = content;
            document.body.appendChild(animator);

            setTimeout(() => {
                animator.style.width = '10px';
                animator.style.height = '10px';
                animator.style.borderRadius = '50%';
                animator.style.color = 'transparent';
                animator.style.padding = '0';
                animator.style.background = 'var(--void-purple)';
                animator.style.opacity = '0.5';

                setTimeout(() => {
                    const finalRect = animator.getBoundingClientRect();
                    const startX = finalRect.left + finalRect.width / 2;
                    const startY = finalRect.top + finalRect.height / 2;
                    transitionParticles.push(new TransitionParticle(startX, startY));
                    animator.remove();
                }, CONFIG.RELEASE_ANIMATION_DURATION_MS);
            }, 100);

            startCooldown();

        } catch (error) {
            console.error("Failed to release thought:", error);
            if (error.code === 'permission-denied') {
                showFeedback('You are posting too frequently. Please wait.', 'error');
                startCooldown();
            } else {
                showFeedback('Your thought was lost in the ether. Please try again.', 'error');
                updateCooldownDisplay();
            }
        }
    }

    async function savePostToFirebase(content) {
        if (!currentUser) throw new Error("User not authenticated.");

        const postBatch = writeBatch(db);
        const postRef = doc(collection(db, 'public_posts'));
        const contentWords = content.toLowerCase().split(/\s+/).filter(Boolean);

        postBatch.set(postRef, {
            content,
            authorId: currentUser.uid,
            createdAt: serverTimestamp(),
            content_words: contentWords
        });
        await postBatch.commit();

        const userActivityRef = doc(db, 'user_activity', currentUser.uid);
        await setDoc(userActivityRef, {
            lastPostTimestamp: serverTimestamp()
        });
    }

    // FIX: This function is completely rewritten to prevent listening to the same post twice.
    async function handleListenToVoid() {
        if (!currentUser) return;

        listenButtonEl.disabled = true;
        listenButtonEl.textContent = 'Listening...';
        modalTextEl.textContent = 'The void is vast...';
        openListenModal();

        try {
            // Get the list of already seen post IDs from the browser's local storage.
            const seenIds = JSON.parse(localStorage.getItem('voidquill_seen_posts')) || [];

            const postsRef = collection(db, 'public_posts');
            const randomId = doc(postsRef).id;
            let foundPostDoc = null;

            // Helper to find a post using a given query. Now returns the full document.
            const findPost = async (q) => {
                const snapshot = await getDocs(q);
                if (!snapshot.empty) {
                    const randomIndex = Math.floor(Math.random() * snapshot.docs.length);
                    return snapshot.docs[randomIndex];
                }
                return null;
            };
            
            // Base queries now filter out posts by the current user AND posts they have already seen.
            const queryConstraints = [
                where('authorId', '!=', currentUser.uid)
            ];
            if (seenIds.length > 0) {
                queryConstraints.push(where(documentId(), 'not-in', seenIds));
            }

            // Query 1: Look for posts with an ID >= our random ID.
            const q1 = query(postsRef,
                ...queryConstraints,
                where(documentId(), '>=', randomId),
                limit(CONFIG.LISTEN_QUERY_LIMIT)
            );
            foundPostDoc = await findPost(q1);

            // Query 2 (Fallback): If no post was found, search backwards from the random ID.
            if (!foundPostDoc) {
                const q2 = query(postsRef,
                    ...queryConstraints,
                    where(documentId(), '<', randomId),
                    limit(CONFIG.LISTEN_QUERY_LIMIT)
                );
                foundPostDoc = await findPost(q2);
            }

            if (foundPostDoc) {
                const foundPostContent = foundPostDoc.data().content;
                const foundPostId = foundPostDoc.id;
                modalTextEl.textContent = foundPostContent;

                // Add the ID of the new post to our seen list.
                seenIds.push(foundPostId);
                // Keep the list from growing too large by removing the oldest entry.
                while (seenIds.length > CONFIG.SEEN_POSTS_HISTORY_LENGTH) {
                    seenIds.shift();
                }
                // Save the updated list back to local storage.
                localStorage.setItem('voidquill_seen_posts', JSON.stringify(seenIds));

            } else {
                modalTextEl.textContent = "The void is silent. No other thoughts were found.";
            }

        } catch (error) {
            console.error("An error occurred while listening to the void:", error);
            modalTextEl.textContent = "A cosmic interference prevented listening. Please try again.";
        } finally {
            listenButtonEl.disabled = false;
            listenButtonEl.textContent = 'Listen to the Void';
        }
    }

    // --- EVENT LISTENERS (No Changes) ---
    composeButton.addEventListener('click', openComposeModal);
    composeCloseButton.addEventListener('click', closeComposeModal);
    composeModal.addEventListener('click', (e) => { if (e.target === composeModal) closeComposeModal(); });
    releaseButtonEl.addEventListener('click', handleReleasePost);
    listenButtonEl.addEventListener('click', handleListenToVoid);
    modalCloseButton.addEventListener('click', closeListenModal);
    postModal.addEventListener('click', (e) => { if (e.target === postModal) closeListenModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeComposeModal(); closeListenModal(); } });

    // --- HELPER FUNCTIONS (No Changes) ---
    function showFeedback(message, type) {
        feedbackMessageEl.textContent = message;
        feedbackMessageEl.className = `feedback ${type}`;
        setTimeout(() => {
            feedbackMessageEl.textContent = '';
            feedbackMessageEl.className = 'feedback';
        }, 4000);
    }

    function isTextClean(text) {
        const lowerCaseText = text.toLowerCase();
        return !blocklist.some(word => lowerCaseText.includes(word));
    }

    // --- AUTHENTICATION (No Changes) ---
    composeButton.disabled = true;
    listenButtonEl.disabled = true;

    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            composeButton.disabled = false;
            listenButtonEl.disabled = false;
        } else {
            currentUser = null;
            composeButton.disabled = true;
            listenButtonEl.disabled = true;
            signInAnonymously(auth).catch((error) => {
                console.error("Anonymous authentication failed", error);
                document.querySelector('.main-title').textContent = 'Connection Lost';
            });
        }
    });
});