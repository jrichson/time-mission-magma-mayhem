import * as THREE from 'three';

// ============================================
// GAME CONFIGURATION
// ============================================
const CONFIG = {
    GRID: {
        WIDTH: 12,
        HEIGHT: 16,
        TILE_SIZE: 1,
        TILE_GAP: 0.06
    },
    PLAYER: {
        SIZE: 0.6,
        HOP_HEIGHT: 0.7,
        HOP_DURATION: 100,
        START_LIVES: 3
    },
    COLORS: {
        TILE_DEFAULT: 0x2a2a3a,
        TILE_SAFE_ISLAND: 0x00ff88,
        TILE_LAVA: 0xff3311,
        TILE_COLLECTIBLE: 0x00ccff,
        TILE_COUNTDOWN: 0x00ffff,
        BACKGROUND: 0x0a0a1a
    },
    LEVELS: {
        TOTAL: 12,
        POINTS_PER_LEVEL: [6, 7, 7, 8, 8, 8, 9, 9, 9, 9, 10, 10],
        BASE_SPEED: 900,
        SPEED_DECREASE: 40
    },
    CHARACTERS: {
        chicken: { body: 0xffdd33, accent: 0xff6622, secondary: 0xeecc22 },
        banana: { body: 0xffe135, accent: 0x8b4513, secondary: 0xffeecc },
        skier: { body: 0x2255cc, accent: 0xff4444, secondary: 0xffeecc },
        turtle: { body: 0x2d8659, accent: 0x8b4513, secondary: 0x3cb371 }
    }
};

// ============================================
// GAME STATE
// ============================================
// Expose GameState globally for leaderboard access
const GameState = window.GameState = {
    currentLevel: 1,
    totalScore: 0,
    livesRemaining: CONFIG.PLAYER.START_LIVES,
    isPaused: false,
    isGameOver: false,
    isPlaying: false,
    isCountingDown: false,
    playerPosition: { x: 6, z: 14 },
    tiles: [],
    lavaTiles: new Set(),
    collectibleTiles: new Set(),
    safeIslands: new Set(),
    isHopping: false,
    hopStartTime: 0,
    hopStartPos: { x: 0, y: 0, z: 0 },
    hopEndPos: { x: 0, y: 0, z: 0 },
    lavaPatterns: [],
    invincible: false,
    invincibleUntil: 0,
    selectedCharacter: 'chicken',
    musicPlaying: false,
    // Time-based scoring
    levelStartTime: 0,
    maxLevelScore: 10,      // Max points per level
    gracePeriod: 10000,     // 10 seconds before score starts dropping
    scoreDecayTime: 20000,  // Score drops to 0 over 20 seconds after grace period
    currentLevelScore: 10,  // Current potential score for this level
    tutorialShown: false    // Track if tutorial has been shown this session
};

// ============================================
// THREE.JS SETUP
// ============================================
let scene, camera, renderer;
let playerMesh, tilesMeshes = [];
let clock;
let audioContext, musicOscillators = [];

// Large number patterns for countdown (7x9 grid for better visibility)
const NUMBER_PATTERNS = {
    3: [
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1],
        [0,0,0,0,0,1,1],
        [0,0,0,0,0,1,1],
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1],
        [0,0,0,0,0,1,1],
        [0,0,0,0,0,1,1],
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1]
    ],
    2: [
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1],
        [0,0,0,0,0,1,1],
        [0,0,0,0,0,1,1],
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1],
        [1,1,0,0,0,0,0],
        [1,1,0,0,0,0,0],
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1]
    ],
    1: [
        [0,0,0,1,1,0,0],
        [0,0,1,1,1,0,0],
        [0,1,1,1,1,0,0],
        [0,0,0,1,1,0,0],
        [0,0,0,1,1,0,0],
        [0,0,0,1,1,0,0],
        [0,0,0,1,1,0,0],
        [0,0,0,1,1,0,0],
        [1,1,1,1,1,1,1],
        [1,1,1,1,1,1,1]
    ]
};

function getCameraSettings(forCountdown = false) {
    const aspect = window.innerWidth / window.innerHeight;
    const isMobile = window.innerWidth <= 768;
    const isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    const isMobileOrTouch = isMobile || isTouchDevice;

    // Base frustum size and zoom (desktop)
    let frustumSize = 16;
    let zoom = 1.1;
    let followPlayer = false;

    // Mobile settings - balanced zoom for countdown and gameplay
    if (isMobileOrTouch && aspect < 1) {
        if (forCountdown) {
            // Portrait mobile COUNTDOWN - show most of the board
            frustumSize = 24;
            zoom = 0.65;
            followPlayer = false;
        } else {
            // Portrait mobile GAMEPLAY - comfortable zoom to see ahead
            frustumSize = 18;
            zoom = 0.75;
            followPlayer = true;
        }
    } else if (isMobileOrTouch) {
        if (forCountdown) {
            // Landscape mobile COUNTDOWN - show most of board
            frustumSize = 22;
            zoom = 0.7;
            followPlayer = false;
        } else {
            // Landscape mobile GAMEPLAY - comfortable zoom
            frustumSize = 18;
            zoom = 0.75;
            followPlayer = true;
        }
    }

    return { aspect, frustumSize, zoom, followPlayer, isMobile: isMobileOrTouch };
}

// Camera tracking state for mobile
const CameraState = {
    targetLookAt: { x: 6, y: 0, z: 12 },
    currentLookAt: { x: 6, y: 0, z: 12 },
    smoothSpeed: 0.15, // How fast camera follows (0-1, higher = faster)
    initialized: false,
    isTransitioning: false,
    transitionProgress: 0
};

// Set camera to show entire board (for countdown)
function setCameraForCountdown() {
    const settings = getCameraSettings(true); // true = countdown mode
    if (!settings.isMobile) return;

    const gridCenterX = CONFIG.GRID.WIDTH / 2;
    const gridCenterZ = CONFIG.GRID.HEIGHT / 2;

    // Update camera frustum for full board view
    camera.left = -settings.frustumSize * settings.aspect / 2;
    camera.right = settings.frustumSize * settings.aspect / 2;
    camera.top = settings.frustumSize / 2;
    camera.bottom = -settings.frustumSize / 2;
    camera.zoom = settings.zoom;

    // Position camera high and far to see entire board
    // Isometric offset from center, but higher up to see more
    camera.position.set(gridCenterX + 14, 20, gridCenterZ + 14);
    camera.lookAt(gridCenterX, 0, gridCenterZ);
    camera.updateProjectionMatrix();
}

// Transition camera from countdown view to gameplay view
function transitionCameraToGameplay() {
    const settings = getCameraSettings(false); // false = gameplay mode
    if (!settings.isMobile) return;

    // Update camera frustum for gameplay
    camera.left = -settings.frustumSize * settings.aspect / 2;
    camera.right = settings.frustumSize * settings.aspect / 2;
    camera.top = settings.frustumSize / 2;
    camera.bottom = -settings.frustumSize / 2;
    camera.zoom = settings.zoom;
    camera.updateProjectionMatrix();

    // Reset camera state to follow player
    resetCameraToPlayer();
}

function updateCameraFollow() {
    const settings = getCameraSettings();
    if (!settings.followPlayer) return;

    // Target camera on player position
    const playerX = GameState.playerPosition.x;
    const playerZ = GameState.playerPosition.z;

    // Center on player with slight bias ahead (lower Z = toward goal)
    CameraState.targetLookAt.x = playerX;
    CameraState.targetLookAt.z = playerZ - 1;

    // Smoothly interpolate current look position toward target
    const speed = CameraState.smoothSpeed;
    CameraState.currentLookAt.x += (CameraState.targetLookAt.x - CameraState.currentLookAt.x) * speed;
    CameraState.currentLookAt.z += (CameraState.targetLookAt.z - CameraState.currentLookAt.z) * speed;

    // Camera position offset for isometric view
    const offsetX = 10;
    const offsetY = 12;
    const offsetZ = 10;

    camera.position.set(
        CameraState.currentLookAt.x + offsetX,
        offsetY,
        CameraState.currentLookAt.z + offsetZ
    );
    camera.lookAt(CameraState.currentLookAt.x, 0, CameraState.currentLookAt.z);
    camera.updateProjectionMatrix();
}

function resetCameraToPlayer() {
    const settings = getCameraSettings();
    if (!settings.followPlayer) return;

    // Instantly snap camera to player position
    CameraState.currentLookAt.x = GameState.playerPosition.x;
    CameraState.currentLookAt.z = GameState.playerPosition.z - 1;
    CameraState.targetLookAt.x = CameraState.currentLookAt.x;
    CameraState.targetLookAt.z = CameraState.currentLookAt.z;
    CameraState.initialized = true;

    // Apply immediately
    const offsetX = 10;
    const offsetY = 12;
    const offsetZ = 10;
    camera.position.set(
        CameraState.currentLookAt.x + offsetX,
        offsetY,
        CameraState.currentLookAt.z + offsetZ
    );
    camera.lookAt(CameraState.currentLookAt.x, 0, CameraState.currentLookAt.z);
    camera.updateProjectionMatrix();
}

function initThreeJS() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.COLORS.BACKGROUND);

    const { aspect, frustumSize, zoom } = getCameraSettings();
    camera = new THREE.OrthographicCamera(
        -frustumSize * aspect / 2,
        frustumSize * aspect / 2,
        frustumSize / 2,
        -frustumSize / 2,
        0.1,
        100
    );

    const gridCenterX = CONFIG.GRID.WIDTH / 2;
    const gridCenterZ = CONFIG.GRID.HEIGHT / 2;

    // Position camera - centered on grid initially
    camera.position.set(gridCenterX + 12, 15, gridCenterZ + 12);
    camera.lookAt(gridCenterX, 0, gridCenterZ);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();

    const canvas = document.getElementById('game-canvas');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    setupLighting();
    clock = new THREE.Clock();
    window.addEventListener('resize', onWindowResize);
}

function setupLighting() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
    directionalLight.position.set(10, 25, 10);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 60;
    directionalLight.shadow.camera.left = -20;
    directionalLight.shadow.camera.right = 20;
    directionalLight.shadow.camera.top = 25;
    directionalLight.shadow.camera.bottom = -25;
    scene.add(directionalLight);

    const fillLight = new THREE.DirectionalLight(0xff6644, 0.3);
    fillLight.position.set(-10, 15, -10);
    scene.add(fillLight);

    const hemiLight = new THREE.HemisphereLight(0xaaccff, 0x442222, 0.4);
    scene.add(hemiLight);
}

function onWindowResize() {
    const { aspect, frustumSize, zoom } = getCameraSettings();
    camera.left = -frustumSize * aspect / 2;
    camera.right = frustumSize * aspect / 2;
    camera.top = frustumSize / 2;
    camera.bottom = -frustumSize / 2;
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// ============================================
// CHARACTER CREATION
// ============================================
function createPlayer() {
    if (playerMesh) scene.remove(playerMesh);

    const colors = CONFIG.CHARACTERS[GameState.selectedCharacter];
    const playerGroup = new THREE.Group();

    switch (GameState.selectedCharacter) {
        case 'chicken': createChickenModel(playerGroup, colors); break;
        case 'banana': createBananaManModel(playerGroup, colors); break;
        case 'skier': createSkierModel(playerGroup, colors); break;
        case 'turtle': createTurtleModel(playerGroup, colors); break;
        case 'delorean': createDeloreanModel(playerGroup, colors); break;
    }

    playerGroup.position.set(GameState.playerPosition.x, 0, GameState.playerPosition.z);
    scene.add(playerGroup);
    return playerGroup;
}

function createChickenModel(group, colors) {
    // CROSSY ROAD STYLE - Blocky voxel chicken
    const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.8, metalness: 0, flatShading: true });

    // Chunky cubic body
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.4), bodyMat);
    body.position.y = 0.32;
    body.castShadow = true;
    group.add(body);

    // Blocky head - slightly smaller
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.38, 0.38), bodyMat);
    head.position.y = 0.74;
    head.castShadow = true;
    group.add(head);

    // Red comb - 3 blocky bumps
    const combMat = new THREE.MeshStandardMaterial({ color: 0xff2222, roughness: 0.7, flatShading: true });
    const comb1 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 0.1), combMat);
    comb1.position.set(0, 0.99, -0.06);
    group.add(comb1);
    const comb2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.1), combMat);
    comb2.position.set(0, 1.01, 0.04);
    group.add(comb2);
    const comb3 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.1), combMat);
    comb3.position.set(0, 0.98, 0.12);
    group.add(comb3);

    // Wattle
    const wattle = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.08), combMat);
    wattle.position.set(0, 0.52, 0.2);
    group.add(wattle);

    // Orange beak - simple wedge
    const beakMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.6, flatShading: true });
    const beak = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.14), beakMat);
    beak.position.set(0, 0.68, 0.25);
    group.add(beak);

    // Simple black dot eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    [-0.11, 0.11].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.04), eyeMat);
        eye.position.set(x, 0.78, 0.2);
        group.add(eye);
    });

    // Tiny wing bumps
    const wingMat = new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.8, flatShading: true });
    [-0.28, 0.28].forEach(x => {
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.2), wingMat);
        wing.position.set(x, 0.32, 0);
        group.add(wing);
    });

    // Blocky feet
    const footMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.6, flatShading: true });
    [-0.12, 0.12].forEach(x => {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.16), footMat);
        foot.position.set(x, 0.05, 0.04);
        group.add(foot);
    });
}

function createBananaManModel(group, colors) {
    // CROSSY ROAD STYLE - Man in a blocky banana costume
    const bananaMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.8, metalness: 0, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.7, flatShading: true });
    const brownMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.7, flatShading: true });

    // Banana costume body - curved shape made of stacked boxes
    const bodyBottom = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.2, 0.24), bananaMat);
    bodyBottom.position.y = 0.12;
    bodyBottom.castShadow = true;
    group.add(bodyBottom);

    const bodyLower = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.28), bananaMat);
    bodyLower.position.y = 0.32;
    bodyLower.castShadow = true;
    group.add(bodyLower);

    const bodyMid = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.24, 0.3), bananaMat);
    bodyMid.position.y = 0.54;
    bodyMid.castShadow = true;
    group.add(bodyMid);

    const bodyUpper = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.28), bananaMat);
    bodyUpper.position.y = 0.74;
    bodyUpper.castShadow = true;
    group.add(bodyUpper);

    const bodyTop = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.16, 0.22), bananaMat);
    bodyTop.position.y = 0.9;
    bodyTop.castShadow = true;
    group.add(bodyTop);

    // Banana stem on top
    const stem = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), brownMat);
    stem.position.set(0, 1.04, 0);
    group.add(stem);

    // Human face poking through - blocky head
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.12), skinMat);
    face.position.set(0, 0.62, 0.2);
    group.add(face);

    // Simple black dot eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    [-0.06, 0.06].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.04), eyeMat);
        eye.position.set(x, 0.65, 0.27);
        group.add(eye);
    });

    // Happy smile
    const smile = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.04), new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true }));
    smile.position.set(0, 0.56, 0.27);
    group.add(smile);

    // Human arms sticking out of banana costume
    [-0.24, 0.24].forEach((x, i) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.18, 0.1), skinMat);
        arm.position.set(x, 0.45, 0.05);
        arm.rotation.z = i === 0 ? 0.4 : -0.4;
        group.add(arm);
    });

    // Human legs/feet at bottom
    [-0.1, 0.1].forEach(x => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.1), new THREE.MeshStandardMaterial({ color: 0x333344, flatShading: true }));
        leg.position.set(x, 0.04, 0.04);
        group.add(leg);
    });

    // Shoes
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });
    [-0.1, 0.1].forEach(x => {
        const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.14), shoeMat);
        shoe.position.set(x, 0.01, 0.06);
        group.add(shoe);
    });
}

function createSkierModel(group, colors) {
    // CROSSY ROAD STYLE - Blocky voxel skier
    const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.8, metalness: 0, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.7, flatShading: true });

    // Chunky body (ski jacket)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.4, 0.32), bodyMat);
    body.position.y = 0.35;
    body.castShadow = true;
    group.add(body);

    // Blocky head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.32), skinMat);
    head.position.y = 0.72;
    head.castShadow = true;
    group.add(head);

    // Blocky beanie hat
    const hatMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.7, flatShading: true });
    const hat = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.34), hatMat);
    hat.position.set(0, 0.95, 0);
    group.add(hat);

    // Pom pom - small cube
    const pomPom = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true }));
    pomPom.position.set(0, 1.08, 0);
    group.add(pomPom);

    // Ski goggles - simple bar
    const goggleMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.5, flatShading: true });
    const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.08), goggleMat);
    goggles.position.set(0, 0.75, 0.17);
    group.add(goggles);

    // Dark goggle lenses
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });
    [-0.08, 0.08].forEach(x => {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.04), lensMat);
        lens.position.set(x, 0.75, 0.22);
        group.add(lens);
    });

    // Blocky arms
    [-0.28, 0.28].forEach((x, i) => {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.1), bodyMat);
        arm.position.set(x, 0.32, 0);
        arm.rotation.z = i === 0 ? 0.25 : -0.25;
        group.add(arm);
    });

    // Ski poles - thin boxes
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5, flatShading: true });
    [-0.35, 0.35].forEach(x => {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.7, 0.04), poleMat);
        pole.position.set(x, 0.35, 0.08);
        pole.rotation.x = 0.15;
        group.add(pole);
    });

    // Blocky legs (dark pants)
    const legMat = new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.8, flatShading: true });
    [-0.1, 0.1].forEach(x => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), legMat);
        leg.position.set(x, 0.08, 0);
        group.add(leg);
    });

    // Blocky skis
    const skiMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.6, flatShading: true });
    [-0.14, 0.14].forEach(x => {
        const ski = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.6), skiMat);
        ski.position.set(x, 0.02, 0.08);
        group.add(ski);
        // Ski tip - angled cube
        const tip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.1), skiMat);
        tip.position.set(x, 0.05, 0.35);
        tip.rotation.x = -0.4;
        group.add(tip);
    });
}

function createTurtleModel(group, colors) {
    // CROSSY ROAD STYLE - Blocky voxel turtle
    const shellMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.8, metalness: 0, flatShading: true });
    const skinMat = new THREE.MeshStandardMaterial({ color: colors.secondary, roughness: 0.7, flatShading: true });
    const bellyMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.7, flatShading: true });

    // Shell - stacked boxes for dome effect
    const shellBase = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.5), shellMat);
    shellBase.position.y = 0.15;
    shellBase.castShadow = true;
    group.add(shellBase);

    const shellMid = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.14, 0.44), shellMat);
    shellMid.position.y = 0.29;
    shellMid.castShadow = true;
    group.add(shellMid);

    const shellTop = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.34), shellMat);
    shellTop.position.y = 0.42;
    shellTop.castShadow = true;
    group.add(shellTop);

    // Shell pattern - darker cubes on top
    const patternMat = new THREE.MeshStandardMaterial({ color: 0x1a5c3a, roughness: 0.7, flatShading: true });
    const patternPositions = [
        { x: 0, y: 0.49, z: 0 },
        { x: 0.12, y: 0.36, z: 0.1 }, { x: -0.12, y: 0.36, z: 0.1 },
        { x: 0.12, y: 0.36, z: -0.1 }, { x: -0.12, y: 0.36, z: -0.1 }
    ];
    patternPositions.forEach(pos => {
        const segment = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.12), patternMat);
        segment.position.set(pos.x, pos.y, pos.z);
        group.add(segment);
    });

    // Belly - flat box underneath
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.45), bellyMat);
    belly.position.y = 0.05;
    group.add(belly);

    // Blocky head
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.2, 0.22), skinMat);
    head.position.set(0, 0.25, 0.35);
    head.castShadow = true;
    group.add(head);

    // Simple black dot eyes
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    [-0.05, 0.05].forEach(x => {
        const eye = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.04), eyeMat);
        eye.position.set(x, 0.3, 0.47);
        group.add(eye);
    });

    // Blocky legs
    const legPositions = [
        { x: -0.26, z: 0.14 }, { x: 0.26, z: 0.14 },
        { x: -0.24, z: -0.14 }, { x: 0.24, z: -0.14 }
    ];
    legPositions.forEach(pos => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.16), skinMat);
        leg.position.set(pos.x, 0.05, pos.z);
        group.add(leg);
    });

    // Blocky tail
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.12), skinMat);
    tail.position.set(0, 0.1, -0.32);
    group.add(tail);
}

function createDeloreanModel(group, colors) {
    // DeLorean DMC-12 from Back to the Future - blocky voxel style
    const bodyMat = new THREE.MeshStandardMaterial({ color: colors.body, roughness: 0.3, metalness: 0.8, flatShading: true });
    const glowMat = new THREE.MeshStandardMaterial({ color: colors.accent, roughness: 0.2, metalness: 0.5, emissive: colors.accent, emissiveIntensity: 0.5, flatShading: true });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.2, metalness: 0.3, flatShading: true });

    // Main body - lower section
    const bodyLower = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.8), bodyMat);
    bodyLower.position.y = 0.12;
    bodyLower.castShadow = true;
    group.add(bodyLower);

    // Hood (front)
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.06, 0.25), bodyMat);
    hood.position.set(0, 0.2, 0.28);
    hood.castShadow = true;
    group.add(hood);

    // Trunk (back)
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.2), bodyMat);
    trunk.position.set(0, 0.2, -0.3);
    trunk.castShadow = true;
    group.add(trunk);

    // Cabin
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.14, 0.32), bodyMat);
    cabin.position.set(0, 0.3, 0);
    cabin.castShadow = true;
    group.add(cabin);

    // Windows
    const windowFront = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.02), windowMat);
    windowFront.position.set(0, 0.32, 0.16);
    group.add(windowFront);

    const windowBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.1, 0.02), windowMat);
    windowBack.position.set(0, 0.32, -0.16);
    group.add(windowBack);

    // Side windows
    [-0.24, 0.24].forEach(x => {
        const sideWindow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.1, 0.26), windowMat);
        sideWindow.position.set(x, 0.32, 0);
        group.add(sideWindow);
    });

    // Wheels
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, flatShading: true });
    const wheelPositions = [
        { x: -0.22, z: 0.24 }, { x: 0.22, z: 0.24 },
        { x: -0.22, z: -0.24 }, { x: 0.22, z: -0.24 }
    ];
    wheelPositions.forEach(pos => {
        const wheel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.14), wheelMat);
        wheel.position.set(pos.x, 0.07, pos.z);
        group.add(wheel);
    });

    // Flux capacitor glow strips on sides
    [-0.26, 0.26].forEach(x => {
        const glowStrip = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.04, 0.5), glowMat);
        glowStrip.position.set(x, 0.16, 0);
        group.add(glowStrip);
    });

    // Time circuit display on back
    const timeCircuit = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.02), glowMat);
    timeCircuit.position.set(0, 0.24, -0.41);
    group.add(timeCircuit);

    // Headlights
    const headlightMat = new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffee, emissiveIntensity: 0.3, flatShading: true });
    [-0.16, 0.16].forEach(x => {
        const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), headlightMat);
        headlight.position.set(x, 0.14, 0.41);
        group.add(headlight);
    });

    // Taillights (red glow)
    const taillightMat = new THREE.MeshStandardMaterial({ color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 0.3, flatShading: true });
    [-0.16, 0.16].forEach(x => {
        const taillight = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 0.02), taillightMat);
        taillight.position.set(x, 0.14, -0.41);
        group.add(taillight);
    });

    // DMC logo placeholder on back
    const logoMat = new THREE.MeshStandardMaterial({ color: 0x888888, flatShading: true });
    const logo = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.01), logoMat);
    logo.position.set(0, 0.16, -0.41);
    group.add(logo);
}

// ============================================
// TILE GRID SYSTEM
// ============================================
function createTileGrid() {
    tilesMeshes.forEach(row => {
        if (Array.isArray(row)) row.forEach(tile => scene.remove(tile));
    });
    tilesMeshes = [];
    GameState.tiles = [];

    const tileSize = CONFIG.GRID.TILE_SIZE - CONFIG.GRID.TILE_GAP;

    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        tilesMeshes[x] = [];
        GameState.tiles[x] = [];

        for (let z = 0; z < CONFIG.GRID.HEIGHT; z++) {
            const geometry = new THREE.BoxGeometry(tileSize, 0.3, tileSize);
            const material = new THREE.MeshStandardMaterial({
                color: CONFIG.COLORS.TILE_DEFAULT,
                roughness: 0.5,
                metalness: 0.1,
                emissive: 0x111118,
                emissiveIntensity: 0.1
            });

            const tile = new THREE.Mesh(geometry, material);
            tile.position.set(x, 0, z);
            tile.receiveShadow = true;
            tile.castShadow = true;
            tile.userData = { x, z, state: 'default' };

            scene.add(tile);
            tilesMeshes[x][z] = tile;
            GameState.tiles[x][z] = 'default';
        }
    }

    // Floor base
    const floorGeometry = new THREE.PlaneGeometry(CONFIG.GRID.WIDTH + 6, CONFIG.GRID.HEIGHT + 6);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x050510, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(CONFIG.GRID.WIDTH / 2 - 0.5, -0.2, CONFIG.GRID.HEIGHT / 2 - 0.5);
    floor.receiveShadow = true;
    scene.add(floor);
}

function setTileState(x, z, state) {
    if (x < 0 || x >= CONFIG.GRID.WIDTH || z < 0 || z >= CONFIG.GRID.HEIGHT) return;

    const tile = tilesMeshes[x][z];
    const material = tile.material;

    GameState.tiles[x][z] = state;
    tile.userData.state = state;

    switch (state) {
        case 'safe_island':
            material.color.setHex(CONFIG.COLORS.TILE_SAFE_ISLAND);
            material.emissive.setHex(CONFIG.COLORS.TILE_SAFE_ISLAND);
            material.emissiveIntensity = 0.4;
            tile.position.y = 0.05;
            break;
        case 'lava':
            material.color.setHex(CONFIG.COLORS.TILE_LAVA);
            material.emissive.setHex(CONFIG.COLORS.TILE_LAVA);
            material.emissiveIntensity = 0.8;
            tile.position.y = 0.12;
            break;
        case 'collectible':
            material.color.setHex(CONFIG.COLORS.TILE_COLLECTIBLE);
            material.emissive.setHex(CONFIG.COLORS.TILE_COLLECTIBLE);
            material.emissiveIntensity = 0.6;
            tile.position.y = 0.02;
            break;
        case 'countdown':
            material.color.setHex(CONFIG.COLORS.TILE_COUNTDOWN);
            material.emissive.setHex(CONFIG.COLORS.TILE_COUNTDOWN);
            material.emissiveIntensity = 0.9;
            tile.position.y = 0.2;
            break;
        case 'goal':
            material.color.setHex(0x00ccff);
            material.emissive.setHex(0x00ccff);
            material.emissiveIntensity = 0.7;
            tile.position.y = 0.08;
            break;
        default:
            material.color.setHex(CONFIG.COLORS.TILE_DEFAULT);
            material.emissive.setHex(0x111118);
            material.emissiveIntensity = 0.1;
            tile.position.y = 0;
    }
}

// ============================================
// COUNTDOWN SYSTEM (Only on floor tiles - NO overlay)
// ============================================
function showCountdownOnFloor(number) {
    // Clear all tiles first
    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        for (let z = 0; z < CONFIG.GRID.HEIGHT; z++) {
            setTileState(x, z, 'default');
        }
    }

    if (number === 0) return;

    const pattern = NUMBER_PATTERNS[number];
    if (!pattern) return;

    // Center the pattern on the grid
    const patternWidth = pattern[0].length;
    const patternHeight = pattern.length;
    const offsetX = Math.floor((CONFIG.GRID.WIDTH - patternWidth) / 2);
    const offsetZ = Math.floor((CONFIG.GRID.HEIGHT - patternHeight) / 2);

    for (let pz = 0; pz < patternHeight; pz++) {
        for (let px = 0; px < patternWidth; px++) {
            if (pattern[pz][px] === 1) {
                const gridX = offsetX + px;
                const gridZ = offsetZ + pz;
                if (gridX >= 0 && gridX < CONFIG.GRID.WIDTH && gridZ >= 0 && gridZ < CONFIG.GRID.HEIGHT) {
                    setTileState(gridX, gridZ, 'countdown');
                }
            }
        }
    }
}

function flashAllTilesGreen() {
    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        for (let z = 0; z < CONFIG.GRID.HEIGHT; z++) {
            setTileState(x, z, 'safe_island');
        }
    }
}

async function runCountdown() {
    GameState.isCountingDown = true;

    // On mobile, show full board during countdown
    setCameraForCountdown();

    // NO overlay - just show on floor tiles
    for (let i = 3; i >= 1; i--) {
        showCountdownOnFloor(i);
        playCountdownSound(i);
        await sleep(800);
    }

    // GO! - flash all green
    flashAllTilesGreen();
    playCountdownSound(0);
    await sleep(400);

    // Transition camera to gameplay view before starting level
    transitionCameraToGameplay();

    GameState.isCountingDown = false;
    initializeLevel();
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================
// SAFE ISLANDS (Visually pleasing patterns)
// ============================================
function generateSafeIslands() {
    GameState.safeIslands.clear();

    const level = GameState.currentLevel;

    // Special level layouts
    switch (level) {
        case 1:
        case 2:
        case 3:
            // Early levels: Corner islands + center cross - lots of safety
            createCornerIslands();
            createCenterCross();
            break;

        case 4:
            // GREEN PERIMETER LEVEL - entire edge is safe!
            setGreenPerimeter();
            break;

        case 5:
        case 6:
            // Mid levels: Diagonal stepping stones
            createDiagonalIslands();
            createCornerIslands();
            break;

        case 7:
            // PULSING LEVEL - minimal safe spots, must time your hops
            createScatteredIslands(6);
            break;

        case 8:
            // Rotating cross level - corners only
            createCornerIslands();
            break;

        case 9:
            // Spiral level - sparse diagonal stepping stones
            createDiagonalIslands();
            createScatteredIslands(4);
            break;

        case 10:
            // Fast pulsing - very few safe spots
            createScatteredIslands(5);
            break;

        case 11:
            // Complex level - minimal safety
            createCornerIslands();
            createScatteredIslands(3);
            break;

        case 12:
            // FINAL BOSS - extremely challenging, only corners
            createCornerIslands();
            break;

        default:
            createCornerIslands();
            createCenterCross();
    }

    // Always have safe starting zone
    createStartingZone();

    // Apply safe island states
    GameState.safeIslands.forEach(key => {
        const [x, z] = key.split(',').map(Number);
        setTileState(x, z, 'safe_island');
    });
}

function createCornerIslands() {
    const corners = [
        { x: 1, z: 1 }, { x: 10, z: 1 },
        { x: 1, z: 10 }, { x: 10, z: 10 }
    ];
    corners.forEach(c => {
        for (let dx = 0; dx <= 1; dx++) {
            for (let dz = 0; dz <= 1; dz++) {
                const x = c.x + dx;
                const z = c.z + dz;
                if (x >= 0 && x < CONFIG.GRID.WIDTH && z >= 0 && z < CONFIG.GRID.HEIGHT - 2) {
                    GameState.safeIslands.add(`${x},${z}`);
                }
            }
        }
    });
}

function createCenterCross() {
    const centerX = Math.floor(CONFIG.GRID.WIDTH / 2);
    const centerZ = Math.floor(CONFIG.GRID.HEIGHT / 2) - 1;

    // Horizontal line
    for (let dx = -2; dx <= 2; dx++) {
        const x = centerX + dx;
        if (x >= 0 && x < CONFIG.GRID.WIDTH) {
            GameState.safeIslands.add(`${x},${centerZ}`);
        }
    }
    // Vertical line
    for (let dz = -2; dz <= 2; dz++) {
        const z = centerZ + dz;
        if (z >= 0 && z < CONFIG.GRID.HEIGHT - 2) {
            GameState.safeIslands.add(`${centerX},${z}`);
        }
    }
}

function createDiagonalIslands() {
    // Create stepping stone diagonal pattern
    for (let i = 0; i < 4; i++) {
        const x = 2 + i * 3;
        const z = 2 + i * 2;
        if (x < CONFIG.GRID.WIDTH && z < CONFIG.GRID.HEIGHT - 2) {
            GameState.safeIslands.add(`${x},${z}`);
            if (x + 1 < CONFIG.GRID.WIDTH) GameState.safeIslands.add(`${x + 1},${z}`);
        }
    }
}

function createScatteredIslands(count) {
    const placed = new Set();
    for (let i = 0; i < count; i++) {
        let x, z, attempts = 0;
        do {
            x = 1 + Math.floor(Math.random() * (CONFIG.GRID.WIDTH - 2));
            z = 1 + Math.floor(Math.random() * (CONFIG.GRID.HEIGHT - 5));
            attempts++;
        } while (placed.has(`${x},${z}`) && attempts < 50);

        placed.add(`${x},${z}`);
        GameState.safeIslands.add(`${x},${z}`);
    }
}

function createStartingZone() {
    // 3x3 safe zone at player start position
    for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
            const x = 6 + dx;
            const z = 14 + dz;
            if (x >= 0 && x < CONFIG.GRID.WIDTH && z >= 0 && z < CONFIG.GRID.HEIGHT) {
                GameState.safeIslands.add(`${x},${z}`);
            }
        }
    }
}

// ============================================
// COLLECTIBLES (Blue Tiles) - Collect all to complete level
// ============================================
function spawnCollectibles() {
    GameState.collectibleTiles.clear();

    const numCollectibles = CONFIG.LEVELS.POINTS_PER_LEVEL[GameState.currentLevel - 1];

    let attempts = 0;
    while (GameState.collectibleTiles.size < numCollectibles && attempts < 300) {
        const x = Math.floor(Math.random() * CONFIG.GRID.WIDTH);
        const z = Math.floor(Math.random() * (CONFIG.GRID.HEIGHT - 3));
        const key = `${x},${z}`;

        // Don't place on safe islands or player start zone
        if (!GameState.safeIslands.has(key) && !GameState.collectibleTiles.has(key) &&
            !(x >= 5 && x <= 7 && z >= 13 && z <= 15)) {
            GameState.collectibleTiles.add(key);
            setTileState(x, z, 'collectible');
        }
        attempts++;
    }
}

function collectItem(x, z) {
    const key = `${x},${z}`;
    if (GameState.collectibleTiles.has(key)) {
        GameState.collectibleTiles.delete(key);

        // Turn tile gray (collected)
        setTileState(x, z, 'default');
        playCollectSound();
        updateHUD();

        // Check if all collectibles collected - award time-based score
        if (GameState.collectibleTiles.size === 0) {
            const earnedScore = Math.max(1, GameState.currentLevelScore);
            GameState.totalScore += earnedScore;
            showScorePopup(x, z, earnedScore);
            setTimeout(() => levelComplete(), 300);
        }
    }
}

function showScorePopup(x, z, points) {
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.textContent = `+${points}`;

    const vector = new THREE.Vector3(x, 1.5, z);
    vector.project(camera);

    popup.style.left = (vector.x * window.innerWidth / 2 + window.innerWidth / 2) + 'px';
    popup.style.top = (-vector.y * window.innerHeight / 2 + window.innerHeight / 2) + 'px';

    document.getElementById('game-container').appendChild(popup);
    setTimeout(() => popup.remove(), 1000);
}

// ============================================
// LAVA PATTERNS (Predictable, Creative, Progressive)
// ============================================

// Standard red floor pattern - creates consistent visual rhythm
function addStandardRedFloor(speed = 1.0) {
    // Checkerboard pulse pattern - always visible, predictable timing
    GameState.lavaPatterns.push({
        type: 'checkerboard_pulse',
        phase: 0,
        speed: speed,
        interval: 1500 // ms between pulses
    });
}

// Pulsing gray tiles - all gray tiles pulse red on/off
function addPulsingGrayTiles(interval = 800) {
    GameState.lavaPatterns.push({
        type: 'gray_pulse',
        interval: interval,
        phase: 0
    });
}

// Green perimeter - entire outside edge is safe
function setGreenPerimeter() {
    // Top row
    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        GameState.safeIslands.add(`${x},0`);
    }
    // Bottom row (except last 2 rows for player)
    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        GameState.safeIslands.add(`${x},${CONFIG.GRID.HEIGHT - 3}`);
    }
    // Left column
    for (let z = 0; z < CONFIG.GRID.HEIGHT - 2; z++) {
        GameState.safeIslands.add(`0,${z}`);
    }
    // Right column
    for (let z = 0; z < CONFIG.GRID.HEIGHT - 2; z++) {
        GameState.safeIslands.add(`${CONFIG.GRID.WIDTH - 1},${z}`);
    }
}

// Diagonal lines pattern - predictable sweeping
function addDiagonalSweep(direction = 1, speed = 0.8) {
    GameState.lavaPatterns.push({
        type: 'diagonal_sweep',
        direction: direction,
        width: 2,
        speed: speed,
        offset: 0
    });
}

// Row march - rows light up one at a time, march across
function addRowMarch(speed = 1.0) {
    GameState.lavaPatterns.push({
        type: 'row_march',
        currentRow: 0,
        speed: speed,
        width: 2
    });
}

// Column march - columns light up, sweep left to right
function addColumnMarch(speed = 1.0) {
    GameState.lavaPatterns.push({
        type: 'column_march',
        currentCol: 0,
        speed: speed,
        width: 2
    });
}

// Cross pattern - predictable X shape that rotates
function addRotatingCross(speed = 0.5) {
    GameState.lavaPatterns.push({
        type: 'rotating_cross',
        angle: 0,
        speed: speed,
        armLength: 5
    });
}

// Spiral inward pattern
function addSpiralPattern(speed = 0.6) {
    GameState.lavaPatterns.push({
        type: 'spiral',
        progress: 0,
        speed: speed,
        direction: 1
    });
}

// Rolling X pattern - multiple X shapes that sweep down the board
function addRollingX(count = 3, speed = 0.8, spacing = 5) {
    for (let i = 0; i < count; i++) {
        GameState.lavaPatterns.push({
            type: 'rolling_x',
            offset: i * spacing,
            speed: speed,
            size: 3
        });
    }
}

function generateLavaPatterns() {
    GameState.lavaPatterns = [];
    const level = GameState.currentLevel;

    // Each level has specific, readable patterns with increasing complexity
    switch (level) {
        case 1:
            // INTRO: Simple horizontal bars only - learn the basics
            addHorizontalBar(4, 3, 1, 0.5);
            addHorizontalBar(9, 3, -1, 0.5);
            break;

        case 2:
            // Learn vertical movement
            addHorizontalBar(3, 3, 1, 0.6);
            addHorizontalBar(10, 3, -1, 0.6);
            addVerticalBar(5, 3, 1, 0.5);
            break;

        case 3:
            // Grid pattern - horizontal + vertical crossing
            addHorizontalBar(3, 4, 1, 0.7);
            addHorizontalBar(8, 4, -1, 0.7);
            addVerticalBar(3, 4, 1, 0.6);
            addVerticalBar(8, 4, -1, 0.6);
            break;

        case 4:
            // ROLLING X LEVEL - multiple X patterns sweeping down the board
            // This level uses green perimeter (set in generateSafeIslands)
            addRollingX(3, 0.6, 6); // 3 X patterns, spaced 6 apart
            break;

        case 5:
            // Row march introduction - very predictable
            addRowMarch(0.8);
            addHorizontalBar(5, 3, 1, 0.8);
            break;

        case 6:
            // Column + row march combo
            addRowMarch(0.9);
            addColumnMarch(0.7);
            break;

        case 7:
            // PULSING GRAY LEVEL - no moving red, all grays pulse on/off
            // Slower pulse to give player time to move
            addPulsingGrayTiles(2400);
            break;

        case 8:
            // Rotating cross pattern - slower rotation for readability
            addRotatingCross(0.3);
            addHorizontalBar(2, 2, 1, 0.7);
            addHorizontalBar(10, 2, -1, 0.7);
            break;

        case 9:
            // GREEN PERIMETER + patterns - slower for fairness
            addSpiralPattern(0.4);
            addVerticalBar(4, 2, 1, 0.7);
            addVerticalBar(7, 2, -1, 0.7);
            break;

        case 10:
            // FASTER PULSING - gray tiles pulse, challenging but fair
            addPulsingGrayTiles(1600);
            addHorizontalBar(3, 2, 1, 0.7);
            addHorizontalBar(9, 2, -1, 0.7);
            break;

        case 11:
            // Complex but predictable - fewer overlapping patterns
            addRowMarch(0.7);
            addColumnMarch(0.5);
            addHorizontalBar(5, 2, 1, 0.8);
            break;

        case 12:
            // FINAL BOSS - intense but readable patterns, slightly slower for fairness
            addRotatingCross(0.35);
            addDiagonalSweep(1, 0.6);
            addHorizontalBar(2, 2, 1, 0.8);
            addHorizontalBar(10, 2, -1, 0.8);
            addVerticalBar(3, 2, 1, 0.7);
            addVerticalBar(8, 2, -1, 0.7);
            break;
    }
}

function addHorizontalBar(row, width, direction, speed) {
    GameState.lavaPatterns.push({
        type: 'horizontal',
        row: Math.min(row, CONFIG.GRID.HEIGHT - 4),
        width: width,
        direction: direction,
        offset: Math.random() * CONFIG.GRID.WIDTH,
        speed: speed
    });
}

function addVerticalBar(col, height, direction, speed) {
    GameState.lavaPatterns.push({
        type: 'vertical',
        col: Math.min(col, CONFIG.GRID.WIDTH - 1),
        height: height,
        direction: direction,
        offset: Math.random() * CONFIG.GRID.HEIGHT,
        speed: speed
    });
}

function addWavePattern(speed) {
    GameState.lavaPatterns.push({
        type: 'wave',
        amplitude: 2.5,
        frequency: 0.4,
        width: 2,
        offset: 0,
        speed: speed
    });
}

function addExpandingRing(speed) {
    GameState.lavaPatterns.push({
        type: 'ring',
        centerX: Math.floor(CONFIG.GRID.WIDTH / 2),
        centerZ: Math.floor(CONFIG.GRID.HEIGHT / 2) - 2,
        maxRadius: 6,
        speed: speed
    });
}

function addSnakePattern(length, moveSpeed) {
    GameState.lavaPatterns.push({
        type: 'snake',
        positions: [],
        headX: Math.floor(CONFIG.GRID.WIDTH / 2),
        headZ: Math.floor(CONFIG.GRID.HEIGHT / 2),
        direction: 0,
        length: length,
        lastMoveTime: 0,
        speed: moveSpeed
    });
}

function addBlinkingTiles(count, interval) {
    const positions = [];
    for (let i = 0; i < count; i++) {
        positions.push({
            x: Math.floor(Math.random() * CONFIG.GRID.WIDTH),
            z: Math.floor(Math.random() * (CONFIG.GRID.HEIGHT - 4)),
            phase: Math.random() * Math.PI * 2
        });
    }
    GameState.lavaPatterns.push({
        type: 'blinker',
        positions: positions,
        interval: interval
    });
}

function updateLavaPatterns(deltaTime) {
    // Clear previous lava
    GameState.lavaTiles.forEach(key => {
        const [x, z] = key.split(',').map(Number);
        // Don't reset safe islands or collectibles
        if (!GameState.safeIslands.has(key) && !GameState.collectibleTiles.has(key)) {
            setTileState(x, z, 'default');
        }
    });
    GameState.lavaTiles.clear();

    const time = Date.now();
    const baseSpeed = CONFIG.LEVELS.BASE_SPEED - (GameState.currentLevel - 1) * CONFIG.LEVELS.SPEED_DECREASE;

    GameState.lavaPatterns.forEach(pattern => {
        switch (pattern.type) {
            case 'horizontal': updateHorizontalPattern(pattern, time, baseSpeed); break;
            case 'vertical': updateVerticalPattern(pattern, time, baseSpeed); break;
            case 'wave': updateWavePattern(pattern, time, baseSpeed); break;
            case 'ring': updateRingPattern(pattern, time); break;
            case 'snake': updateSnakePattern(pattern, time); break;
            case 'blinker': updateBlinkerPattern(pattern, time); break;
            case 'diagonal_sweep': updateDiagonalSweep(pattern, time, baseSpeed); break;
            case 'row_march': updateRowMarch(pattern, time, baseSpeed); break;
            case 'column_march': updateColumnMarch(pattern, time, baseSpeed); break;
            case 'rotating_cross': updateRotatingCross(pattern, time); break;
            case 'spiral': updateSpiralPattern(pattern, time); break;
            case 'gray_pulse': updateGrayPulse(pattern, time); break;
            case 'checkerboard_pulse': updateCheckerboardPulse(pattern, time); break;
            case 'rolling_x': updateRollingX(pattern, time, baseSpeed); break;
        }
    });

    // Apply lava states (but not on safe islands or collectibles)
    GameState.lavaTiles.forEach(key => {
        const [x, z] = key.split(',').map(Number);
        // Don't put lava on safe islands or collectibles
        if (!GameState.safeIslands.has(key) && !GameState.collectibleTiles.has(key)) {
            setTileState(x, z, 'lava');
        }
    });

    checkLavaCollision();
}

function updateHorizontalPattern(pattern, time, baseSpeed) {
    const progress = (time / baseSpeed) * pattern.speed;
    const currentPos = (progress + pattern.offset) % (CONFIG.GRID.WIDTH + pattern.width);

    for (let i = 0; i < pattern.width; i++) {
        let x;
        if (pattern.direction > 0) {
            x = Math.floor(currentPos + i) % CONFIG.GRID.WIDTH;
        } else {
            x = CONFIG.GRID.WIDTH - 1 - (Math.floor(currentPos + i) % CONFIG.GRID.WIDTH);
        }

        if (x >= 0 && x < CONFIG.GRID.WIDTH) {
            GameState.lavaTiles.add(`${x},${pattern.row}`);
        }
    }
}

function updateVerticalPattern(pattern, time, baseSpeed) {
    const progress = (time / baseSpeed) * pattern.speed;
    const currentPos = (progress + pattern.offset) % (CONFIG.GRID.HEIGHT + pattern.height);

    for (let i = 0; i < pattern.height; i++) {
        let z;
        if (pattern.direction > 0) {
            z = Math.floor(currentPos + i) % (CONFIG.GRID.HEIGHT - 2);
        } else {
            z = (CONFIG.GRID.HEIGHT - 3) - (Math.floor(currentPos + i) % (CONFIG.GRID.HEIGHT - 2));
        }

        if (z >= 0 && z < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${pattern.col},${z}`);
        }
    }
}

function updateWavePattern(pattern, time, baseSpeed) {
    const progress = (time / baseSpeed) * pattern.speed;

    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        const z = Math.floor(
            (CONFIG.GRID.HEIGHT / 2 - 2) +
            Math.sin((x * pattern.frequency) + progress) * pattern.amplitude
        );

        for (let w = 0; w < pattern.width; w++) {
            const wz = z + w;
            if (wz >= 0 && wz < CONFIG.GRID.HEIGHT - 2) {
                GameState.lavaTiles.add(`${x},${wz}`);
            }
        }
    }
}

function updateRingPattern(pattern, time) {
    const progress = (time / 2000) * pattern.speed;
    const currentRadius = (progress % pattern.maxRadius);

    // Draw ring outline
    for (let angle = 0; angle < Math.PI * 2; angle += 0.15) {
        const x = Math.round(pattern.centerX + Math.cos(angle) * currentRadius);
        const z = Math.round(pattern.centerZ + Math.sin(angle) * currentRadius);

        if (x >= 0 && x < CONFIG.GRID.WIDTH && z >= 0 && z < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${x},${z}`);
        }
    }
}

function updateSnakePattern(pattern, time) {
    if (time - pattern.lastMoveTime > pattern.speed) {
        pattern.lastMoveTime = time;

        // Random direction changes (not chasing player - more predictable)
        if (Math.random() < 0.15) {
            pattern.direction = (pattern.direction + (Math.random() > 0.5 ? 1 : 3)) % 4;
        }

        const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
        const [dx, dz] = dirs[pattern.direction];

        let newX = pattern.headX + dx;
        let newZ = pattern.headZ + dz;

        // Bounce off walls
        if (newX < 0 || newX >= CONFIG.GRID.WIDTH) {
            pattern.direction = (pattern.direction + 2) % 4;
            newX = pattern.headX;
        }
        if (newZ < 0 || newZ >= CONFIG.GRID.HEIGHT - 2) {
            pattern.direction = (pattern.direction + 2) % 4;
            newZ = pattern.headZ;
        }

        pattern.positions.unshift({ x: newX, z: newZ });
        pattern.headX = newX;
        pattern.headZ = newZ;

        while (pattern.positions.length > pattern.length) {
            pattern.positions.pop();
        }
    }

    pattern.positions.forEach(pos => {
        if (pos.z < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${pos.x},${pos.z}`);
        }
    });
}

function updateBlinkerPattern(pattern, time) {
    pattern.positions.forEach(pos => {
        if (pos.z < CONFIG.GRID.HEIGHT - 2) {
            const blinkValue = Math.sin((time / pattern.interval) + pos.phase);
            if (blinkValue > 0.3) {
                GameState.lavaTiles.add(`${pos.x},${pos.z}`);
            }
        }
    });
}

// Diagonal sweep - lava sweeps diagonally across the grid
function updateDiagonalSweep(pattern, time, baseSpeed) {
    const progress = (time / baseSpeed) * pattern.speed;
    const totalDiagonals = CONFIG.GRID.WIDTH + CONFIG.GRID.HEIGHT;
    const currentDiag = Math.floor(progress) % totalDiagonals;

    for (let w = 0; w < pattern.width; w++) {
        const diagIndex = (currentDiag + w) % totalDiagonals;

        // Draw diagonal line
        for (let i = 0; i <= diagIndex; i++) {
            let x, z;
            if (pattern.direction > 0) {
                x = i;
                z = diagIndex - i;
            } else {
                x = CONFIG.GRID.WIDTH - 1 - i;
                z = diagIndex - i;
            }

            if (x >= 0 && x < CONFIG.GRID.WIDTH && z >= 0 && z < CONFIG.GRID.HEIGHT - 2) {
                GameState.lavaTiles.add(`${x},${z}`);
            }
        }
    }
}

// Row march - rows of lava march from top to bottom
function updateRowMarch(pattern, time, baseSpeed) {
    const progress = (time / (baseSpeed * 1.5)) * pattern.speed;
    const currentRow = Math.floor(progress) % (CONFIG.GRID.HEIGHT - 2);

    for (let w = 0; w < pattern.width; w++) {
        const row = (currentRow + w) % (CONFIG.GRID.HEIGHT - 2);
        for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
            GameState.lavaTiles.add(`${x},${row}`);
        }
    }
}

// Column march - columns of lava sweep left to right
function updateColumnMarch(pattern, time, baseSpeed) {
    const progress = (time / (baseSpeed * 1.2)) * pattern.speed;
    const currentCol = Math.floor(progress) % CONFIG.GRID.WIDTH;

    for (let w = 0; w < pattern.width; w++) {
        const col = (currentCol + w) % CONFIG.GRID.WIDTH;
        for (let z = 0; z < CONFIG.GRID.HEIGHT - 2; z++) {
            GameState.lavaTiles.add(`${col},${z}`);
        }
    }
}

// Rotating cross - X pattern that rotates around center
function updateRotatingCross(pattern, time) {
    const centerX = Math.floor(CONFIG.GRID.WIDTH / 2);
    const centerZ = Math.floor((CONFIG.GRID.HEIGHT - 2) / 2);
    const angle = (time / 3000) * pattern.speed * Math.PI * 2;

    // Draw two arms of the cross
    for (let i = -pattern.armLength; i <= pattern.armLength; i++) {
        // First arm
        const x1 = Math.round(centerX + Math.cos(angle) * i);
        const z1 = Math.round(centerZ + Math.sin(angle) * i);
        if (x1 >= 0 && x1 < CONFIG.GRID.WIDTH && z1 >= 0 && z1 < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${x1},${z1}`);
        }

        // Second arm (perpendicular)
        const x2 = Math.round(centerX + Math.cos(angle + Math.PI / 2) * i);
        const z2 = Math.round(centerZ + Math.sin(angle + Math.PI / 2) * i);
        if (x2 >= 0 && x2 < CONFIG.GRID.WIDTH && z2 >= 0 && z2 < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${x2},${z2}`);
        }
    }
}

// Spiral pattern - lava spirals outward from center
function updateSpiralPattern(pattern, time) {
    const centerX = Math.floor(CONFIG.GRID.WIDTH / 2);
    const centerZ = Math.floor((CONFIG.GRID.HEIGHT - 2) / 2);
    const progress = (time / 2000) * pattern.speed;

    // Draw spiral arm
    for (let t = 0; t < 20; t++) {
        const angle = progress + t * 0.3;
        const radius = t * 0.4;
        const x = Math.round(centerX + Math.cos(angle) * radius);
        const z = Math.round(centerZ + Math.sin(angle) * radius);

        if (x >= 0 && x < CONFIG.GRID.WIDTH && z >= 0 && z < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${x},${z}`);
        }
    }
}

// Rolling X pattern - X shapes that roll down the board
function updateRollingX(pattern, time, baseSpeed) {
    const progress = (time / baseSpeed) * pattern.speed;
    const totalHeight = CONFIG.GRID.HEIGHT + pattern.size * 2;
    const currentZ = ((progress + pattern.offset) % totalHeight) - pattern.size;

    const centerX = Math.floor(CONFIG.GRID.WIDTH / 2);
    const size = pattern.size;

    // Draw X shape - two diagonals crossing
    for (let i = -size; i <= size; i++) {
        // First diagonal: goes from top-left to bottom-right
        const z1 = Math.floor(currentZ + i);
        const x1 = centerX + i;
        if (x1 >= 0 && x1 < CONFIG.GRID.WIDTH && z1 >= 0 && z1 < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${x1},${z1}`);
        }

        // Second diagonal: goes from top-right to bottom-left (crossing)
        const z2 = Math.floor(currentZ + i);
        const x2 = centerX - i;
        if (x2 >= 0 && x2 < CONFIG.GRID.WIDTH && z2 >= 0 && z2 < CONFIG.GRID.HEIGHT - 2) {
            GameState.lavaTiles.add(`${x2},${z2}`);
        }
    }
}

// Gray pulse - ALL non-safe, non-collectible tiles pulse red on/off
function updateGrayPulse(pattern, time) {
    const pulseOn = Math.sin(time / pattern.interval * Math.PI) > 0;

    if (pulseOn) {
        // Turn all gray tiles to lava
        for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
            for (let z = 0; z < CONFIG.GRID.HEIGHT - 2; z++) {
                const key = `${x},${z}`;
                if (!GameState.safeIslands.has(key) && !GameState.collectibleTiles.has(key)) {
                    GameState.lavaTiles.add(key);
                }
            }
        }
    }
    // When pulseOn is false, no lava tiles are added (all gray)
}

// Checkerboard pulse - alternating tiles pulse in checkerboard pattern
function updateCheckerboardPulse(pattern, time) {
    const phase = Math.floor(time / pattern.interval) % 2;

    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        for (let z = 0; z < CONFIG.GRID.HEIGHT - 2; z++) {
            const isEven = (x + z) % 2 === phase;
            if (isEven) {
                const key = `${x},${z}`;
                if (!GameState.safeIslands.has(key) && !GameState.collectibleTiles.has(key)) {
                    GameState.lavaTiles.add(key);
                }
            }
        }
    }
}

function checkLavaCollision() {
    if (GameState.isHopping || GameState.invincible || GameState.isCountingDown) return;

    const key = `${GameState.playerPosition.x},${GameState.playerPosition.z}`;

    if (GameState.safeIslands.has(key)) return;

    if (GameState.lavaTiles.has(key)) {
        playerHit();
    }
}

// ============================================
// PLAYER MOVEMENT
// ============================================
function movePlayer(dx, dz) {
    if (GameState.isHopping || GameState.isPaused || !GameState.isPlaying || GameState.isCountingDown) return;

    const newX = GameState.playerPosition.x + dx;
    const newZ = GameState.playerPosition.z + dz;

    if (newX < 0 || newX >= CONFIG.GRID.WIDTH || newZ < 0 || newZ >= CONFIG.GRID.HEIGHT) return;

    GameState.isHopping = true;
    GameState.hopStartTime = Date.now();
    GameState.hopStartPos = { x: playerMesh.position.x, y: playerMesh.position.y, z: playerMesh.position.z };
    GameState.hopEndPos = { x: newX, y: 0, z: newZ };

    // Rotation for isometric view - player faces direction of movement
    // Camera is at 45 degrees, so we rotate accordingly
    // -Math.PI/4 offset accounts for isometric camera angle
    if (dz < 0) playerMesh.rotation.y = -Math.PI / 4;           // Forward (up on board)
    else if (dz > 0) playerMesh.rotation.y = Math.PI * 3 / 4;   // Back (down on board)
    else if (dx < 0) playerMesh.rotation.y = Math.PI / 4;       // Left
    else if (dx > 0) playerMesh.rotation.y = -Math.PI * 3 / 4;  // Right

    GameState.playerPosition.x = newX;
    GameState.playerPosition.z = newZ;

    playHopSound();
}

function updateHopAnimation() {
    if (!GameState.isHopping) return;

    const elapsed = Date.now() - GameState.hopStartTime;
    const progress = Math.min(elapsed / CONFIG.PLAYER.HOP_DURATION, 1);

    const hopHeight = Math.sin(progress * Math.PI) * CONFIG.PLAYER.HOP_HEIGHT;
    const ease = progress * (2 - progress);

    playerMesh.position.x = THREE.MathUtils.lerp(GameState.hopStartPos.x, GameState.hopEndPos.x, ease);
    playerMesh.position.y = hopHeight;
    playerMesh.position.z = THREE.MathUtils.lerp(GameState.hopStartPos.z, GameState.hopEndPos.z, ease);

    // Squash and stretch for juicy feel
    const squash = 1 + Math.sin(progress * Math.PI) * 0.15;
    const stretch = 1 - Math.sin(progress * Math.PI) * 0.1;
    playerMesh.scale.set(stretch, squash, stretch);

    if (progress >= 1) {
        GameState.isHopping = false;
        playerMesh.position.set(GameState.hopEndPos.x, 0, GameState.hopEndPos.z);
        playerMesh.scale.set(1, 1, 1);
        collectItem(GameState.playerPosition.x, GameState.playerPosition.z);
        checkLavaCollision();
    }
}

// ============================================
// GAME LOGIC
// ============================================
function playerHit() {
    if (GameState.invincible) return;

    GameState.livesRemaining--;
    updateHUD();
    showDamageFlash();
    playHitSound();

    if (GameState.livesRemaining <= 0) {
        gameOver();
    } else {
        respawnPlayer();
    }
}

function respawnPlayer() {
    GameState.playerPosition = { x: 6, z: 14 };
    GameState.isHopping = false;
    playerMesh.position.set(6, 0, 14);
    playerMesh.rotation.y = 0;

    // Reset camera to follow respawned player
    resetCameraToPlayer();

    GameState.invincible = true;
    GameState.invincibleUntil = Date.now() + 2500;

    flashPlayer();
}

function flashPlayer() {
    let flashes = 0;
    const interval = setInterval(() => {
        playerMesh.visible = !playerMesh.visible;
        flashes++;
        if (flashes >= 16) {
            clearInterval(interval);
            playerMesh.visible = true;
        }
    }, 150);
}

function showDamageFlash() {
    const flash = document.createElement('div');
    flash.className = 'damage-flash';
    document.getElementById('game-container').appendChild(flash);
    setTimeout(() => flash.remove(), 300);
}

function initializeLevel() {
    for (let x = 0; x < CONFIG.GRID.WIDTH; x++) {
        for (let z = 0; z < CONFIG.GRID.HEIGHT; z++) {
            setTileState(x, z, 'default');
        }
    }

    generateSafeIslands();
    spawnCollectibles();
    generateLavaPatterns();

    // Initialize time-based scoring
    GameState.levelStartTime = Date.now();
    GameState.currentLevelScore = GameState.maxLevelScore;

    GameState.playerPosition = { x: 6, z: 14 };
    if (playerMesh) {
        playerMesh.position.set(6, 0, 14);
        playerMesh.rotation.y = 0;
    }

    // Reset camera to follow player on mobile
    resetCameraToPlayer();

    GameState.isPlaying = true;
    updateHUD();
}

function levelComplete() {
    GameState.isPlaying = false;

    if (GameState.currentLevel >= CONFIG.LEVELS.TOTAL) {
        showWinScreen();
    } else {
        showLevelCompleteScreen();
    }
}

async function nextLevel() {
    document.getElementById('level-complete-screen').classList.add('hidden');

    GameState.currentLevel++;
    GameState.livesRemaining = CONFIG.PLAYER.START_LIVES;

    GameState.lavaTiles.clear();
    GameState.collectibleTiles.clear();
    GameState.safeIslands.clear();

    updateHUD();
    showLevelTransition();

    await sleep(1000);
    await runCountdown();
}

function showLevelTransition() {
    const transition = document.createElement('div');
    transition.className = 'level-transition';
    transition.textContent = `SECTOR ${GameState.currentLevel}`;
    document.getElementById('game-container').appendChild(transition);
    setTimeout(() => transition.remove(), 1500);
}

function gameOver() {
    GameState.isPlaying = false;
    GameState.isGameOver = true;
    stopMusic();

    const maxScore = CONFIG.LEVELS.TOTAL * GameState.maxLevelScore;
    document.getElementById('final-score').textContent = `Score: ${GameState.totalScore}/${maxScore}`;
    document.getElementById('final-level').textContent = `Reached Sector: ${GameState.currentLevel}`;

    // Reset leaderboard UI for fresh submission
    if (window.resetGameOverLeaderboard) {
        window.resetGameOverLeaderboard();
    }

    document.getElementById('game-over-screen').classList.remove('hidden');
}

function showLevelCompleteScreen() {
    const earnedScore = Math.max(1, GameState.currentLevelScore);
    document.getElementById('level-score').textContent = `+${earnedScore} points!`;
    document.getElementById('level-complete-screen').classList.remove('hidden');
    playLevelCompleteChime(); // Play satisfying chime on level complete
}

function showWinScreen() {
    stopMusic();
    const maxScore = CONFIG.LEVELS.TOTAL * GameState.maxLevelScore;
    document.getElementById('win-score').textContent = `Final Score: ${GameState.totalScore}/${maxScore}`;
    document.getElementById('win-screen').classList.remove('hidden');
    playVictoryFanfare(); // Play big win sound!
}

// === VICTORY FANFARE - Big celebratory sound for winning the game ===
function playVictoryFanfare() {
    if (!audioContext) return;
    const now = audioContext.currentTime;

    // Epic ascending fanfare
    const fanfareNotes = [
        { freq: 261.63, time: 0, dur: 0.15 },      // C4
        { freq: 329.63, time: 0.15, dur: 0.15 },   // E4
        { freq: 392.00, time: 0.3, dur: 0.15 },    // G4
        { freq: 523.25, time: 0.45, dur: 0.3 },    // C5
        { freq: 659.25, time: 0.75, dur: 0.15 },   // E5
        { freq: 783.99, time: 0.9, dur: 0.15 },    // G5
        { freq: 1046.50, time: 1.05, dur: 0.6 },   // C6 (hold)
    ];

    fanfareNotes.forEach(note => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(note.freq, now + note.time);

        gain.gain.setValueAtTime(0, now + note.time);
        gain.gain.linearRampToValueAtTime(0.12, now + note.time + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.time + note.dur);

        osc.connect(gain);
        gain.connect(audioContext.destination);

        osc.start(now + note.time);
        osc.stop(now + note.time + note.dur);
    });

    // Triumphant chord at the end
    const chordNotes = [523.25, 659.25, 783.99, 1046.50]; // C major
    chordNotes.forEach(freq => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + 1.2);

        gain.gain.setValueAtTime(0, now + 1.2);
        gain.gain.linearRampToValueAtTime(0.08, now + 1.25);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.5);

        osc.connect(gain);
        gain.connect(audioContext.destination);

        osc.start(now + 1.2);
        osc.stop(now + 2.5);
    });
}

let isStartingGame = false; // Guard against double-starting

async function startGame() {
    // Prevent double-starting
    if (isStartingGame) return;
    isStartingGame = true;

    GameState.currentLevel = 1;
    GameState.totalScore = 0;
    GameState.livesRemaining = CONFIG.PLAYER.START_LIVES;
    GameState.isGameOver = false;
    GameState.isPlaying = false;
    GameState.invincible = false;

    GameState.lavaTiles.clear();
    GameState.collectibleTiles.clear();
    GameState.safeIslands.clear();

    document.getElementById('start-screen').classList.add('hidden');
    document.getElementById('game-over-screen').classList.add('hidden');
    document.getElementById('win-screen').classList.add('hidden');
    document.getElementById('level-complete-screen').classList.add('hidden');

    playerMesh = createPlayer();
    updateHUD();
    startMusic();

    // Show tutorial on first level if not shown yet
    if (!GameState.tutorialShown) {
        await showTutorial();
    }

    await runCountdown();
    isStartingGame = false;
}

function showTutorial() {
    return new Promise((resolve) => {
        const tutorialPopup = document.getElementById('tutorial-popup');
        tutorialPopup.classList.remove('hidden');

        const okBtn = document.getElementById('tutorial-ok-btn');

        const dismissTutorial = () => {
            tutorialPopup.classList.add('hidden');
            GameState.tutorialShown = true;
            okBtn.removeEventListener('click', dismissTutorial);
            okBtn.removeEventListener('touchend', touchHandler);
            document.removeEventListener('keydown', keyHandler);
            resolve();
        };

        const keyHandler = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dismissTutorial();
            }
        };

        // Touch handler for mobile
        const touchHandler = (e) => {
            e.preventDefault();
            e.stopPropagation();
            dismissTutorial();
        };

        okBtn.addEventListener('click', dismissTutorial);
        okBtn.addEventListener('touchend', touchHandler);
        document.addEventListener('keydown', keyHandler);
    });
}

function restartGame() {
    isStartingGame = false; // Reset guard for restart
    GameState.lavaTiles.clear();
    GameState.collectibleTiles.clear();
    GameState.safeIslands.clear();
    startGame();
}

// ============================================
// AUDIO SYSTEM
// ============================================
function initAudio() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();

        // iOS requires user interaction to enable audio
        // Resume audio context on user interaction
        const resumeAudio = () => {
            if (audioContext && audioContext.state === 'suspended') {
                audioContext.resume();
            }
        };

        // Listen for user interactions - not using once since we need multiple chances
        document.addEventListener('touchstart', resumeAudio);
        document.addEventListener('click', resumeAudio);

    } catch (e) {
        console.log('Web Audio not supported');
    }
}

function startMusic() {
    if (!audioContext || GameState.musicPlaying) return;

    // Resume audio context if suspended (iOS requirement)
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            GameState.musicPlaying = true;
            playTechnoLoop();
        });
    } else {
        GameState.musicPlaying = true;
        playTechnoLoop();
    }
}

function stopMusic() {
    GameState.musicPlaying = false;
    musicOscillators.forEach(osc => { try { osc.stop(); } catch(e) {} });
    musicOscillators = [];
}

function playTechnoLoop() {
    if (!GameState.musicPlaying || !audioContext) return;

    const now = audioContext.currentTime;
    const level = GameState.currentLevel;

    // === 80s SYNTHWAVE SPY THEME - 120 BPM ===
    const bpm = 120;
    const beat = 60 / bpm; // 0.5 seconds per beat
    const barLength = beat * 4; // 2 seconds per bar

    // Intensity scaling (0.0 to 1.0)
    const intensity = Math.min((level - 1) / 11, 1.0);

    // === SYNTHWAVE PAD - Lush retro atmosphere ===
    const padVol = 0.025 + intensity * 0.012;
    // A minor chord for spy feel
    playSynthwavePad(now, 110.00, padVol, barLength * 4); // A2
    playSynthwavePad(now, 130.81, padVol * 0.8, barLength * 4); // C3
    playSynthwavePad(now, 164.81, padVol * 0.6, barLength * 4); // E3

    // === DRIVING KICK - 4 on the floor ===
    const kickVol = 0.06 + intensity * 0.02;
    for (let bar = 0; bar < 4; bar++) {
        for (let i = 0; i < 4; i++) {
            playSynthwaveKick(now + bar * barLength + i * beat, kickVol);
        }
    }

    // === PUNCHY SNARE - Beats 2 and 4 ===
    const snareVol = 0.04 + intensity * 0.015;
    for (let bar = 0; bar < 4; bar++) {
        playSynthwaveSnare(now + bar * barLength + beat, snareVol);
        playSynthwaveSnare(now + bar * barLength + beat * 3, snareVol);
    }

    // === CRISP HI-HATS - 8th notes with accents ===
    const hihatVol = 0.02 + intensity * 0.01;
    for (let bar = 0; bar < 4; bar++) {
        for (let i = 0; i < 8; i++) {
            const accent = (i % 2 === 0) ? 0.7 : 1;
            const isOpen = (i === 2 || i === 6); // Open hat on offbeats
            playSynthwaveHiHat(now + bar * barLength + i * (beat / 2), hihatVol * accent, isOpen);
        }
    }

    // === ANALOG BASS - Driving synth bass line ===
    const bassVol = 0.045 + intensity * 0.02;
    // Spy-style minor key bass pattern
    const bassPattern = [
        { note: 110.00, time: 0 },           // A
        { note: 110.00, time: beat * 0.5 },
        { note: 110.00, time: beat },
        { note: 130.81, time: beat * 1.5 },  // C
        { note: 110.00, time: beat * 2 },
        { note: 110.00, time: beat * 2.5 },
        { note: 146.83, time: beat * 3 },    // D
        { note: 123.47, time: beat * 3.5 },  // B
    ];
    for (let bar = 0; bar < 4; bar++) {
        bassPattern.forEach(p => {
            playAnalogBass(now + bar * barLength + p.time, p.note, bassVol, beat * 0.4);
        });
    }

    // === SYNTHWAVE ARPEGGIO - Classic 80s pattern ===
    const arpVol = 0.02 + intensity * 0.015;
    // A minor arpeggio - spy/action feel
    const arpNotes = [220.00, 261.63, 329.63, 440.00, 329.63, 261.63]; // A3, C4, E4, A4, E4, C4
    const arpLength = beat / 3; // Triplet feel
    for (let bar = 0; bar < 4; bar++) {
        for (let i = 0; i < 12; i++) {
            const note = arpNotes[i % arpNotes.length];
            playSynthwaveArp(now + bar * barLength + i * arpLength, note, arpVol, arpLength * 0.8);
        }
    }

    // === LEAD SYNTH - Spy melody (level 3+) ===
    if (level >= 3) {
        const leadVol = 0.025 + intensity * 0.015;
        // Simple spy-style motif
        const leadMelody = [
            { note: 440.00, time: 0, dur: beat * 0.75 },           // A4
            { note: 392.00, time: beat, dur: beat * 0.5 },         // G4
            { note: 440.00, time: beat * 2, dur: beat * 0.75 },    // A4
            { note: 523.25, time: beat * 3, dur: beat },           // C5
        ];
        // Play melody in bars 1 and 3
        leadMelody.forEach(n => {
            playSynthwaveLead(now + n.time, n.note, leadVol, n.dur);
            playSynthwaveLead(now + barLength * 2 + n.time, n.note * 1.06, leadVol * 0.8, n.dur);
        });
    }

    // === RETRO STABS - Synth brass hits (level 5+) ===
    if (level >= 5) {
        const stabVol = 0.03 + intensity * 0.015;
        playRetroStab(now + barLength + beat * 3.5, 329.63, stabVol, beat * 0.3);
        playRetroStab(now + barLength * 3 + beat * 3.5, 349.23, stabVol, beat * 0.3);
    }

    // === FILTER SWEEP - Rising tension (level 7+) ===
    if (level >= 7) {
        playFilterSweep(now, barLength * 4, 0.015 + intensity * 0.01);
    }

    // === EXTRA PERCUSSION - Toms (level 9+) ===
    if (level >= 9) {
        const tomVol = 0.03 + intensity * 0.01;
        playSynthTom(now + barLength + beat * 3.75, 100, tomVol);
        playSynthTom(now + barLength * 3 + beat * 3.75, 80, tomVol);
    }

    // Loop every 4 bars (8 seconds at 120 BPM)
    setTimeout(() => { if (GameState.musicPlaying) playTechnoLoop(); }, barLength * 4 * 1000 - 50);
}

// === 80s SYNTHWAVE SOUND FUNCTIONS ===

function playSynthwavePad(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const osc3 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    // Rich detuned sawtooths for that 80s pad sound
    osc1.type = 'sawtooth';
    osc2.type = 'sawtooth';
    osc3.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.007, time); // Detuned
    osc3.frequency.setValueAtTime(freq * 0.993, time); // Detuned other way

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300, time);
    filter.frequency.linearRampToValueAtTime(600, time + dur * 0.3);
    filter.frequency.linearRampToValueAtTime(400, time + dur);
    filter.Q.value = 1;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.8);
    gain.gain.setValueAtTime(vol, time + dur - 0.8);
    gain.gain.linearRampToValueAtTime(0, time + dur);

    osc1.connect(filter);
    osc2.connect(filter);
    osc3.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc1.start(time);
    osc2.start(time);
    osc3.start(time);
    osc1.stop(time + dur);
    osc2.stop(time + dur);
    osc3.stop(time + dur);
}

function playSynthwaveKick(time, vol) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.08);

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.3);
}

function playSynthwaveSnare(time, vol) {
    if (!audioContext) return;
    // Tone component
    const osc = audioContext.createOscillator();
    const oscGain = audioContext.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(200, time);
    osc.frequency.exponentialRampToValueAtTime(120, time + 0.05);
    oscGain.gain.setValueAtTime(vol * 0.7, time);
    oscGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
    osc.connect(oscGain);
    oscGain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.1);

    // Noise component
    const bufferSize = audioContext.sampleRate * 0.15;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.12));
    }
    const source = audioContext.createBufferSource();
    const noiseGain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 2500;
    noiseGain.gain.setValueAtTime(vol, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    source.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    source.start(time);
}

function playSynthwaveHiHat(time, vol, isOpen) {
    if (!audioContext) return;
    const dur = isOpen ? 0.12 : 0.04;
    const bufferSize = audioContext.sampleRate * dur;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * (isOpen ? 0.3 : 0.08)));
    }

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(time);
}

function playAnalogBass(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    // Sawtooth + sub for fat 80s bass
    osc.type = 'sawtooth';
    osc2.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 0.5, time); // Sub octave

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, time);
    filter.frequency.exponentialRampToValueAtTime(200, time + dur);
    filter.Q.value = 4;

    gain.gain.setValueAtTime(vol, time);
    gain.gain.setValueAtTime(vol * 0.7, time + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + dur);
    osc2.stop(time + dur);
    musicOscillators.push(osc, osc2);
}

function playSynthwaveArp(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, time);
    filter.frequency.exponentialRampToValueAtTime(600, time + dur);
    filter.Q.value = 2;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + dur);
}

function playSynthwaveLead(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    // Classic synth lead - square + saw
    osc.type = 'square';
    osc2.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.005, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2500, time);
    filter.frequency.exponentialRampToValueAtTime(1000, time + dur);
    filter.Q.value = 3;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.02);
    gain.gain.setValueAtTime(vol * 0.6, time + dur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc2.start(time);
    osc.stop(time + dur);
    osc2.stop(time + dur);
}

function playRetroStab(time, freq, vol, dur) {
    if (!audioContext) return;
    // Multiple oscillators for thick brass stab
    const oscs = [];
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    [1, 1.01, 2, 2.01].forEach(mult => {
        const osc = audioContext.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq * mult, time);
        osc.connect(filter);
        oscs.push(osc);
    });

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3000, time);
    filter.frequency.exponentialRampToValueAtTime(600, time + dur);
    filter.Q.value = 2;

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    filter.connect(gain);
    gain.connect(audioContext.destination);

    oscs.forEach(osc => { osc.start(time); osc.stop(time + dur); });
}

function playFilterSweep(time, dur, vol) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(55, time); // Low A

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(100, time);
    filter.frequency.exponentialRampToValueAtTime(3000, time + dur);
    filter.Q.value = 8;

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + dur * 0.5);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + dur);
}

function playSynthTom(time, freq, vol) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 2, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.1);

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.25);
}

// === LEVEL COMPLETE CHIME - Satisfying accomplishment sound ===
function playLevelCompleteChime() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const now = audioContext.currentTime;

    // Ascending major chord arpeggio - classic "success" sound
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    const vol = 0.2; // Louder chime

    notes.forEach((freq, i) => {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.12);

        gain.gain.setValueAtTime(0, now + i * 0.12);
        gain.gain.linearRampToValueAtTime(vol * (1 - i * 0.12), now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.6);

        osc.connect(gain);
        gain.connect(audioContext.destination);

        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.6);
    });

    // Final shimmer
    const shimmer = audioContext.createOscillator();
    const shimmerGain = audioContext.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(1567.98, now + 0.5); // G6

    shimmerGain.gain.setValueAtTime(0, now + 0.5);
    shimmerGain.gain.linearRampToValueAtTime(0.06, now + 0.55);
    shimmerGain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

    shimmer.connect(shimmerGain);
    shimmerGain.connect(audioContext.destination);
    shimmer.start(now + 0.5);
    shimmer.stop(now + 1.3);
}

// New sound functions for dynamic music
function playPad(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 1.005, time); // Slight detune for richness

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(800, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.3);
    gain.gain.setValueAtTime(vol, time + dur - 0.3);
    gain.gain.linearRampToValueAtTime(0, time + dur);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + dur);
    osc2.stop(time + dur);
}

function playStab(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 2, time);
    filter.Q.value = 5;

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + dur);
}

function playNoiseSweep(time, dur, vol) {
    if (!audioContext) return;
    const bufferSize = audioContext.sampleRate * dur;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (i / bufferSize); // Rising noise
    }

    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    source.buffer = buffer;
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(500, time);
    filter.frequency.exponentialRampToValueAtTime(4000, time + dur);

    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    source.start(time);
}

function playDrum(time, freq, vol) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(30, time + 0.1);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.15);
}

function playHiHat(time, vol) {
    if (!audioContext) return;
    const bufferSize = audioContext.sampleRate * 0.05;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.1));
    const source = audioContext.createBufferSource();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    source.buffer = buffer;
    filter.type = 'highpass';
    filter.frequency.value = 8000;
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    source.start(time);
}

function playSynth(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(2000, time);
    filter.frequency.exponentialRampToValueAtTime(500, time + dur);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(vol, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + dur);
    musicOscillators.push(osc);
}

function playBass(time, freq, vol, dur) {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    gain.gain.setValueAtTime(vol, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + dur);
    musicOscillators.push(osc);
}

function playCountdownSound(num) {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.value = num === 0 ? 880 : 440;
    gain.gain.setValueAtTime(0.15, audioContext.currentTime); // Louder countdown
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.2);
}

function playHopSound() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.05);
    gain.gain.setValueAtTime(0.08, audioContext.currentTime); // Louder hop
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
}

function playCollectSound() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, audioContext.currentTime);
    osc.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.05);
    osc.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, audioContext.currentTime); // Louder collect
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.2);
}

function playHitSound() {
    if (!audioContext) return;
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, audioContext.currentTime); // Louder hit
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.3);
}

function toggleMusic() {
    const btn = document.getElementById('music-toggle');
    if (GameState.musicPlaying) {
        stopMusic();
        btn.textContent = '🔇';
        btn.classList.add('muted');
    } else {
        startMusic();
        btn.textContent = '🔊';
        btn.classList.remove('muted');
    }
}

// ============================================
// UI/HUD
// ============================================
function updateHUD() {
    document.getElementById('level-display').textContent = `Sector ${GameState.currentLevel}/${CONFIG.LEVELS.TOTAL}`;
    document.getElementById('score-display').textContent = `Score: ${GameState.totalScore}`;

    const hearts = document.querySelectorAll('#lives-display .heart');
    hearts.forEach((heart, i) => {
        heart.classList.toggle('lost', i >= GameState.livesRemaining);
    });

    // Update timer bar
    const timerBar = document.getElementById('timer-bar-fill');
    if (timerBar) {
        const percentage = (GameState.currentLevelScore / GameState.maxLevelScore) * 100;
        timerBar.style.width = `${percentage}%`;

        // Change color based on time remaining
        if (percentage > 60) {
            timerBar.style.background = 'linear-gradient(90deg, #00ff88, #00ffcc)';
        } else if (percentage > 30) {
            timerBar.style.background = 'linear-gradient(90deg, #ffcc00, #ff8800)';
        } else {
            timerBar.style.background = 'linear-gradient(90deg, #ff4444, #ff0000)';
        }
    }

    // Update potential score display
    const potentialScore = document.getElementById('potential-score');
    if (potentialScore) {
        potentialScore.textContent = `+${Math.max(1, GameState.currentLevelScore)}`;
    }
}

function updateTimeBasedScore() {
    if (!GameState.isPlaying || GameState.isPaused) return;

    const elapsed = Date.now() - GameState.levelStartTime;

    if (elapsed <= GameState.gracePeriod) {
        // Within grace period - max score
        GameState.currentLevelScore = GameState.maxLevelScore;
    } else {
        // Score decays after grace period
        const decayElapsed = elapsed - GameState.gracePeriod;
        const decayProgress = Math.min(decayElapsed / GameState.scoreDecayTime, 1);
        GameState.currentLevelScore = Math.round(GameState.maxLevelScore * (1 - decayProgress));
        GameState.currentLevelScore = Math.max(1, GameState.currentLevelScore); // Minimum 1 point
    }
}

// ============================================
// TOUCH/SWIPE CONTROLS
// ============================================
let touchStartX = 0;
let touchStartY = 0;
let touchStartTime = 0;
const SWIPE_THRESHOLD = 25; // Minimum distance for swipe detection
const TAP_THRESHOLD = 200; // Max ms for a tap

function setupTouchControls() {
    // Use document for better touch capture on iOS
    document.addEventListener('touchstart', (e) => {
        // Only handle touches on game area, not UI buttons
        if (e.target.closest('.game-btn, .start-btn, .char-option, .music-btn, .overlay:not(.hidden)')) {
            return;
        }
        if (e.touches && e.touches.length > 0) {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
            touchStartTime = Date.now();
        }
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
        // Only handle touches on game area, not UI buttons
        if (e.target.closest('.game-btn, .start-btn, .char-option, .music-btn, .overlay:not(.hidden)')) {
            return;
        }
        if (e.changedTouches && e.changedTouches.length > 0) {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            handleSwipe(touchEndX, touchEndY);
        }
    }, { passive: true });

    // Prevent scrolling during gameplay
    document.addEventListener('touchmove', (e) => {
        if (GameState.isPlaying && !GameState.isPaused) {
            e.preventDefault();
        }
    }, { passive: false });
}

function handleSwipe(touchEndX, touchEndY) {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);
    const elapsed = Date.now() - touchStartTime;

    // Check if it's a tap (short time, small movement)
    if (elapsed < TAP_THRESHOLD && Math.max(absDeltaX, absDeltaY) < SWIPE_THRESHOLD) {
        handleTap();
        return;
    }

    // Check if swipe is significant enough
    if (Math.max(absDeltaX, absDeltaY) < SWIPE_THRESHOLD) {
        return;
    }

    if (!GameState.isPlaying || GameState.isPaused || GameState.isCountingDown) {
        return;
    }

    // ISOMETRIC SWIPE MAPPING:
    // Board is rotated 45 degrees - camera at top-right looking at bottom-left
    // Swipe NE (up-right on screen) = move forward on board = -Z (toward top-left of board)
    // Swipe SW (down-left on screen) = move backward = +Z (toward bottom-right)
    // Swipe NW (up-left on screen) = move left on board = -X
    // Swipe SE (down-right on screen) = move right on board = +X

    // Calculate swipe angle to determine direction
    const angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    // Angle: 0=right, 90=down, 180/-180=left, -90=up

    // Map to 4 isometric directions (45 degree sectors)
    if (angle >= -45 && angle < 45) {
        // Swipe RIGHT (East) -> move right on board (+X)
        movePlayer(1, 0);
    } else if (angle >= 45 && angle < 135) {
        // Swipe DOWN (South) -> move back on board (+Z)
        movePlayer(0, 1);
    } else if (angle >= 135 || angle < -135) {
        // Swipe LEFT (West) -> move left on board (-X)
        movePlayer(-1, 0);
    } else {
        // Swipe UP (North) -> move forward on board (-Z)
        movePlayer(0, -1);
    }
}

function handleTap() {
    const tutorialPopup = document.getElementById('tutorial-popup');

    // Handle tutorial dismiss on tap
    if (!tutorialPopup.classList.contains('hidden')) {
        tutorialPopup.classList.add('hidden');
        GameState.tutorialShown = true;
        return;
    }
}

function isTouchDevice() {
    return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
}

function showMobileHint() {
    if (!isTouchDevice()) return;

    // Update controls text for mobile
    const controlsText = document.querySelector('.vintage-controls p');
    if (controlsText) {
        controlsText.textContent = 'SWIPE TO MOVE';
    }
}

// ============================================
// INPUT HANDLING
// ============================================
function setupInputHandlers() {
    // Handle both old and new character selectors
    document.querySelectorAll('.character-option, .char-option').forEach(option => {
        option.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent startGame from triggering
            document.querySelectorAll('.character-option, .char-option').forEach(o => o.classList.remove('selected'));
            option.classList.add('selected');
            GameState.selectedCharacter = option.dataset.character;
            console.log('Selected character:', GameState.selectedCharacter);
        });
    });


    document.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const startScreen = document.getElementById('start-screen');
            const gameOverScreen = document.getElementById('game-over-screen');
            const levelCompleteScreen = document.getElementById('level-complete-screen');
            const winScreen = document.getElementById('win-screen');

            if (!startScreen.classList.contains('hidden')) { startGame(); e.preventDefault(); return; }
            if (!gameOverScreen.classList.contains('hidden')) { restartGame(); e.preventDefault(); return; }
            if (!levelCompleteScreen.classList.contains('hidden')) { nextLevel(); e.preventDefault(); return; }
            if (!winScreen.classList.contains('hidden')) { restartGame(); e.preventDefault(); return; }
        }

        if (!GameState.isPlaying || GameState.isCountingDown) return;

        switch (e.key) {
            case 'ArrowUp': case 'w': case 'W': movePlayer(0, -1); e.preventDefault(); break;
            case 'ArrowDown': case 's': case 'S': movePlayer(0, 1); e.preventDefault(); break;
            case 'ArrowLeft': case 'a': case 'A': movePlayer(-1, 0); e.preventDefault(); break;
            case 'ArrowRight': case 'd': case 'D': movePlayer(1, 0); e.preventDefault(); break;
            case 'Escape': togglePause(); e.preventDefault(); break;
        }
    });

    // Start button
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startGame();
        });
    }

    document.getElementById('retry-btn').addEventListener('click', restartGame);
    document.getElementById('next-level-btn').addEventListener('click', nextLevel);
    document.getElementById('play-again-btn').addEventListener('click', restartGame);
    document.getElementById('music-toggle').addEventListener('click', toggleMusic);
}

function togglePause() {
    if (!GameState.isPlaying || GameState.isCountingDown) return;

    GameState.isPaused = !GameState.isPaused;
    document.getElementById('pause-indicator').classList.toggle('hidden', !GameState.isPaused);

    if (GameState.isPaused) stopMusic();
    else startMusic();
}

// ============================================
// ANIMATION LOOP
// ============================================
function animate() {
    requestAnimationFrame(animate);

    if (GameState.invincible && Date.now() > GameState.invincibleUntil) {
        GameState.invincible = false;
    }

    if (GameState.isPlaying && !GameState.isPaused && !GameState.isCountingDown) {
        updateLavaPatterns(clock.getDelta());
        updateHopAnimation();
        updateCameraFollow();
        updateTimeBasedScore();
        updateHUD();

        const time = Date.now();

        // Animate collectible tiles
        GameState.collectibleTiles.forEach(key => {
            const [x, z] = key.split(',').map(Number);
            const tile = tilesMeshes[x][z];
            if (tile) {
                tile.material.emissiveIntensity = 0.5 + Math.sin(time / 250) * 0.2;
            }
        });

        // Animate safe islands
        GameState.safeIslands.forEach(key => {
            const [x, z] = key.split(',').map(Number);
            const tile = tilesMeshes[x][z];
            tile.material.emissiveIntensity = 0.35 + Math.sin(time / 400 + x * 0.5 + z * 0.5) * 0.1;
        });
    }

    renderer.render(scene, camera);
}

// ============================================
// INITIALIZATION
// ============================================
function init() {
    initThreeJS();
    initAudio();
    createTileGrid();
    setupInputHandlers();
    setupTouchControls();
    showMobileHint();
    updateHUD();
    animate();
    console.log('Time Mission: Magma Mayhem initialized!');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
