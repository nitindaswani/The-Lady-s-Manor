/* --- SETUP --- */
const world = document.getElementById('game-world');
const overlay = document.getElementById('darkness-overlay');
const damageOverlay = document.getElementById('damage-overlay');
const entityLayer = document.getElementById('entity-layer');
const sanityBar = document.getElementById('sanity-bar');

// Game State
let gameState = 'MENU';
let level = 1;
let dollsFound = 0;
let dollsNeeded = 3;
let flashlightOn = true;
let sanity = 100;
let maxWorldWidth = 4000;

// Camera / Input
let cameraX = 0;
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;

// Lady AI
let ladyElement = null;
let ladyActive = false;
let ladyTimer = null;
let heartbeatInterval = null;

/* --- AUDIO ENGINE --- */
const AudioSys = {
    ctx: null,
    
    init: () => {
        if(!AudioSys.ctx) AudioSys.ctx = new (window.AudioContext || window.webkitAudioContext)();
    },

    resume: () => {
        if(AudioSys.ctx && AudioSys.ctx.state === 'suspended') {
            AudioSys.ctx.resume();
        }
    },

    playAmbience: () => {
        if(!AudioSys.ctx) return;
        // Deep drone
        const osc = AudioSys.ctx.createOscillator();
        const gain = AudioSys.ctx.createGain();
        osc.frequency.value = 55;
        osc.type = 'sawtooth';
        
        const filter = AudioSys.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 150;

        gain.gain.value = 0.1;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(AudioSys.ctx.destination);
        osc.start();
    },

    playHeartbeat: () => {
        if(!AudioSys.ctx) return;
        const t = AudioSys.ctx.currentTime;
        const osc = AudioSys.ctx.createOscillator();
        const gain = AudioSys.ctx.createGain();
        
        osc.frequency.setValueAtTime(60, t);
        osc.frequency.exponentialRampToValueAtTime(10, t + 0.1);
        
        gain.gain.setValueAtTime(0.5, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        
        osc.connect(gain);
        gain.connect(AudioSys.ctx.destination);
        osc.start();
        osc.stop(t+0.2);
    },

    playScream: () => {
        if(!AudioSys.ctx) return;
        const t = AudioSys.ctx.currentTime;
        const osc = AudioSys.ctx.createOscillator();
        const gain = AudioSys.ctx.createGain();
        
        // Metallic scratch
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, t);
        osc.frequency.linearRampToValueAtTime(800, t + 0.4);
        
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.8);
        
        osc.connect(gain);
        gain.connect(AudioSys.ctx.destination);
        osc.start();
        osc.stop(t+1);
    },

    playCollect: () => {
        if(!AudioSys.ctx) return;
        const t = AudioSys.ctx.currentTime;
        const osc = AudioSys.ctx.createOscillator();
        const gain = AudioSys.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, t);
        osc.frequency.linearRampToValueAtTime(1200, t + 0.1);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.linearRampToValueAtTime(0, t + 0.2);
        osc.connect(gain);
        gain.connect(AudioSys.ctx.destination);
        osc.start();
        osc.stop(t+0.2);
    }
};

/* --- INPUT HANDLING --- */
document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    updateFlashlight();
});

document.addEventListener('keydown', (e) => {
    if (gameState !== 'PLAYING') return;
    
    if (e.code === 'Space') {
        flashlightOn = !flashlightOn;
        updateFlashlight();
    }
});

function updateFlashlight() {
    if (gameState !== 'PLAYING') {
        overlay.style.background = '#000';
        return;
    }

    if (flashlightOn) {
        // Flicker effect
        const size = Math.random() > 0.95 ? 240 : 250;
        overlay.style.background = `radial-gradient(circle at ${mouseX}px ${mouseY}px, transparent 80px, rgba(0,0,0,0.98) ${size}px)`;
    } else {
        overlay.style.background = '#000';
    }
}

/* --- GAME LOOP --- */
function gameLoop() {
    if (gameState !== 'PLAYING') return;

    // 1. Camera Panning logic (Mouse near edges)
    const edgeThreshold = 150;
    const scrollSpeed = 12;

    if (mouseX < edgeThreshold && cameraX < 0) {
        cameraX += scrollSpeed;
    } else if (mouseX > window.innerWidth - edgeThreshold && cameraX > -(maxWorldWidth - window.innerWidth)) {
        cameraX -= scrollSpeed;
    }
    world.style.transform = `translateX(${cameraX}px)`;

    // 2. Lady/Sanity Logic
    if (ladyActive) {
        // Get Lady position relative to viewport
        const ladyRect = ladyElement.getBoundingClientRect();
        
        // Check if she is roughly on screen
        const onScreen = (ladyRect.right > 0 && ladyRect.left < window.innerWidth);

        if (onScreen && flashlightOn) {
            // Check distance
            const dx = mouseX - (ladyRect.left + ladyRect.width/2);
            const dy = mouseY - (ladyRect.top + ladyRect.height/2);
            const dist = Math.sqrt(dx*dx + dy*dy);

            // If aimed near her
            if (dist < 400) {
                sanity -= 1.5; // Drain sanity
                damageOverlay.classList.add('hurt');
            } else {
                damageOverlay.classList.remove('hurt');
            }
        } else {
            damageOverlay.classList.remove('hurt');
            // Recover slightly if hiding
            if (!flashlightOn) sanity = Math.min(100, sanity + 0.05);
        }
    } else {
        damageOverlay.classList.remove('hurt');
        sanity = Math.min(100, sanity + 0.02);
    }

    // Update UI
    sanityBar.style.width = `${Math.max(0, sanity)}%`;
    if (sanity <= 20) sanityBar.style.backgroundColor = 'red';
    else if (sanity <= 50) sanityBar.style.backgroundColor = 'orange';
    else sanityBar.style.backgroundColor = '#00ff00';

    if (sanity <= 0) {
        gameOver("Your mind has broken.");
    }

    requestAnimationFrame(gameLoop);
}

/* --- LEVEL LOGIC --- */
function spawnLevel() {
    entityLayer.innerHTML = '';
    dollsFound = 0;
    dollsNeeded = 2 + level;
    document.getElementById('doll-count').innerText = dollsFound;
    document.getElementById('doll-total').innerText = dollsNeeded;

    // Create Dolls
    for(let i=0; i<dollsNeeded; i++) {
        const doll = document.createElement('div');
        doll.className = 'doll';
        // Random X position within world
        const x = 200 + Math.random() * (maxWorldWidth - 400);
        doll.style.left = `${x}px`;
        
        // Click event
        doll.addEventListener('mousedown', (e) => {
            e.stopPropagation(); // Stop click from hitting other things
            if(flashlightOn) collectDoll(doll);
        });
        
        entityLayer.appendChild(doll);
    }

    // Lady Setup
    ladyElement = document.createElement('div');
    ladyElement.className = 'lady';
    entityLayer.appendChild(ladyElement);

    resetLadyTimer();
}

function collectDoll(el) {
    el.remove();
    AudioSys.playCollect();
    dollsFound++;
    document.getElementById('doll-count').innerText = dollsFound;

    if (dollsFound >= dollsNeeded) {
        startQuiz();
    }
}

/* --- LADY AI --- */
function resetLadyTimer() {
    if (gameState !== 'PLAYING') return;
    
    // Stop current haunt
    clearTimeout(ladyTimer);
    clearInterval(heartbeatInterval);
    ladyActive = false;
    ladyElement.classList.remove('lady-visible');

    // Schedule next haunt (random 3s to 8s)
    const delay = 3000 + Math.random() * 5000;
    ladyTimer = setTimeout(manifestLady, delay);
}

function manifestLady() {
    if (gameState !== 'PLAYING') return;

    // Determine spawn X (relative to where player is looking)
    // We want her to spawn roughly near the center of the screen in world-space
    const screenCenterWorldX = Math.abs(cameraX) + (window.innerWidth / 2);
    // Random offset (-500 to +500 px)
    const offset = (Math.random() - 0.5) * 1000;
    
    let spawnX = screenCenterWorldX + offset;
    // Clamp to world bounds
    spawnX = Math.max(100, Math.min(maxWorldWidth - 200, spawnX));

    ladyElement.style.left = `${spawnX}px`;
    ladyElement.classList.add('lady-visible');
    ladyActive = true;

    AudioSys.playScream();

    // Start Heartbeat
    heartbeatInterval = setInterval(() => {
        AudioSys.playHeartbeat();
    }, 400);

    // She leaves after 4 seconds
    setTimeout(resetLadyTimer, 4000);
}

/* --- QUIZ --- */
const riddles = [
    { q: "I have keys but open no locks.", a: ["piano"] },
    { q: "The more you take, the more you leave behind.", a: ["footsteps", "steps"] },
    { q: "What has many eyes but cannot see?", a: ["potato"] },
    { q: "I'm tall when I'm young, and I'm short when I'm old.", a: ["candle"] }
];

function startQuiz() {
    gameState = 'QUIZ';
    document.getElementById('quiz-screen').classList.remove('hidden');
    
    // Stop AI
    clearTimeout(ladyTimer);
    clearInterval(heartbeatInterval);
    damageOverlay.classList.remove('hurt');

    const r = riddles[(level - 1) % riddles.length];
    document.getElementById('quiz-question').innerText = r.q;
}

document.getElementById('submit-quiz').addEventListener('click', () => {
    const input = document.getElementById('quiz-answer').value.toLowerCase().trim();
    const r = riddles[(level - 1) % riddles.length];

    if (r.a.includes(input)) {
        level++;
        document.getElementById('level-num').innerText = level;
        document.getElementById('quiz-answer').value = '';
        document.getElementById('quiz-screen').classList.add('hidden');
        
        gameState = 'PLAYING';
        spawnLevel();
        gameLoop();
    } else {
        document.getElementById('quiz-feedback').innerText = "Wrong. You feel weaker.";
        sanity -= 20;
    }
});

/* --- SYSTEM --- */
function startGame() {
    AudioSys.init();
    AudioSys.resume();
    AudioSys.playAmbience();

    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('quiz-screen').classList.add('hidden');
    
    gameState = 'PLAYING';
    level = 1;
    sanity = 100;
    cameraX = 0;
    // Initial Flashlight Pos
    mouseX = window.innerWidth / 2;
    mouseY = window.innerHeight / 2;
    world.style.transform = 'translateX(0px)';
    
    spawnLevel();
    updateFlashlight();
    gameLoop();
}

function gameOver(reason) {
    gameState = 'GAMEOVER';
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('death-reason').innerText = reason;
    
    clearTimeout(ladyTimer);
    clearInterval(heartbeatInterval);
}

document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);