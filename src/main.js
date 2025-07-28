// src/main.js

import { db, auth, serverTimestamp, signInAnonymously, onAuthStateChanged } from '../firebase/config.js';
import { collection, doc, writeBatch, query, where, limit, getDocs, documentId } from "firebase/firestore";

document.addEventListener('DOMContentLoaded', () => {

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

// --- STATE AND CONFIG ---
let currentUser = null;
let particles = [];
let stars = [];
const blocklist = ['spamword', 'badword', 'someotherword'];
let centerX, centerY;
const eventHorizonRadius = 45;

// --- The Definitive Particle Class ---
class Particle {
    constructor(startX, startY) {
        // A particle's orbital state is defined by radius and angle
        // Its visual position is defined by x and y
        this.x = 0;
        this.y = 0;
        this.radius = 0;
        this.angle = 0;
        this.angularSpeed = 0;

        if (startX && startY) {
            // This is a handed-off particle. Its visual position starts where the orb was.
            this.x = startX;
            this.y = startY;
            // We then calculate its orbital parameters based on that position.
            const dx = this.x - centerX;
            const dy = this.y - centerY;
            this.radius = Math.sqrt(dx * dx + dy * dy);
            this.angle = Math.atan2(dy, dx);
            this.angularSpeed = 2 / this.radius;
        } else {
            // This is a standard ambient particle.
            this.reset();
        }

        this.size = Math.random() * 4 + 2;
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
        gradient.addColorStop(0.2, 'rgba(224, 195, 255, 0.9)');
        gradient.addColorStop(0.8, 'rgba(157, 78, 221, 0.3)');
        gradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        this.gradient = gradient;
    }

    reset() {
        this.radius = Math.random() * (canvas.width * 0.5) + (canvas.width * 0.2);
        this.angle = Math.random() * Math.PI * 2;
        this.angularSpeed = 2 / this.radius;
        // Calculate its initial visual position
        this.x = centerX + Math.cos(this.angle) * this.radius;
        this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
    }

    update() {
        // 1. Update the orbital parameters (the "physics")
        this.radius -= 0.7;
        this.angle += this.angularSpeed;

        // 2. Recalculate the visual position based on the new orbital parameters
        this.x = centerX + Math.cos(this.angle) * this.radius;
        this.y = centerY + Math.sin(this.angle) * this.radius * 0.4; // Elliptical orbit

        if (this.radius < eventHorizonRadius) {
            this.reset();
        }
    }

    draw() {
        ctx.save();
        // The perspective is based on the y-coordinate
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


function setupCanvas() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    centerX = canvas.width / 2; centerY = canvas.height * 0.4;
    stars = []; for (let i = 0; i < 300; i++) stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: Math.random() * 1.5, opacity: Math.random() * 0.5 + 0.1 });
    particles = []; const particleCount = 600;
    for (let i = 0; i < particleCount; i++) particles.push(new Particle());
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
    particles.forEach(p => { p.update(); p.draw(); });

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

// --- MODAL CONTROLS ---
const openComposeModal = () => composeModal.classList.add('is-visible');
const closeComposeModal = () => composeModal.classList.remove('is-visible');

// --- CORE APP LOGIC ---
async function handleReleasePost() {
    const content = postContentEl.value.trim();
    if (!currentUser || content.length === 0 || !isTextClean(content)) {
        showFeedback('Your thought is empty or invalid.', 'error');
        return;
    }

    const buttonRect = composeButton.getBoundingClientRect();
    closeComposeModal();

    const animator = document.createElement('div');
    animator.className = 'release-animator';
    const animatorHeight = 150;
    const animatorWidth = 350;
    animator.style.width = `${animatorWidth}px`;
    animator.style.height = `${animatorHeight}px`;
    animator.style.left = `50%`;
    animator.style.top = `${buttonRect.top - animatorHeight - 20}px`;
    animator.textContent = content;
    document.body.appendChild(animator);

    setTimeout(() => animator.classList.add('text-fading'), 100);
    setTimeout(() => animator.classList.add('morphing-to-orb'), 1100);

    setTimeout(() => {
        animator.classList.add('pulsing');
        setTimeout(() => {
            const finalRect = animator.getBoundingClientRect();
            const startX = finalRect.left + finalRect.width / 2;
            const startY = finalRect.top + finalRect.height / 2;

            animator.classList.remove('pulsing');
            animator.classList.add('fading-out');

            // The handoff: Create a new particle at the orb's final screen position.
            particles.push(new Particle(startX, startY));

        }, 1500);

    }, 2100);

    setTimeout(() => {
        animator.remove();
    }, 4200);

    await savePostToFirebase(content);
    postContentEl.value = '';
}

async function savePostToFirebase(content) {
    try {
        const batch = writeBatch(db);
        const postRef = doc(collection(db, 'public_posts'));
        batch.set(postRef, { content, authorId: currentUser.uid, createdAt: serverTimestamp() });
        const userActivityRef = doc(db, 'user_activity', currentUser.uid);
        batch.set(userActivityRef, { lastPostTimestamp: serverTimestamp() });
        await batch.commit();
    } catch (error) {
        console.error("Firestore Error: ", error);
    }
}

const openListenModal = () => postModal.classList.add('is-visible');
const closeListenModal = () => postModal.classList.remove('is-visible');
async function handleListenToVoid() { /* ... unchanged ... */ }

// --- EVENT LISTENERS ---
composeButton.addEventListener('click', openComposeModal);
composeCloseButton.addEventListener('click', closeComposeModal);
composeModal.addEventListener('click', (e) => { if (e.target === composeModal) closeComposeModal(); });
releaseButtonEl.addEventListener('click', handleReleasePost);
listenButtonEl.addEventListener('click', handleListenToVoid);
modalCloseButton.addEventListener('click', closeListenModal);
postModal.addEventListener('click', (e) => { if (e.target === postModal) closeListenModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeComposeModal(); closeListenModal(); } });

function showFeedback(message, type) { feedbackMessageEl.textContent = message; feedbackMessageEl.className = `feedback ${type}`; setTimeout(() => { feedbackMessageEl.textContent = ''; feedbackMessageEl.className = 'feedback'; }, 4000); }
function isTextClean(text) { const lowerCaseText = text.toLowerCase(); return !blocklist.some(word => lowerCaseText.includes(word)); }
onAuthStateChanged(auth, (user) => { if (!user) { signInAnonymously(auth).catch((error) => console.error("Auth failed", error)); } else { currentUser = user; } });

});