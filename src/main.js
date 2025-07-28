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
// NEW: An array to hold the temporary traveling particles
let transitionParticles = [];
let stars = [];
const blocklist = ['spamword', 'badword', 'someotherword'];
let centerX, centerY;
const eventHorizonRadius = 45;

// NEW CLASS: Based on your example, this particle travels to its orbit
class TransitionParticle {
    constructor(startX, startY) {
        this.x = startX;
        this.y = startY;
        
        // Give it a random destination orbit
        this.targetRadius = Math.random() * (canvas.width * 0.1) + (canvas.width * 0.25);
        this.targetAngle = Math.random() * Math.PI * 2;
        
        this.size = 8;
        this.speed = 3; // Adjust for faster/slower travel
        
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
        gradient.addColorStop(0, '#e0c3ff');
        gradient.addColorStop(0.5, '#9D4EDD');
        gradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        this.gradient = gradient;
    }

    update() {
        // Calculate the destination point in its orbit
        const targetX = centerX + Math.cos(this.targetAngle) * this.targetRadius;
        const targetY = centerY + Math.sin(this.targetAngle) * this.targetRadius * 0.4;

        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // If it's close enough, signal that it's time to convert
        if (dist < this.speed) {
            // Return the final parameters for the permanent particle
            return { done: true, radius: this.targetRadius, angle: this.targetAngle };
        }

        // Move towards the destination
        this.x += (dx / dist) * this.speed;
        this.y += (dy / dist) * this.speed;
        return { done: false };
    }
    
    draw() {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.fillStyle = this.gradient;
        ctx.beginPath();
        ctx.arc(0, 0, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// UPDATED CLASS: Particle now takes pre-calculated orbit data
class Particle {
    constructor(orbitRadius, orbitAngle) {
        this.radius = orbitRadius;
        this.angle = orbitAngle;
        
        // Is this a user-generated particle or ambient dust?
        this.isUserThought = !!orbitRadius;

        if (!this.isUserThought) {
            this.reset();
        }

        this.angularSpeed = 2 / this.radius;
        this.size = this.isUserThought ? 8 : Math.random() * 4 + 2;
        
        // Create a distinct gradient for user thoughts
        const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, this.size);
        if (this.isUserThought) {
            gradient.addColorStop(0, '#e0c3ff');
            gradient.addColorStop(0.5, '#9D4EDD');
            gradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        } else {
            gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
            gradient.addColorStop(0.2, 'rgba(224, 195, 255, 0.9)');
            gradient.addColorStop(0.8, 'rgba(157, 78, 221, 0.3)');
            gradient.addColorStop(1, 'rgba(157, 78, 221, 0)');
        }
        this.gradient = gradient;
        
        // Calculate initial x/y position
        this.x = centerX + Math.cos(this.angle) * this.radius;
        this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;
    }

    reset() {
        this.radius = Math.random() * (canvas.width * 0.5) + (canvas.width * 0.2);
        this.angle = Math.random() * Math.PI * 2;
        this.angularSpeed = 2 / this.radius;
    }

    update() {
        this.radius -= 0.7;
        this.angle += this.angularSpeed;
        this.x = centerX + Math.cos(this.angle) * this.radius;
        this.y = centerY + Math.sin(this.angle) * this.radius * 0.4;

        if (this.radius < eventHorizonRadius) {
            if (this.isUserThought) {
                return false; // User thoughts get consumed
            } else {
                this.reset(); // Ambient dust gets recycled
            }
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

function setupCanvas() {
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
    centerX = canvas.width / 2; centerY = canvas.height * 0.4;
    stars = []; for (let i = 0; i < 300; i++) stars.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, size: Math.random() * 1.5, opacity: Math.random() * 0.5 + 0.1 });
    particles = []; const particleCount = 600;
    for (let i = 0; i < particleCount; i++) particles.push(new Particle());
}

// UPDATED: The main animation loop now manages transition particles
function animate() {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(4, 2, 10, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    stars.forEach(star => {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity})`;
        ctx.fillRect(star.x, star.y, star.size, star.size);
    });

    ctx.globalCompositeOperation = 'lighter';
    
    // Update and draw permanent particles
    particles = particles.filter(p => p.update());
    particles.forEach(p => p.draw());

    // Update and draw traveling particles
    transitionParticles.forEach((tp, index) => {
        const result = tp.update();
        if (result.done) {
            // When done, create a permanent particle and remove the transition one
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

// --- MODAL CONTROLS ---
const openComposeModal = () => composeModal.classList.add('is-visible');
const closeComposeModal = () => composeModal.classList.remove('is-visible');

// UPDATED: The release logic is now much simpler and more effective
async function handleReleasePost() {
    const content = postContentEl.value.trim();
    if (!currentUser || content.length === 0 || !isTextClean(content)) {
        showFeedback('Your thought is empty or invalid.', 'error');
        return;
    }

    const buttonRect = composeButton.getBoundingClientRect();
    closeComposeModal();

    // Create a temporary DOM element to mark the starting spot
    const animator = document.createElement('div');
    animator.className = 'release-animator';
    animator.style.width = '350px';
    animator.style.height = '150px';
    animator.style.left = `50%`;
    animator.style.top = `${buttonRect.top - 150 - 20}px`;
    animator.textContent = content;
    document.body.appendChild(animator);

    // After a short delay, morph the DOM element and create the canvas particle
    setTimeout(() => {
        // Morph the DOM element into an "orb"
        animator.style.width = '10px';
        animator.style.height = '10px';
        animator.style.borderRadius = '50%';
        animator.style.color = 'transparent';
        animator.style.padding = '0';
        animator.style.background = 'var(--void-purple)';

        // Get its final position
        const finalRect = animator.getBoundingClientRect();
        const startX = finalRect.left + finalRect.width / 2;
        const startY = finalRect.top + finalRect.height / 2;
        
        // HANDOFF: Create the new canvas-based traveling particle
        transitionParticles.push(new TransitionParticle(startX, startY));
        
        // Fade out and remove the DOM element
        animator.style.opacity = '0';
        setTimeout(() => animator.remove(), 500);

    }, 100); // A brief moment to let the user see their text

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