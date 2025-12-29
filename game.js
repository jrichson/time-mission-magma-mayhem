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
const GameState = {
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

function getCameraSettings() {
    const aspect = window.innerWidth / window.innerHeight;
    const isMobile = window.innerWidth <= 768;
    const isSmallMobile = window.innerWidth <= 480;

    // Base frustum size - needs to be larger on portrait mobile to fit the board
    let frustumSize = 16;
    let zoom = 1.1;

    if (isMobile) {
        // Portrait mobile: board is taller than wide in isometric view
        // Need to zoom out significantly to fit the full board
        if (aspect < 1) {
            // Portrait orientation - zoom out more
            frustumSize = 22;
            zoom = isSmallMobile ? 0.65 : 0.75;
        } else {
            // Landscape mobile
            frustumSize = 18;
            zoom = 0.9;
        }
    }

    return { aspect, frustumSize, zoom };
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
            // GREEN PERIMETER LEVEL - lots of safe space, intense center
            // This level uses green perimeter (set in generateSafeIslands)
            addDiagonalSweep(1, 0.7);
            addDiagonalSweep(-1, 0.7);
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

    if (dz < 0) playerMesh.rotation.y = 0;
    else if (dz > 0) playerMesh.rotation.y = Math.PI;
    else if (dx < 0) playerMesh.rotation.y = Math.PI / 2;
    else if (dx > 0) playerMesh.rotation.y = -Math.PI / 2;

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
    document.getElementById('game-over-screen').classList.remove('hidden');
}

function showLevelCompleteScreen() {
    const earnedScore = Math.max(1, GameState.currentLevelScore);
    document.getElementById('level-score').textContent = `+${earnedScore} points!`;
    document.getElementById('level-complete-screen').classList.remove('hidden');
}

function showWinScreen() {
    stopMusic();
    const maxScore = CONFIG.LEVELS.TOTAL * GameState.maxLevelScore;
    document.getElementById('win-score').textContent = `Final Score: ${GameState.totalScore}/${maxScore}`;
    document.getElementById('win-screen').classList.remove('hidden');
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
            document.removeEventListener('keydown', keyHandler);
            resolve();
        };

        const keyHandler = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                dismissTutorial();
            }
        };

        okBtn.addEventListener('click', dismissTutorial);
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
    } catch (e) {
        console.log('Web Audio not supported');
    }
}

function startMusic() {
    if (!audioContext || GameState.musicPlaying) return;
    if (audioContext.state === 'suspended') audioContext.resume();
    GameState.musicPlaying = true;
    playTechnoLoop();
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

    // BPM increases with level: 120 -> 180
    const bpm = 120 + (level - 1) * 5;
    const beat = 60 / bpm;

    // Intensity scaling based on level (0.0 to 1.0)
    const intensity = Math.min((level - 1) / 11, 1.0);

    // KICK DRUMS - More complex patterns at higher levels
    const kickVolume = 0.08 + intensity * 0.04;
    if (level <= 4) {
        // Simple 4-on-floor
        [0, 2, 4, 6].forEach(i => playDrum(now + i * beat, 80 + level * 5, kickVolume));
    } else if (level <= 8) {
        // Add offbeat kicks
        [0, 1.5, 2, 3.5, 4, 5.5, 6, 7.5].forEach(i => playDrum(now + i * beat, 85 + level * 5, kickVolume));
    } else {
        // Intense double-time kicks
        for (let i = 0; i < 16; i++) {
            playDrum(now + i * (beat / 2), 90 + level * 3, kickVolume * (i % 2 === 0 ? 1 : 0.7));
        }
    }

    // HI-HATS - Faster at higher levels
    const hihatSpeed = level <= 4 ? 2 : (level <= 8 ? 4 : 8);
    const hihatVolume = 0.02 + intensity * 0.02;
    for (let i = 0; i < 8 * hihatSpeed; i++) {
        playHiHat(now + i * (beat * 8 / (8 * hihatSpeed)), hihatVolume);
    }

    // SYNTH MELODY - More complex and higher pitched at higher levels
    const synthVolume = 0.05 + intensity * 0.04;
    const baseNote = 130.81 + (level - 1) * 10; // C3 going up

    let melodyNotes;
    if (level <= 4) {
        // Simple arpeggio
        melodyNotes = [baseNote, baseNote * 1.25, baseNote * 1.5, baseNote * 2];
    } else if (level <= 8) {
        // More energetic pattern
        melodyNotes = [baseNote, baseNote * 1.25, baseNote * 1.5, baseNote * 2, baseNote * 1.5, baseNote * 1.25, baseNote * 2, baseNote];
    } else {
        // Intense rapid arpeggios
        melodyNotes = [baseNote, baseNote * 1.5, baseNote * 2, baseNote * 2.5, baseNote * 2, baseNote * 1.5, baseNote * 2, baseNote * 1.25,
                       baseNote * 1.5, baseNote * 2, baseNote * 2.5, baseNote * 3, baseNote * 2.5, baseNote * 2, baseNote * 1.5, baseNote];
    }

    const noteLength = beat * 8 / melodyNotes.length;
    melodyNotes.forEach((freq, i) => {
        playSynth(now + i * noteLength, freq, synthVolume, noteLength * 0.8);
    });

    // BASS - Deeper and more aggressive at higher levels
    const bassVolume = 0.08 + intensity * 0.06;
    const bassBase = 65.41 - (level > 6 ? 10 : 0); // Lower bass at high levels

    let bassPattern;
    if (level <= 4) {
        bassPattern = [bassBase, bassBase, bassBase * 1.25, bassBase * 1.125];
    } else if (level <= 8) {
        bassPattern = [bassBase, bassBase * 0.75, bassBase, bassBase * 1.25, bassBase, bassBase * 0.875, bassBase, bassBase * 1.5];
    } else {
        // Wobble bass effect for high levels
        bassPattern = [];
        for (let i = 0; i < 16; i++) {
            bassPattern.push(bassBase * (1 + Math.sin(i * 0.5) * 0.25));
        }
    }

    const bassNoteLength = beat * 8 / bassPattern.length;
    bassPattern.forEach((freq, i) => {
        playBass(now + i * bassNoteLength, freq, bassVolume, bassNoteLength * 0.9);
    });

    // ADD EXTRA LAYERS AT HIGH LEVELS
    if (level >= 6) {
        // Add pad/atmosphere
        playPad(now, baseNote / 2, 0.03 + intensity * 0.02, beat * 8);
    }

    if (level >= 9) {
        // Add lead stabs
        const stabTimes = [0, 1.5, 3, 4.5, 6];
        stabTimes.forEach(t => {
            playStab(now + t * beat, baseNote * 2, 0.04, beat * 0.3);
        });
    }

    if (level >= 11) {
        // Add noise sweeps for final levels
        playNoiseSweep(now, beat * 4, 0.03);
    }

    setTimeout(() => { if (GameState.musicPlaying) playTechnoLoop(); }, beat * 8 * 1000 - 50);
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
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'square';
    osc.frequency.value = num === 0 ? 880 : 440;
    gain.gain.setValueAtTime(0.1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.2);
}

function playHopSound() {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(300, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioContext.currentTime + 0.05);
    gain.gain.setValueAtTime(0.04, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
}

function playCollectSound() {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, audioContext.currentTime);
    osc.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.05);
    osc.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.1);
    gain.gain.setValueAtTime(0.08, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start();
    osc.stop(audioContext.currentTime + 0.2);
}

function playHitSound() {
    if (!audioContext) return;
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(50, audioContext.currentTime + 0.3);
    gain.gain.setValueAtTime(0.15, audioContext.currentTime);
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
let touchEndX = 0;
let touchEndY = 0;
const SWIPE_THRESHOLD = 30; // Minimum distance for swipe detection

function setupTouchControls() {
    const gameContainer = document.getElementById('game-container');

    gameContainer.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
        touchStartY = e.changedTouches[0].screenY;
    }, { passive: true });

    gameContainer.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        touchEndY = e.changedTouches[0].screenY;
        handleSwipe();
    }, { passive: true });

    // Prevent default touch behaviors that interfere with game
    gameContainer.addEventListener('touchmove', (e) => {
        if (GameState.isPlaying && !GameState.isPaused) {
            e.preventDefault();
        }
    }, { passive: false });
}

function handleSwipe() {
    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;
    const absDeltaX = Math.abs(deltaX);
    const absDeltaY = Math.abs(deltaY);

    // Check if swipe is significant enough
    if (Math.max(absDeltaX, absDeltaY) < SWIPE_THRESHOLD) {
        // It's a tap, not a swipe - handle tap for menus
        handleTap();
        return;
    }

    if (!GameState.isPlaying || GameState.isPaused || GameState.isCountingDown) return;

    // Determine swipe direction (favor the dominant axis)
    if (absDeltaX > absDeltaY) {
        // Horizontal swipe
        if (deltaX > 0) {
            movePlayer(1, 0); // Right
        } else {
            movePlayer(-1, 0); // Left
        }
    } else {
        // Vertical swipe
        if (deltaY > 0) {
            movePlayer(0, 1); // Down
        } else {
            movePlayer(0, -1); // Up
        }
    }
}

function handleTap() {
    const startScreen = document.getElementById('start-screen');
    const gameOverScreen = document.getElementById('game-over-screen');
    const levelCompleteScreen = document.getElementById('level-complete-screen');
    const winScreen = document.getElementById('win-screen');
    const tutorialPopup = document.getElementById('tutorial-popup');

    // Handle tutorial dismiss on tap
    if (!tutorialPopup.classList.contains('hidden')) {
        tutorialPopup.classList.add('hidden');
        GameState.tutorialShown = true;
        return;
    }

    // Don't auto-start on tap for start screen - use button instead
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
