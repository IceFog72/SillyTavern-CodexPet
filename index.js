import { eventSource, event_types, getRequestHeaders, saveSettings as saveSillyTavernSettings, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext, renderExtensionTemplateAsync } from '../../../extensions.js';
import { lastExpression } from '../../expressions/index.js';

export { init };

const MODULE_NAME = 'third-party/codex-pet';
const SETTINGS_KEY = 'codexPet';
const DOM_IDS = {
    root: 'codex_pet_root',
    pet: 'codex_pet_actor',
    sprite: 'codex_pet_sprite',
    bubble: 'codex_pet_bubble',
    debug: 'codex_pet_debug',
};

const BUILTIN_PETS = {
    lumi: {
        manifestUrl: new URL('./assets/lumi/pet.json', import.meta.url).href,
    },
};

const SETTINGS_VERSION = 21;

const DEFAULT_SETTINGS = {
    settingsVersion: SETTINGS_VERSION,
    enabled: true,
    petSelection: 'auto',
    scale: 0.5,
    gravityEnabled: true,
    platformsEnabled: true,
    autoDetectPlatforms: true,
    divBottomPlatformsEnabled: false,
    idleRoam: true,
    cursorTrackingEnabled: true,
    reactToExpressions: true,
    showDebugPlatforms: false,
    generationActivityBoost: true,
    platformSelectors: [
        '[data-pet-platform]',
        '#send_form',
        '#form_sheld',
        'div',
    ],
    floorOffset: 18,
    edgePadding: 14,
    x: 32,
    y: null,
    facing: 1,
};

const PHYSICS = {
    gravity: 1700,
    idleWalkSpeed: 24,
    idleRunSpeed: 62,
    activeRunSpeed: 116,
    jumpVelocity: 820,
    downJumpVelocity: 300,
    maxPlatformJumpSpeed: 220,
    platformJumpSafety: 0.90,
    maxFallSpeed: 1500,
    dragThreshold: 6,
    hopIntervalMin: 9000,
    hopIntervalMax: 16000,
    jumpCooldownMin: 4200,
    jumpCooldownMax: 7200,
    platformRefreshMs: 900,
    positionPersistMs: 500,
    moodPollMs: 500,
    petCatalogRefreshMs: 12000,
};

const EXPRESSION_TO_REACTION = {
    admiration: 'wave',
    amusement: 'wave',
    anger: 'sad',
    annoyance: 'sad',
    approval: 'review',
    caring: 'wave',
    confusion: 'bounce',
    curiosity: 'bounce',
    desire: 'wave',
    disappointment: 'sad',
    disapproval: 'sad',
    disgust: 'sad',
    embarrassment: 'bounce',
    excitement: 'bounce',
    fear: 'waiting',
    gratitude: 'wave',
    grief: 'sad',
    joy: 'review',
    love: 'wave',
    nervousness: 'waiting',
    optimism: 'review',
    pride: 'review',
    realization: 'bounce',
    relief: 'review',
    remorse: 'sad',
    sadness: 'sad',
    surprise: 'bounce',
    neutral: 'idle',
};

const DIRECTIONAL_ANIMATIONS = new Set([
    'move_left',
    'move_right',
    'running-left',
    'running-right',
]);

// These actions only have one authored direction in the Codex v2 atlas.
// Mirror the whole frame when Lumi is facing left instead of requiring duplicate rows.
const MIRRORABLE_SINGLE_DIRECTION_ANIMATIONS = new Set([
    'jumping',
    'bounce',
    'wave',
    'waving',
    'failed',
    'sad',
    'waiting',
    'review',
    'running',
]);

const HORIZONTAL_MOTION_TEMP_ANIMATIONS = new Set(['jumping', 'bounce']);

const runtime = {
    root: null,
    petEl: null,
    spriteEl: null,
    bubbleEl: null,
    debugEl: null,
    manifest: null,
    animations: null,
    frameWidth: 192,
    frameHeight: 208,
    rows: 9,
    columns: 8,
    spriteUrl: '',
    loadedPetKey: '',
    petCatalog: [],
    petDiscoveryCache: new Map(),
    assetManifestCache: new Map(),
    x: 32,
    y: 0,
    vx: 0,
    vy: 0,
    grounded: false,
    currentPlatformId: 'viewport-floor',
    dragging: false,
    dragOffsetX: 0,
    dragOffsetY: 0,
    dragMoved: false,
    facing: 1,
    currentBehavior: { type: 'idle', until: 0, direction: 1 },
    temporaryAnimation: null,
    currentExpression: '',
    generating: false,
    streamPulseUntil: 0,
    lastGenerationAt: 0,
    lastPlatformRefreshAt: 0,
    lastPositionPersistAt: 0,
    lastMoodPollAt: 0,
    nextIdleDecisionAt: 0,
    nextHopAt: 0,
    nextJumpAllowedAt: 0,
    rafId: 0,
    loopPrevTs: 0,
    platforms: [],
    platformIds: new WeakMap(),
    nextPlatformOrdinal: 1,
    mutationObserver: null,
    refreshPlatformsRequested: false,
    settingsInjected: false,
    animationState: { name: '', startedAt: 0 },
    eventsBound: false,
    observersBound: false,
    petReloadPromise: null,
    petCatalogRefreshPromise: null,
    nextPetCatalogRefreshAt: 0,
    pointer: { x: 0, y: 0, seen: false },
    attentionTarget: null,
    jumpTargetId: null,
    airborneVx: null,
    toastHooksInstalled: false,
    generationFetchHookInstalled: false,
    generationRequestActive: false,
    generationRequestStartedAt: 0,
};

function cloneSettingValue(value) {
    if (value == null || typeof value !== 'object') {
        return value;
    }

    return structuredClone(value);
}

function initializeSettings() {
    let changed = false;

    if (!extension_settings[SETTINGS_KEY] || typeof extension_settings[SETTINGS_KEY] !== 'object') {
        extension_settings[SETTINGS_KEY] = {};
        changed = true;
    }

    const settings = extension_settings[SETTINGS_KEY];
    const previousVersion = Number(settings.settingsVersion) || 0;

    // Follow the same persistence model as PTMT: preserve the loaded extension
    // settings object, and only populate keys that are actually missing.
    // Never overwrite an existing user choice merely because the extension version changed.
    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
        if (!Object.prototype.hasOwnProperty.call(settings, key)) {
            settings[key] = cloneSettingValue(defaultValue);
            changed = true;
        }
    }

    if (!Array.isArray(settings.platformSelectors)) {
        settings.platformSelectors = String(settings.platformSelectors || '')
            .split(/\r?\n|,/)
            .map(x => x.trim())
            .filter(Boolean);
        changed = true;
    }

    // `div` became part of the default selector list in v0.2.10. Only migrate
    // installs that actually predate that version; never re-add it after a user
    // intentionally removes it in a newer version.
    if (previousVersion > 0 && previousVersion < 10 && !settings.platformSelectors.includes('div')) {
        settings.platformSelectors.push('div');
        changed = true;
    }

    if (settings.settingsVersion !== SETTINGS_VERSION) {
        settings.settingsVersion = SETTINGS_VERSION;
        changed = true;
    }

    if (changed) {
        saveSettingsDebounced();
    }

    return settings;
}

function getSettings() {
    return initializeSettings();
}

async function saveSettings(force = false) {
    if (force) {
        await saveSillyTavernSettings();
    } else {
        saveSettingsDebounced();
    }
}

function updateSetting(key, value, force = false) {
    const settings = getSettings();
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key)) {
        console.warn(`[Codex Pet] Ignored unknown setting key: ${key}`);
        return Promise.resolve();
    }

    settings[key] = value;
    return saveSettings(force);
}

function petWidth() {
    return Math.round(runtime.frameWidth * getSettings().scale);
}

function petHeight() {
    return Math.round(runtime.frameHeight * getSettings().scale);
}

function idleAnimation() {
    return {
        frames: [
            { spriteIndex: 0, duration: 1680 },
            { spriteIndex: 1, duration: 660 },
            { spriteIndex: 2, duration: 660 },
            { spriteIndex: 3, duration: 840 },
            { spriteIndex: 4, duration: 840 },
            { spriteIndex: 5, duration: 1920 },
        ],
        loopStart: 0,
        fallback: 'idle',
    };
}

function appStateAnimation(rowIndex, frameCount, frameDurationMs, finalFrameDurationMs) {
    const primaryFrames = [];
    for (let columnIndex = 0; columnIndex < frameCount; columnIndex++) {
        primaryFrames.push({
            spriteIndex: rowIndex * 8 + columnIndex,
            duration: columnIndex === frameCount - 1 ? finalFrameDurationMs : frameDurationMs,
        });
    }

    const idleFrames = idleAnimation().frames.map(frame => ({ ...frame }));
    return {
        frames: [...primaryFrames, ...primaryFrames, ...primaryFrames, ...idleFrames],
        loopStart: primaryFrames.length * 3,
        fallback: 'idle',
    };
}

function continuousRowAnimation(rowIndex, frameCount, frameDurationMs = 120, finalFrameDurationMs = 160) {
    return {
        frames: Array.from({ length: frameCount }, (_, columnIndex) => ({
            spriteIndex: rowIndex * 8 + columnIndex,
            duration: columnIndex === frameCount - 1 ? finalFrameDurationMs : frameDurationMs,
        })),
        loopStart: 0,
        fallback: 'idle',
    };
}

function oneShotRowAnimation(rowIndex, frameCount, frameDurationMs = 140, finalFrameDurationMs = 280) {
    return {
        frames: Array.from({ length: frameCount }, (_, columnIndex) => ({
            spriteIndex: rowIndex * 8 + columnIndex,
            duration: columnIndex === frameCount - 1 ? finalFrameDurationMs : frameDurationMs,
        })),
        loopStart: null,
        fallback: 'idle',
    };
}

function defaultAnimations() {
    return {
        idle: idleAnimation(),
        'running-right': continuousRowAnimation(1, 8, 135, 170),
        'running-left': continuousRowAnimation(2, 8, 135, 170),
        waving: appStateAnimation(3, 4, 140, 280),
        jumping: appStateAnimation(4, 5, 140, 280),
        failed: appStateAnimation(5, 8, 140, 240),
        waiting: appStateAnimation(6, 6, 150, 260),
        running: continuousRowAnimation(7, 6, 135, 170),
        run: continuousRowAnimation(7, 6, 135, 170),
        review: appStateAnimation(8, 6, 150, 280),
        move_right: continuousRowAnimation(1, 8, 180, 220),
        move_left: continuousRowAnimation(2, 8, 180, 220),
        wave: appStateAnimation(3, 4, 140, 280),
        wave_once: oneShotRowAnimation(3, 4, 140, 280),
        bounce: appStateAnimation(4, 5, 140, 280),
        sad: appStateAnimation(5, 8, 140, 240),
    };
}

function normalizeAnimations(rawAnimations = {}) {
    const animations = defaultAnimations();

    for (const [name, spec] of Object.entries(rawAnimations)) {
        if (!Array.isArray(spec?.frames) || spec.frames.length === 0) {
            continue;
        }

        const fps = Number(spec.fps) > 0 ? Math.min(Number(spec.fps), 60) : 8;
        const duration = 1000 / fps;
        animations[name] = {
            frames: spec.frames.map(spriteIndex => ({ spriteIndex, duration })),
            loopStart: spec.loop === false ? null : 0,
            fallback: spec.fallback || 'idle',
        };
    }

    if (!animations.idle) {
        animations.idle = idleAnimation();
    }

    return animations;
}

async function loadImage(url) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error(`Failed to load pet spritesheet: ${url}`));
        image.src = url;
    });
}

function alphaOfCssColor(color) {
    if (!color || color === 'transparent') return 0;
    const match = color.match(/rgba?\(([^)]+)\)/i);
    if (!match) return 1;
    const parts = match[1].split(',').map(x => x.trim());
    return parts.length >= 4 ? Number(parts[3]) || 0 : 1;
}

function transparentGutterCenters(occupancy, orthogonalSamples) {
    const threshold = Math.max(1, Math.floor(orthogonalSamples * 0.018));
    const centers = [];
    let start = null;

    for (let i = 0; i <= occupancy.length; i++) {
        const low = i < occupancy.length && occupancy[i] <= threshold;
        if (low && start === null) start = i;
        if ((!low || i === occupancy.length) && start !== null) {
            const end = i;
            if (end - start >= 2) centers.push((start + end - 1) / 2);
            start = null;
        }
    }

    if (centers.length === 0 || centers[0] > 8) centers.unshift(0);
    if (centers[centers.length - 1] < occupancy.length - 9) centers.push(occupancy.length);
    else centers[centers.length - 1] = occupancy.length;
    return centers;
}

function detectSpritesheetGrid(image, fallbackColumns = 8, fallbackRows = 9, explicitFrame = null) {
    const explicitColumns = Number(explicitFrame?.columns);
    const explicitRows = Number(explicitFrame?.rows);
    if (Number.isInteger(explicitColumns) && explicitColumns > 0
        && Number.isInteger(explicitRows) && explicitRows > 0) {
        return { columns: explicitColumns, rows: explicitRows, detected: false, method: 'manifest' };
    }

    // Codex v2 sheets are authored on an 8-column atlas with 192x208 cells.
    // Some generated sheets are resized as a whole, so their raw pixel size is
    // not necessarily 1536x1872. Inferring rows from the whole-sheet aspect is
    // much more reliable than looking for transparent gutters: narrow characters
    // can create large internal transparent bands that look like fake columns.
    const columns = Number.isInteger(Number(fallbackColumns)) && Number(fallbackColumns) > 0
        ? Number(fallbackColumns)
        : 8;
    const codexCellAspect = 192 / 208;
    const estimatedRows = Math.round((image.naturalHeight / image.naturalWidth) * columns * codexCellAspect);
    const rows = Math.max(1, Math.min(32, estimatedRows || Number(fallbackRows) || 9));
    const inferredCellAspect = (image.naturalWidth / columns) / (image.naturalHeight / rows);
    const aspectError = Math.abs(inferredCellAspect - codexCellAspect) / codexCellAspect;

    if (rows >= 2 && rows <= 32 && aspectError <= 0.12) {
        return { columns, rows, detected: true, method: 'codex-aspect' };
    }

    return {
        columns: Number(fallbackColumns) || 8,
        rows: Number(fallbackRows) || 9,
        detected: false,
        method: 'fallback',
    };
}

function characterSpriteFolder(character) {
    const avatarBase = character?.avatar?.replace(/\.[^/.]+$/, '');
    if (!avatarBase) return '';
    const override = extension_settings.expressionOverrides?.find(entry => entry.name === avatarBase);
    return override?.path || avatarBase;
}

async function findCharacterSpritesheet(character) {
    const folder = characterSpriteFolder(character);
    if (!folder) return null;
    if (runtime.petDiscoveryCache.has(folder)) return runtime.petDiscoveryCache.get(folder);

    const promise = (async () => {
        try {
            const response = await fetch(`/api/sprites/get?name=${encodeURIComponent(folder)}`);
            if (!response.ok) return null;
            const sprites = await response.json();
            const match = sprites.find(sprite => {
                const fileName = String(sprite.path || '').split('/').pop()?.split('?')[0] || '';
                return /^spritesheet\.(webp|png|jpe?g)$/i.test(fileName);
            });
            if (!match) return null;

            let manifest = {
                id: `character-${folder}`,
                displayName: character.name || folder,
                description: 'Pet discovered from the character expression folder.',
                spritesheetPath: match.path,
            };
            const folderUrl = folder.split('/').map(encodeURIComponent).join('/');
            try {
                const manifestResponse = await fetch(`/characters/${folderUrl}/pet.json`);
                if (manifestResponse.ok) {
                    const customManifest = await manifestResponse.json();
                    manifest = { ...manifest, ...customManifest, spritesheetPath: match.path };
                }
            } catch {
                // pet.json is optional for expression-folder pets.
            }

            return {
                key: `character:${folder}`,
                label: `${manifest.displayName || character.name || folder} — expression spritesheet`,
                type: 'character',
                folder,
                spriteUrl: match.path,
                manifest,
            };
        } catch (error) {
            console.warn(`[Codex Pet] Failed checking character pet folder ${folder}`, error);
            return null;
        }
    })();

    runtime.petDiscoveryCache.set(folder, promise);
    return promise;
}

function normalizePetMatchName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\.[^/.]+$/, '')
        .replace(/[^a-z0-9]+/g, '');
}

async function fetchJsonIfExists(url) {
    try {
        const response = await fetch(url, { cache: 'no-store' });
        if (!response.ok) return null;
        return await response.json();
    } catch {
        return null;
    }
}

async function findPetSpritesheetInAssetFolder(baseUrl) {
    // Canonical pet asset contract: data/<user>/assets/pet/<name>/spritesheet.*
    // Probe the common formats instead of relying on directory listing from the browser.
    for (const fileName of ['spritesheet.webp', 'spritesheet.png', 'spritesheet.jpg', 'spritesheet.jpeg']) {
        const url = `${baseUrl}/${fileName}`;
        try {
            const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
            if (response.ok) return url;
        } catch {
            // Try the next extension.
        }
    }
    return null;
}

async function discoverUserAssetPets(force = false) {
    try {
        const response = await fetch('/api/assets/get', {
            method: 'POST',
            headers: getRequestHeaders({ omitContentType: true }),
            cache: 'no-store',
        });
        if (!response.ok) {
            return [];
        }

        const assets = await response.json();
        const petEntries = Array.isArray(assets?.pet) ? assets.pet : [];
        const pets = [];

        // /api/assets/get returns the direct children of data/<user>/assets/pet as
        // entries like "assets/pet/Lumi". Each child directory is one pet pack.
        for (const entry of petEntries) {
            const rawPath = String(entry || '').replace(/^\/+/, '').replace(/\/+$/, '');
            if (!rawPath) continue;

            const name = decodeURIComponent(rawPath.split('/').pop() || '').trim();
            if (!name || /^\.(placeholder|gitkeep)$/i.test(name)) continue;

            const baseUrl = `/${rawPath}`;
            const spriteUrl = await findPetSpritesheetInAssetFolder(baseUrl);
            if (!spriteUrl) {
                // Ignore ordinary files accidentally placed directly in assets/pet.
                continue;
            }

            const petJsonUrl = `${baseUrl}/pet.json`;
            const cacheKey = petJsonUrl;
            if (force) runtime.assetManifestCache.delete(cacheKey);

            let manifestPromise = runtime.assetManifestCache.get(cacheKey);
            if (!manifestPromise) {
                manifestPromise = fetchJsonIfExists(petJsonUrl);
                runtime.assetManifestCache.set(cacheKey, manifestPromise);
            }

            const customManifest = await manifestPromise;
            const manifest = {
                id: `asset-pet-${name}`,
                displayName: name,
                description: 'Pet discovered from data/<user>/assets/pet/<name>.',
                ...(customManifest && typeof customManifest === 'object' ? customManifest : {}),
                spritesheetPath: spriteUrl,
            };

            pets.push({
                key: `asset:${name}`,
                label: `${manifest.displayName || name} — user pet`,
                type: 'asset',
                folder: name,
                assetPath: rawPath,
                spriteUrl,
                manifest,
            });
        }

        return pets.sort((a, b) => a.label.localeCompare(b.label));
    } catch (error) {
        console.warn('[Codex Pet] Failed scanning data/<user>/assets/pet', error);
        return [];
    }
}

function findMatchingAssetPetForCharacter(character) {
    if (!character) {
        return null;
    }

    const names = new Set([
        character.name,
        character.avatar,
        characterSpriteFolder(character),
        String(characterSpriteFolder(character)).split('/').pop(),
    ].map(normalizePetMatchName).filter(Boolean));

    return runtime.petCatalog.find(pet => {
        if (pet.type !== 'asset') {
            return false;
        }
        const candidates = [pet.folder, pet.manifest?.id, pet.manifest?.displayName]
            .map(normalizePetMatchName)
            .filter(Boolean);
        return candidates.some(name => names.has(name));
    }) || null;
}

function currentPetCharacter() {
    const context = getContext();
    if (context.groupId && Array.isArray(context.chat)) {
        for (let i = context.chat.length - 1; i >= 0; i--) {
            const message = context.chat[i];
            if (!message || message.is_user) continue;
            const avatar = message.original_avatar || resolveAvatarFromForceAvatar(context, message.force_avatar);
            if (!avatar) continue;
            const character = context.characters?.find(item => item.avatar === avatar);
            if (character) return character;
        }
    }
    return context.characters?.[context.characterId] || null;
}

async function discoverPetCatalog(force = false) {
    if (force) {
        runtime.petDiscoveryCache.clear();
        runtime.assetManifestCache.clear();
    }

    const context = getContext();
    const builtins = [{ key: 'builtin:lumi', label: 'Lumi (included)', type: 'builtin' }];
    const characters = Array.isArray(context.characters) ? context.characters.filter(char => char?.avatar) : [];
    const detectedCharacters = [];
    const queue = [...characters];
    const workerCount = Math.min(8, queue.length);

    const [, assetPets] = await Promise.all([
        Promise.all(Array.from({ length: workerCount }, async () => {
            while (queue.length) {
                const character = queue.shift();
                const pet = await findCharacterSpritesheet(character);
                if (pet) detectedCharacters.push(pet);
            }
        })),
        discoverUserAssetPets(force),
    ]);

    detectedCharacters.sort((a, b) => a.label.localeCompare(b.label));
    runtime.petCatalog = [...builtins, ...assetPets, ...detectedCharacters];
    populatePetSelect();
    return runtime.petCatalog;
}

async function resolveSelectedPet() {
    const settings = getSettings();
    const selection = settings.petSelection || 'auto';

    if (selection === 'auto') {
        const current = currentPetCharacter();
        if (current) {
            const pet = await findCharacterSpritesheet(current);
            if (pet) return pet;
            const assetPet = findMatchingAssetPetForCharacter(current);
            if (assetPet) return assetPet;
        }
        return { key: 'builtin:lumi', label: 'Lumi (included)', type: 'builtin' };
    }

    if (selection === 'builtin:lumi') {
        return { key: 'builtin:lumi', label: 'Lumi (included)', type: 'builtin' };
    }

    if (selection.startsWith('asset:')) {
        const existing = runtime.petCatalog.find(item => item.key === selection);
        if (existing) return existing;
    }

    if (selection.startsWith('character:')) {
        const folder = selection.slice('character:'.length);
        const existing = runtime.petCatalog.find(item => item.key === selection);
        if (existing) return existing;
        const context = getContext();
        const character = context.characters?.find(item => characterSpriteFolder(item) === folder);
        if (character) {
            const pet = await findCharacterSpritesheet(character);
            if (pet) return pet;
        }
    }

    return { key: 'builtin:lumi', label: 'Lumi (included)', type: 'builtin' };
}

async function loadPetDefinition(force = false) {
    if (runtime.petReloadPromise && !force) return runtime.petReloadPromise;

    runtime.petReloadPromise = (async () => {
        const source = await resolveSelectedPet();
        if (!force && runtime.loadedPetKey === source.key && runtime.spriteUrl) return;

        let manifest;
        let spriteUrl;
        if (source.type === 'character' || source.type === 'asset') {
            manifest = source.manifest;
            spriteUrl = source.spriteUrl;
        } else {
            const petMeta = BUILTIN_PETS.lumi;
            const response = await fetch(petMeta.manifestUrl);
            if (!response.ok) throw new Error(`Failed to load pet manifest: ${response.status}`);
            manifest = await response.json();
            spriteUrl = new URL(manifest.spritesheetPath || 'spritesheet.webp', petMeta.manifestUrl).href;
        }

        const frame = manifest.frame || { width: 192, height: 208, columns: 8, rows: 9 };
        const image = await loadImage(spriteUrl);
        const grid = detectSpritesheetGrid(image, Number(frame.columns) || 8, Number(frame.rows) || 9, manifest.frame || null);
        const sourceCellWidth = image.naturalWidth / grid.columns;
        const sourceCellHeight = image.naturalHeight / grid.rows;
        const nominalWidth = Number(frame.width) || 192;
        const inferredHeight = Math.round(nominalWidth * sourceCellHeight / sourceCellWidth);

        runtime.manifest = manifest;
        runtime.animations = normalizeAnimations(manifest.animations || {});
        runtime.frameWidth = nominalWidth;
        runtime.frameHeight = Number(frame.height) && manifest.frame ? Number(frame.height) : inferredHeight;
        runtime.columns = grid.columns;
        runtime.rows = grid.rows;
        runtime.spriteUrl = spriteUrl;
        runtime.loadedPetKey = source.key;

        console.info(`[Codex Pet] Loaded ${source.key}; grid ${grid.columns}x${grid.rows} (${grid.method}); normalized frame ${runtime.frameWidth}x${runtime.frameHeight}`);
        if (runtime.petEl) {
            applySpriteSheetStyle();
            runtime.x = clampX(runtime.x);
            runtime.y = clampY(runtime.y);
            requestPlatformRefresh();
        }
        populatePetSelect();
    })();

    try {
        await runtime.petReloadPromise;
    } finally {
        runtime.petReloadPromise = null;
    }
}

async function ensureDom() {
    if (runtime.root) {
        return;
    }

    const root = document.createElement('div');
    root.id = DOM_IDS.root;
    root.innerHTML = `
        <div id="${DOM_IDS.debug}" class="codex-pet-debug"></div>
        <div id="${DOM_IDS.pet}" class="codex-pet-actor" title="Drag pet">
            <div id="${DOM_IDS.bubble}" class="codex-pet-bubble"></div>
            <div id="${DOM_IDS.sprite}" class="codex-pet-sprite"></div>
        </div>
    `;

    document.body.appendChild(root);
    runtime.root = root;
    runtime.petEl = /** @type {HTMLElement} */ (root.querySelector(`#${DOM_IDS.pet}`));
    runtime.spriteEl = /** @type {HTMLElement} */ (root.querySelector(`#${DOM_IDS.sprite}`));
    runtime.bubbleEl = /** @type {HTMLElement} */ (root.querySelector(`#${DOM_IDS.bubble}`));
    runtime.debugEl = /** @type {HTMLElement} */ (root.querySelector(`#${DOM_IDS.debug}`));

    bindPointerHandlers();
}

function applySpriteSheetStyle() {
    const width = petWidth();
    const height = petHeight();
    runtime.petEl.style.width = `${width}px`;
    runtime.petEl.style.height = `${height}px`;
    runtime.spriteEl.style.width = `${width}px`;
    runtime.spriteEl.style.height = `${height}px`;
    runtime.spriteEl.style.backgroundImage = `url("${runtime.spriteUrl}")`;
    runtime.spriteEl.style.backgroundSize = `${runtime.columns * width}px ${runtime.rows * height}px`;
}

function getAnimationTrack(name) {
    return runtime.animations?.[name] || runtime.animations?.idle || idleAnimation();
}

function animationTotalDuration(track) {
    return track.frames.reduce((sum, frame) => sum + frame.duration, 0);
}

function frameAtElapsed(track, elapsedMs) {
    if (!track?.frames?.length) {
        return null;
    }

    if (track.frames.length === 1) {
        return track.frames[0];
    }

    let effectiveElapsed = elapsedMs;
    const total = animationTotalDuration(track);

    if (typeof track.loopStart === 'number' && track.loopStart >= 0 && track.loopStart < track.frames.length) {
        const prefix = track.frames.slice(0, track.loopStart).reduce((sum, frame) => sum + frame.duration, 0);
        const loopFrames = track.frames.slice(track.loopStart);
        const loopDuration = loopFrames.reduce((sum, frame) => sum + frame.duration, 0);

        if (elapsedMs >= total && loopDuration > 0) {
            effectiveElapsed = prefix + ((elapsedMs - prefix) % loopDuration);
        }
    } else if (elapsedMs >= total) {
        return track.frames[track.frames.length - 1];
    }

    let remaining = effectiveElapsed;
    for (const frame of track.frames) {
        if (remaining < frame.duration) {
            return frame;
        }
        remaining -= frame.duration;
    }

    return track.frames[track.frames.length - 1];
}

function playTemporaryAnimation(name, durationMs = 2200, options = {}) {
    const now = performance.now();
    runtime.temporaryAnimation = {
        name,
        startedAt: now,
        until: now + durationMs,
        sticky: Boolean(options.sticky),
        bubble: options.bubble || '',
    };

    if (options.bubble) {
        showBubble(options.bubble, durationMs);
    }

    if (name === 'bounce' && runtime.grounded && !runtime.dragging) {
        runtime.vy = -PHYSICS.jumpVelocity * 0.72;
        runtime.grounded = false;
        runtime.currentPlatformId = null;
    }
}

function clearTemporaryAnimationIfExpired(now) {
    if (!runtime.temporaryAnimation) {
        return;
    }

    if (!runtime.temporaryAnimation.sticky && now >= runtime.temporaryAnimation.until) {
        runtime.temporaryAnimation = null;
    }
}

function clampX(x) {
    return Math.max(0, Math.min(window.innerWidth - petWidth(), x));
}

function clampY(y) {
    return Math.max(0, Math.min(window.innerHeight - petHeight(), y));
}

function getCurrentAnimationName(now) {
    clearTemporaryAnimationIfExpired(now);

    if (runtime.dragging) {
        return 'idle';
    }

    if (runtime.temporaryAnimation) {
        return runtime.temporaryAnimation.name;
    }

    if (!runtime.grounded) {
        return 'jumping';
    }

    if (runtime.generating) {
        return runtime.facing < 0 ? 'running-left' : 'running-right';
    }

    if (runtime.currentBehavior.type === 'run') {
        return runtime.facing < 0 ? 'running-left' : 'running-right';
    }

    if (runtime.currentBehavior.type === 'walk') {
        return runtime.facing < 0 ? 'move_left' : 'move_right';
    }

    return 'idle';
}


function canUseCursorTrackingFrames() {
    // Lumi's extended v2 atlas has two extra 8-frame rows (indices 72..87)
    // specifically authored as a 16-direction standing/look-around ring.
    return runtime.columns >= 8 && runtime.rows >= 11 && runtime.frameWidth > 0 && runtime.frameHeight > 0;
}

function getActiveAttentionTarget(now = performance.now()) {
    const target = runtime.attentionTarget;
    if (!target) {
        return null;
    }

    if (now > target.until) {
        runtime.attentionTarget = null;
        return null;
    }

    return target;
}

function setAttentionTarget(x, y, durationMs = 2200) {
    runtime.attentionTarget = {
        x,
        y,
        until: performance.now() + durationMs,
    };

    if (!canUseCursorTrackingFrames()) {
        runtime.facing = x >= (runtime.x + petWidth() * 0.5) ? 1 : -1;
    }
}

function shouldTrackCursor() {
    const settings = getSettings();
    const hasAttentionTarget = Boolean(getActiveAttentionTarget());
    return canUseCursorTrackingFrames()
        && runtime.grounded
        && !runtime.dragging
        && !runtime.temporaryAnimation
        && Math.abs(runtime.vx) < 0.01
        && ((settings.cursorTrackingEnabled
            && runtime.pointer.seen
            && !runtime.generating
            && runtime.currentBehavior.type === 'track')
            || hasAttentionTarget);
}

function cursorTrackingSpriteIndex() {
    const petCenterX = runtime.x + petWidth() * 0.5;
    const petLookOriginY = runtime.y + petHeight() * 0.34;
    const target = getActiveAttentionTarget();
    const targetX = target?.x ?? runtime.pointer.x;
    const targetY = target?.y ?? runtime.pointer.y;
    const dx = targetX - petCenterX;
    const dy = targetY - petLookOriginY;

    // Frames 72..87 form one clockwise 16-direction ring. Empirically, frame
    // 77 points right, 73 points up, 81 points down and 85 points left.
    const angle = Math.atan2(dy, dx);
    const step = (Math.PI * 2) / 16;
    let slot = Math.round(angle / step + 5) % 16;
    if (slot < 0) slot += 16;
    return 72 + slot;
}

function toastContainerElement() {
    return document.getElementById('toast-container');
}

function positionToastContainer() {
    const settings = getSettings();
    const container = toastContainerElement();
    if (!settings.enabled || !container || container.children.length === 0 || !runtime.petEl) {
        return;
    }

    container.style.position = 'fixed';
    container.style.right = 'auto';
    container.style.bottom = 'auto';
    container.style.pointerEvents = 'auto';
    container.style.zIndex = '4001';

    const headX = runtime.x + petWidth() * 0.66;
    const headY = runtime.y + petHeight() * 0.16;
    const rect = container.getBoundingClientRect();
    let left = headX + Math.max(10, petWidth() * 0.08);
    let top = headY - rect.height - 10;

    left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, top));

    container.style.left = `${Math.round(left)}px`;
    container.style.top = `${Math.round(top)}px`;

    const duration = 2200;
    const targetX = left + Math.min(rect.width * 0.35, 72);
    const targetY = top + Math.min(rect.height * 0.45, 48);
    setAttentionTarget(targetX, targetY, duration);

    if (!runtime.dragging) {
        runtime.temporaryAnimation = null;
        runtime.vx = 0;
        if (runtime.grounded) {
            startCursorTrack(duration);
            runtime.nextIdleDecisionAt = performance.now() + duration;
        }
    }
}

function onToastShown() {
    window.setTimeout(() => positionToastContainer(), 0);
    window.setTimeout(() => positionToastContainer(), 32);
}

function installToastrHooks() {
    if (runtime.toastHooksInstalled || !window.toastr) {
        return;
    }

    runtime.toastHooksInstalled = true;

    for (const method of ['error', 'warning', 'info', 'success']) {
        const original = window.toastr[method];
        if (typeof original !== 'function' || original.__codexPetWrapped) {
            continue;
        }

        const wrapped = function (...args) {
            const result = original.apply(this, args);
            onToastShown();
            return result;
        };

        wrapped.__codexPetWrapped = true;
        window.toastr[method] = wrapped;
    }
}

function renderPet(ts) {
    if (!runtime.root || !runtime.petEl || !runtime.spriteEl) {
        return;
    }

    const settings = getSettings();
    runtime.root.classList.toggle('codex-pet-hidden', !settings.enabled);
    runtime.root.classList.toggle('codex-pet-debug-visible', settings.showDebugPlatforms);

    if (!settings.enabled) {
        return;
    }

    const trackingCursor = shouldTrackCursor();
    const animationName = trackingCursor ? 'cursor-track' : getCurrentAnimationName(ts);
    if (runtime.animationState.name !== animationName) {
        runtime.animationState = { name: animationName, startedAt: ts };
    }

    let spriteIndex;
    if (trackingCursor) {
        spriteIndex = cursorTrackingSpriteIndex();
    } else {
        const track = getAnimationTrack(animationName);
        const startedAt = runtime.temporaryAnimation?.startedAt ?? runtime.animationState.startedAt ?? ts;
        const frame = frameAtElapsed(track, Math.max(0, ts - startedAt)) || { spriteIndex: 0 };
        spriteIndex = frame.spriteIndex;
    }

    const column = spriteIndex % runtime.columns;
    const row = Math.floor(spriteIndex / runtime.columns);
    const width = petWidth();
    const height = petHeight();

    runtime.petEl.style.transform = `translate(${Math.round(runtime.x)}px, ${Math.round(runtime.y)}px)`;
    runtime.petEl.dataset.state = animationName;
    runtime.petEl.dataset.facing = runtime.facing < 0 ? 'left' : 'right';
    runtime.spriteEl.style.backgroundPosition = `${-column * width}px ${-row * height}px`;

    const shouldMirror = runtime.facing < 0
        && MIRRORABLE_SINGLE_DIRECTION_ANIMATIONS.has(animationName)
        && !DIRECTIONAL_ANIMATIONS.has(animationName);
    runtime.spriteEl.style.transform = shouldMirror ? 'scaleX(-1)' : 'none';
}

function makeViewportFloorPlatform() {
    const settings = getSettings();
    return {
        id: 'viewport-floor',
        left: 0,
        right: window.innerWidth,
        top: window.innerHeight - settings.floorOffset,
        bottom: window.innerHeight,
        source: 'floor',
    };
}

function makePlatformId(element) {
    if (!runtime.platformIds.has(element)) {
        const base = element.id || element.dataset.petPlatformId || element.dataset.petPlatform || element.tagName.toLowerCase();
        runtime.platformIds.set(element, `${base}-${runtime.nextPlatformOrdinal++}`);
    }
    return runtime.platformIds.get(element);
}

function isVisiblePlatformElement(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width >= 24
        && rect.height >= 6
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) > 0
        && rect.bottom >= 0
        && rect.right >= 0
        && rect.left <= window.innerWidth
        && rect.top <= window.innerHeight;
}

function cssColorAlpha(value) {
    if (!value || value === 'transparent') {
        return 0;
    }

    const rgba = value.match(/rgba?\(([^)]+)\)/i);
    if (!rgba) {
        return 1;
    }

    const parts = rgba[1].split(',').map(x => x.trim());
    if (parts.length < 4) {
        return 1;
    }

    const alpha = Number(parts[3]);
    return Number.isFinite(alpha) ? alpha : 1;
}

function autoPlatformScore(element, rect, style) {
    if (runtime.root?.contains(element)) {
        return -Infinity;
    }

    const minWidth = Math.max(48, petWidth() * 0.55);
    if (rect.width < minWidth || rect.height < 8) {
        return -Infinity;
    }

    // Full-page structural wrappers are poor platforms: their top edge is usually a
    // layout boundary, not a visible ledge the user perceives as solid.
    if (rect.width > window.innerWidth * 0.92 && rect.height > window.innerHeight * 0.68) {
        return -Infinity;
    }

    if (style.pointerEvents === 'none' || style.display === 'contents') {
        return -Infinity;
    }

    let score = 0;
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
    if (borderTop >= 1 || borderBottom >= 1) score += 2;
    if (cssColorAlpha(style.backgroundColor) > 0.025) score += 1.5;
    if (style.backgroundImage && style.backgroundImage !== 'none') score += 1;
    if (style.boxShadow && style.boxShadow !== 'none') score += 1;
    if (style.backdropFilter && style.backdropFilter !== 'none') score += 0.75;
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') score += 0.5;

    const semanticText = `${element.id} ${element.className} ${element.getAttribute('role') || ''}`.toLowerCase();
    if (/(panel|drawer|toolbar|header|footer|form|sheld|menu|popup|dialog|window|bar)/.test(semanticText)) {
        score += 1;
    }

    // Tiny nested controls should not become a staircase of button-sized ledges.
    if (rect.width < petWidth() * 0.85 && score < 2.5) {
        return -Infinity;
    }

    return score;
}

function collectAutoDetectedPlatforms() {
    if (!getSettings().autoDetectPlatforms) {
        return [];
    }

    const elements = document.querySelectorAll('div, form, section, aside, nav, header, footer, main, article');
    const scored = [];

    for (const element of elements) {
        if (!(element instanceof HTMLElement) || !isVisiblePlatformElement(element)) {
            continue;
        }

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const score = autoPlatformScore(element, rect, style);
        if (score < 1.5) {
            continue;
        }

        scored.push({
            id: makePlatformId(element),
            left: Math.max(0, rect.left),
            right: Math.min(window.innerWidth, rect.right),
            top: rect.top,
            bottom: rect.bottom,
            source: 'auto',
            priority: 1,
            score,
            element,
        });
    }

    // Prefer stronger, smaller visible surfaces when nested divs share practically
    // the same top edge. This avoids treating every ancestor wrapper as a platform.
    scored.sort((a, b) => b.score - a.score || (a.right - a.left) - (b.right - b.left));
    const accepted = [];
    for (const candidate of scored) {
        const duplicate = accepted.some(existing => {
            const sameTop = Math.abs(existing.top - candidate.top) <= 3;
            const overlap = Math.max(0, Math.min(existing.right, candidate.right) - Math.max(existing.left, candidate.left));
            const smallerWidth = Math.min(existing.right - existing.left, candidate.right - candidate.left);
            return sameTop && smallerWidth > 0 && overlap / smallerWidth > 0.82;
        });
        if (!duplicate) {
            accepted.push(candidate);
        }
        if (accepted.length >= 80) {
            break;
        }
    }

    return accepted;
}

function elementSurfaceScore(element, rect, style, explicit) {
    if (explicit) return 100;
    if (!getSettings().autoDetectPlatforms) return 0;
    if (runtime.root?.contains(element)) return 0;
    if (element.closest?.('#extensions_settings, #extensions_settings2, .popup, .drawer-content[data-popup]')) return 0;

    const idClass = `${element.id || ''} ${element.className || ''}`.toLowerCase();
    if (/\b(mes|mes_text|avatar|expression-holder|swipe_right|swipe_left)\b/.test(idClass)) return 0;

    const viewportArea = window.innerWidth * window.innerHeight;
    if (rect.width * rect.height > viewportArea * 0.82 && rect.top < 12) return 0;

    let score = 0;
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    if (borderTop >= 1) score += 5;
    if (borderBottom >= 1) score += 1;

    const bgAlpha = alphaOfCssColor(style.backgroundColor);
    const parentBgAlpha = element.parentElement ? alphaOfCssColor(getComputedStyle(element.parentElement).backgroundColor) : 0;
    if (bgAlpha > 0.04 && (parentBgAlpha <= 0.04 || style.backgroundColor !== getComputedStyle(element.parentElement).backgroundColor)) score += 3;
    if (style.boxShadow && style.boxShadow !== 'none') score += 2;
    if (['fixed', 'sticky'].includes(style.position)) score += 2;
    if (/(panel|bar|form|header|footer|drawer|nav|sheld|chat|menu|controls|input|composer|toolbar)/.test(idClass)) score += 4;
    if (['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowY) || ['auto', 'scroll', 'hidden', 'clip'].includes(style.overflow)) score += 1;
    if (rect.height >= 12 && rect.height <= 360) score += 1;
    return score;
}

function isSurfaceExposed(element, rect) {
    const y = Math.max(0, Math.min(window.innerHeight - 1, rect.top + 2));
    const inset = Math.min(16, Math.max(2, rect.width * 0.08));
    const probes = [
        rect.left + inset,
        rect.left + rect.width / 2,
        rect.right - inset,
    ].map(x => Math.max(0, Math.min(window.innerWidth - 1, x)));

    return probes.some(x => {
        const stack = document.elementsFromPoint(x, y);
        return stack.some(hit => hit === element || element.contains(hit));
    });
}

function maybeAddPlatform(platforms, element, source, explicit = false) {
    if (!(element instanceof HTMLElement) || !isVisiblePlatformElement(element)) return;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    if (rect.width < Math.max(48, petWidth() * 0.55)) return;
    if (!explicit && !isSurfaceExposed(element, rect)) return;
    const score = elementSurfaceScore(element, rect, style, explicit);
    if (score < 4) return;

    const left = Math.max(0, rect.left);
    const right = Math.min(window.innerWidth, rect.right);
    const elementId = makePlatformId(element);

    platforms.push({
        id: elementId,
        left,
        right,
        top: rect.top,
        bottom: rect.bottom,
        source,
        score,
        element,
        edge: 'top',
    });

    // Optional second one-way surface at the DIV's lower edge. It uses the
    // exact same landing/edge logic as a normal top surface; only its Y is the
    // element's bottom border. Restrict it to DIVs as requested so forms,
    // headers, etc. do not unexpectedly gain an extra ledge.
    if (getSettings().divBottomPlatformsEnabled
        && element.tagName === 'DIV'
        && rect.bottom > 0
        && rect.bottom < window.innerHeight) {
        platforms.push({
            id: `${elementId}::bottom`,
            left,
            right,
            top: rect.bottom,
            bottom: rect.bottom,
            source: `${source}:bottom`,
            score: Math.max(0, score - 0.25),
            element,
            edge: 'bottom',
        });
    }
}

function collectPlatforms() {
    const settings = getSettings();
    const platforms = [makeViewportFloorPlatform()];
    const explicitElements = new Set();

    if (settings.platformsEnabled) {
        for (const selector of [...new Set(settings.platformSelectors.filter(Boolean))]) {
            let elements = [];
            try {
                elements = Array.from(document.querySelectorAll(selector));
            } catch (error) {
                console.warn(`[Codex Pet] Invalid platform selector: ${selector}`, error);
                continue;
            }
            for (const element of elements) {
                explicitElements.add(element);
                maybeAddPlatform(platforms, element, selector, true);
            }
        }
    }

    if (settings.platformsEnabled && settings.autoDetectPlatforms) {
        const candidates = document.querySelectorAll('div, section, nav, main, aside, header, footer, form');
        for (const element of candidates) {
            if (explicitElements.has(element)) continue;
            maybeAddPlatform(platforms, element, 'auto', false);
        }
    }

    const sorted = platforms.sort((a, b) => (b.score || 0) - (a.score || 0));
    const deduped = [];
    for (const platform of sorted) {
        const duplicate = deduped.some(existing =>
            Math.abs(existing.top - platform.top) <= 3
            && Math.abs(existing.left - platform.left) <= 5
            && Math.abs(existing.right - platform.right) <= 5);
        if (!duplicate) deduped.push(platform);
    }

    return deduped.sort((a, b) => a.top - b.top || a.left - b.left);
}

function requestPlatformRefresh() {
    runtime.refreshPlatformsRequested = true;
}

function refreshPlatforms(force = false) {
    const now = performance.now();
    if (!force && !runtime.refreshPlatformsRequested && (now - runtime.lastPlatformRefreshAt) < PHYSICS.platformRefreshMs) {
        return;
    }

    runtime.platforms = collectPlatforms();
    runtime.lastPlatformRefreshAt = now;
    runtime.refreshPlatformsRequested = false;

    if (getSettings().showDebugPlatforms) {
        renderPlatformDebug();
    }
}

function renderPlatformDebug() {
    if (!runtime.debugEl) {
        return;
    }

    runtime.debugEl.innerHTML = '';
    const frag = document.createDocumentFragment();

    for (const platform of runtime.platforms) {
        const line = document.createElement('div');
        line.className = 'codex-pet-platform-line';
        line.style.left = `${platform.left}px`;
        line.style.top = `${platform.top}px`;
        line.style.width = `${Math.max(8, platform.right - platform.left)}px`;
        line.title = platform.source || platform.id;
        frag.appendChild(line);
    }

    runtime.debugEl.appendChild(frag);
}

function getPlatformById(id) {
    return runtime.platforms.find(platform => platform.id === id) || null;
}

function platformSupportsPosition(platform, x, y) {
    if (!platform) {
        return false;
    }

    const centerX = x + petWidth() / 2;
    const feetY = y + petHeight();
    return centerX >= platform.left && centerX <= platform.right && Math.abs(feetY - platform.top) <= 6;
}

function findLandingPlatform(previousFeetY, nextFeetY, x) {
    const left = x + 8;
    const right = x + petWidth() - 8;
    return runtime.platforms
        .filter(platform => previousFeetY <= platform.top && nextFeetY >= platform.top && right > platform.left && left < platform.right)
        .sort((a, b) => a.top - b.top || (b.priority || 0) - (a.priority || 0) || (a.right - a.left) - (b.right - b.left))[0] || null;
}

function snapToPlatform(platform) {
    if (!platform) {
        return;
    }

    runtime.y = platform.top - petHeight();
    runtime.vy = 0;
    runtime.grounded = true;
    runtime.currentPlatformId = platform.id;
    runtime.jumpTargetId = null;
    runtime.airborneVx = null;
}

function snapDraggedPetToNearestSurface() {
    refreshPlatforms(true);
    const left = runtime.x + 8;
    const right = runtime.x + petWidth() - 8;
    const feetY = runtime.y + petHeight();
    const maxSnapDistance = Math.max(42, petHeight() * 0.55);
    const candidate = runtime.platforms
        .filter(platform => right > platform.left && left < platform.right)
        .map(platform => ({ platform, distance: platform.top - feetY }))
        .filter(item => Math.abs(item.distance) <= maxSnapDistance)
        .sort((a, b) => Math.abs(a.distance) - Math.abs(b.distance) || (b.platform.score || 0) - (a.platform.score || 0))[0];

    if (candidate) {
        snapToPlatform(candidate.platform);
        return true;
    }
    return false;
}

function maybeRestoreGroundSupport() {
    const currentPlatform = getPlatformById(runtime.currentPlatformId);
    if (platformSupportsPosition(currentPlatform, runtime.x, runtime.y)) {
        runtime.grounded = true;
        runtime.y = currentPlatform.top - petHeight();
        runtime.vy = 0;
        return true;
    }

    runtime.grounded = false;
    return false;
}

function findNearestPlatformBelow() {
    const feetY = runtime.y + petHeight();
    const centerX = runtime.x + petWidth() / 2;

    return runtime.platforms
        .filter(platform => centerX >= platform.left && centerX <= platform.right && platform.top >= feetY - 4)
        .sort((a, b) => a.top - b.top)[0] || null;
}


function platformJumpFlightTime(verticalDelta, jumpVelocity = PHYSICS.jumpVelocity) {
    // Feet travel from the current platform top to the target platform top.
    // y(t) = -v*t + 0.5*g*t^2, where positive y is downward.
    const v = jumpVelocity;
    const discriminant = (v * v) + (2 * PHYSICS.gravity * verticalDelta);
    if (discriminant < 0) {
        return null;
    }

    return (v + Math.sqrt(discriminant)) / PHYSICS.gravity;
}

function jumpTargetX(platform) {
    const width = petWidth();
    const currentCenter = runtime.x + width * 0.5;
    const inset = Math.min(28, Math.max(10, width * 0.20));
    const minCenter = platform.left + inset;
    const maxCenter = platform.right - inset;

    if (maxCenter <= minCenter) {
        return (platform.left + platform.right) * 0.5;
    }

    return Math.max(minCenter, Math.min(maxCenter, currentCenter));
}

function findReachableJumpPlatform(direction = 0, options = {}) {
    if (!runtime.grounded) {
        return null;
    }

    refreshPlatforms(true);
    const currentPlatform = getPlatformById(runtime.currentPlatformId) || makeViewportFloorPlatform();
    const currentTop = currentPlatform.top;
    const currentCenter = runtime.x + petWidth() * 0.5;
    const jumpVelocity = Number(options.jumpVelocity) || PHYSICS.jumpVelocity;
    const lowerOnly = Boolean(options.lowerOnly);
    const maximumRise = ((jumpVelocity * jumpVelocity) / (2 * PHYSICS.gravity))
        * PHYSICS.platformJumpSafety;

    const candidates = [];
    for (const platform of runtime.platforms) {
        if (!platform || platform.id === currentPlatform.id) {
            continue;
        }

        const verticalDelta = platform.top - currentTop;
        if (lowerOnly && verticalDelta <= 10) {
            continue;
        }

        if (verticalDelta < -maximumRise) {
            continue;
        }

        // Lower platforms are valid intentional jump targets too. Limit only
        // absurd off-screen drops; normal one-way landing handles the descent.
        if (verticalDelta > Math.max(window.innerHeight * 0.72, petHeight() * 5.0)) {
            continue;
        }

        const flightTime = platformJumpFlightTime(verticalDelta, jumpVelocity);
        if (!flightTime || flightTime < 0.18 || flightTime > 2.35) {
            continue;
        }

        const targetCenter = jumpTargetX(platform);
        const dx = targetCenter - currentCenter;
        const requiredSpeed = Math.abs(dx) / flightTime;
        if (requiredSpeed > PHYSICS.maxPlatformJumpSpeed) {
            continue;
        }

        if (direction && Math.abs(dx) > 8 && Math.sign(dx) !== Math.sign(direction)) {
            continue;
        }

        // Reject a nearly identical surface that would look like a jump in place.
        if (Math.abs(verticalDelta) < 5 && Math.abs(dx) < 18) {
            continue;
        }

        let score = 0;
        const pointerActive = runtime.pointer.seen && !getActiveAttentionTarget();
        const cursorDx = pointerActive ? runtime.pointer.x - targetCenter : 0;
        const cursorDy = pointerActive ? runtime.pointer.y - platform.top : 0;

        if (verticalDelta < -10) score += 55; // Climb.
        else if (Math.abs(verticalDelta) <= 10) score += 40;
        else score += 38; // Down-jumps are first-class targets now.

        score += Math.max(0, 45 - Math.abs(dx) * 0.16);
        score += Math.max(0, 30 - Math.abs(verticalDelta) * 0.07);
        if (direction && Math.sign(dx || direction) === Math.sign(direction)) score += 20;
        if (platform.id !== 'viewport-floor') score += 12;

        // When the pet is active, choose platforms that move it toward the
        // cursor. This also makes it deliberately jump down when the cursor is
        // below the current ledge.
        if (pointerActive) {
            score += Math.max(0, 85 - Math.abs(cursorDx) * 0.20);
            score += Math.max(0, 50 - Math.abs(cursorDy) * 0.08);
            if (runtime.pointer.y > currentTop + 24 && verticalDelta > 10) score += 55;
            if (runtime.pointer.y < currentTop - 24 && verticalDelta < -10) score += 40;
        }

        candidates.push({
            platform,
            targetCenter,
            dx,
            flightTime,
            requiredSpeed,
            score,
        });
    }

    if (!candidates.length) {
        return null;
    }

    candidates.sort((a, b) => b.score - a.score);

    // Cursor-directed down jumps should be deterministic: take the best lower
    // platform instead of randomly choosing among several ledges.
    if (lowerOnly) {
        return candidates[0];
    }

    const shortlist = candidates.slice(0, Math.min(4, candidates.length));
    return shortlist[Math.floor(Math.random() * shortlist.length)];
}

function startJump(verticalVelocity = PHYSICS.jumpVelocity, horizontalVelocity = 0, targetPlatformId = null, ignoreCooldown = false) {
    const now = performance.now();
    if (!runtime.grounded || runtime.dragging) {
        return false;
    }

    if (!ignoreCooldown && now < runtime.nextJumpAllowedAt) {
        return false;
    }

    runtime.nextJumpAllowedAt = now + randomBetween(PHYSICS.jumpCooldownMin, PHYSICS.jumpCooldownMax);
    runtime.jumpTargetId = targetPlatformId;
    runtime.airborneVx = horizontalVelocity;
    runtime.vx = horizontalVelocity;
    runtime.vy = -verticalVelocity;
    runtime.grounded = false;
    runtime.currentPlatformId = null;

    if (Math.abs(horizontalVelocity) > 1) {
        runtime.facing = horizontalVelocity < 0 ? -1 : 1;
    }

    const duration = 1450;
    runtime.currentBehavior = {
        type: 'jump',
        direction: runtime.facing,
        until: now + duration,
    };
    playTemporaryAnimation('jumping', duration);
    return true;
}

function tryPlatformJump(direction = 0, ignoreCooldown = false, options = {}) {
    if (!ignoreCooldown && performance.now() < runtime.nextJumpAllowedAt) {
        return false;
    }

    const jumpVelocity = Number(options.jumpVelocity) || PHYSICS.jumpVelocity;
    const target = findReachableJumpPlatform(direction, {
        lowerOnly: Boolean(options.lowerOnly),
        jumpVelocity,
    });
    if (!target) {
        return false;
    }

    const vx = target.dx / target.flightTime;
    return startJump(jumpVelocity, vx, target.platform.id, ignoreCooldown);
}

function tryJumpDownTowardCursor(direction = 0) {
    return tryPlatformJump(direction, false, {
        lowerOnly: true,
        jumpVelocity: PHYSICS.downJumpVelocity,
    });
}


function cursorPursuitDirection() {
    if (!runtime.pointer.seen || getActiveAttentionTarget()) {
        return 0;
    }

    const petCenterX = runtime.x + petWidth() * 0.5;
    const dx = runtime.pointer.x - petCenterX;
    const deadZone = Math.max(18, petWidth() * 0.16);

    if (Math.abs(dx) <= deadZone) {
        return 0;
    }

    return dx < 0 ? -1 : 1;
}

function cursorIsWellBelowPet() {
    if (!runtime.pointer.seen || getActiveAttentionTarget()) {
        return false;
    }

    const feetY = runtime.y + petHeight();
    return runtime.pointer.y > feetY + Math.max(28, petHeight() * 0.20);
}

function pursueCursorWhileActive() {
    if (!runtime.pointer.seen || runtime.dragging || getActiveAttentionTarget()) {
        return;
    }

    // "Idle" means no chase. Any locomotion state should instead try to close
    // the horizontal distance to the pointer.
    if (!['walk', 'run', 'jump'].includes(runtime.currentBehavior.type) && !runtime.generating) {
        return;
    }

    const direction = cursorPursuitDirection();
    if (direction) {
        runtime.facing = direction;
        runtime.currentBehavior.direction = direction;
    }

    // If the cursor is below the pet while it is active, deliberately jump
    // down toward a lower reachable platform. Cooldown still prevents bounce spam.
    if (runtime.grounded
        && cursorIsWellBelowPet()
        && performance.now() >= runtime.nextJumpAllowedAt) {
        tryJumpDownTowardCursor(direction || runtime.facing || 0);
    }
}

function startWalk(direction = 1, durationMs = randomBetween(850, 1800), speed = PHYSICS.idleWalkSpeed) {
    const now = performance.now();
    runtime.currentBehavior = {
        type: 'walk',
        direction,
        until: now + durationMs,
    };
    runtime.facing = direction;
    runtime.vx = direction * speed;
}

function startRun(direction = 1, durationMs = randomBetween(900, 1700), speed = PHYSICS.activeRunSpeed) {
    const now = performance.now();
    runtime.currentBehavior = {
        type: 'run',
        direction,
        until: now + durationMs,
    };
    runtime.facing = direction;
    runtime.vx = direction * speed;
}

function startIdle(durationMs = randomBetween(2600, 5200)) {
    runtime.currentBehavior = {
        type: 'idle',
        direction: runtime.facing,
        until: performance.now() + durationMs,
    };
    runtime.vx = 0;
}

function startCursorTrack(durationMs = randomBetween(2600, 5200)) {
    runtime.currentBehavior = {
        type: 'track',
        direction: runtime.facing,
        until: performance.now() + durationMs,
    };
    runtime.vx = 0;
}

function tryHop() {
    if (!runtime.grounded) {
        return false;
    }

    // Prefer a useful jump to another reachable platform. If there is no good
    // destination, do a much higher vertical hop than older builds.
    if (tryPlatformJump(runtime.facing || 0)) {
        return true;
    }

    return startJump(PHYSICS.jumpVelocity, runtime.vx * 0.45, null);
}

function chooseIdleBehavior(now) {
    const settings = getSettings();
    const roll = Math.random();

    // Idle behavior weights:
    //   50% — stand and track the cursor (when supported/enabled)
    //   33% — slow walk
    //   17% — ordinary standing idle
    // Disabled/unavailable behaviors fall back to ordinary standing instead of
    // changing the probability of the other action.
    if (roll < 0.50) {
        const duration = randomBetween(2600, 5200);
        if (settings.cursorTrackingEnabled && canUseCursorTrackingFrames()) {
            startCursorTrack(duration);
        } else {
            startIdle(duration);
        }
        runtime.nextIdleDecisionAt = now + duration;
        return;
    }

    if (roll < 0.83) {
        const duration = randomBetween(1800, 4200);
        if (settings.idleRoam) {
            const direction = cursorPursuitDirection() || (Math.random() < 0.5 ? -1 : 1);
            startWalk(direction, duration, PHYSICS.idleWalkSpeed);
        } else {
            startIdle(duration);
        }
        runtime.nextIdleDecisionAt = now + duration;
        return;
    }

    const duration = randomBetween(2600, 5200);
    startIdle(duration);
    runtime.nextIdleDecisionAt = now + duration;
}

function handleBehaviorTimers(now) {
    const attentionTarget = getActiveAttentionTarget(now);
    if (attentionTarget) {
        if (runtime.grounded && !runtime.dragging) {
            runtime.vx = 0;
            if (runtime.currentBehavior.type !== 'track' || now >= runtime.currentBehavior.until) {
                startCursorTrack(Math.max(250, attentionTarget.until - now));
            }
        }
        return;
    }

    if (runtime.generating) {
        // Generation is the energetic state: use the dedicated running animation
        // while preserving calmer walking for optional idle roaming.
        if (runtime.currentBehavior.type !== 'run' || now >= runtime.currentBehavior.until) {
            const direction = cursorPursuitDirection() || runtime.facing || 1;
            startRun(direction, randomBetween(1100, 2200), PHYSICS.activeRunSpeed);
        }

        if (now >= runtime.nextHopAt) {
            if (Math.random() < 0.08) {
                tryHop();
            }
            runtime.nextHopAt = now + randomBetween(PHYSICS.hopIntervalMin, PHYSICS.hopIntervalMax);
        }
        return;
    }

    if (runtime.currentBehavior.until && now > runtime.currentBehavior.until) {
        runtime.currentBehavior = { type: 'idle', until: 0, direction: runtime.facing || 1 };
        runtime.vx = 0;
    }

    if (now >= runtime.nextIdleDecisionAt && !runtime.temporaryAnimation) {
        chooseIdleBehavior(now);
    }
}

function petFootprintBounds(x = runtime.x) {
    const width = petWidth();
    // The sprites include hair/tail transparency far wider than the actual feet.
    // Use a narrow central footprint for ledges, but full sprite bounds for the viewport wall.
    return {
        left: x + width * 0.34,
        right: x + width * 0.66,
    };
}

function reverseDirection() {
    runtime.facing = runtime.facing < 0 ? 1 : -1;
    runtime.vx = Math.abs(runtime.vx || PHYSICS.idleWalkSpeed) * runtime.facing;
    runtime.currentBehavior.direction = runtime.facing;
    runtime.animationState = { name: '', startedAt: 0 };
}

function handleEdge(platform) {
    if (!platform || !runtime.grounded || runtime.vx === 0) {
        return;
    }

    const settings = getSettings();
    const width = petWidth();

    if (platform.id === 'viewport-floor') {
        if (runtime.vx < 0 && runtime.x <= settings.edgePadding) {
            runtime.x = settings.edgePadding;
            reverseDirection();
        } else if (runtime.vx > 0 && runtime.x + width >= window.innerWidth - settings.edgePadding) {
            runtime.x = Math.max(settings.edgePadding, window.innerWidth - width - settings.edgePadding);
            reverseDirection();
        }
        return;
    }

    const footprint = petFootprintBounds();
    if (runtime.vx < 0 && footprint.left <= platform.left + settings.edgePadding) {
        if (!tryPlatformJump(-1)) {
            reverseDirection();
        }
    } else if (runtime.vx > 0 && footprint.right >= platform.right - settings.edgePadding) {
        if (!tryPlatformJump(1)) {
            reverseDirection();
        }
    }
}

function physicsStep(dt) {
    const settings = getSettings();
    if (!settings.enabled || runtime.dragging) {
        return;
    }

    refreshPlatforms();

    if (runtime.grounded) {
        maybeRestoreGroundSupport();
    }

    const currentPlatform = getPlatformById(runtime.currentPlatformId) || makeViewportFloorPlatform();
    handleEdge(currentPlatform);

    const walkSpeed = PHYSICS.idleWalkSpeed;
    const runSpeed = runtime.generating && settings.generationActivityBoost ? PHYSICS.activeRunSpeed : PHYSICS.idleRunSpeed;
    const attentionTarget = getActiveAttentionTarget();
    const tempBlocksHorizontalMotion = runtime.temporaryAnimation
        && !HORIZONTAL_MOTION_TEMP_ANIMATIONS.has(runtime.temporaryAnimation.name);

    if (!runtime.grounded && runtime.airborneVx != null) {
        runtime.vx = attentionTarget ? 0 : runtime.airborneVx;
    } else if (attentionTarget || tempBlocksHorizontalMotion) {
        runtime.vx = 0;
    } else if (runtime.currentBehavior.type === 'run') {
        runtime.vx = runtime.facing * runSpeed;
    } else if (runtime.currentBehavior.type === 'walk') {
        runtime.vx = runtime.facing * walkSpeed;
    } else if (!runtime.generating) {
        runtime.vx = 0;
    }

    const prevX = runtime.x;
    const prevFeetY = runtime.y + petHeight();
    const proposedX = runtime.x + runtime.vx * dt;
    runtime.x = clampX(proposedX);

    // clampX prevents clipping, but a clamped walker used to keep "running" into
    // the viewport wall forever. Turn immediately when the requested movement was blocked.
    if (runtime.grounded && runtime.vx !== 0 && Math.abs(runtime.x - proposedX) > 0.01) {
        reverseDirection();
    } else if (!runtime.grounded && runtime.airborneVx != null && Math.abs(runtime.x - proposedX) > 0.01) {
        runtime.airborneVx = 0;
        runtime.vx = 0;
    }

    if (!settings.gravityEnabled) {
        runtime.y = clampY(runtime.y);
        return;
    }

    if (!runtime.grounded) {
        runtime.vy = Math.min(PHYSICS.maxFallSpeed, runtime.vy + PHYSICS.gravity * dt);
        runtime.y += runtime.vy * dt;
        const nextFeetY = runtime.y + petHeight();
        const landingPlatform = findLandingPlatform(prevFeetY, nextFeetY, runtime.x);
        if (landingPlatform) {
            snapToPlatform(landingPlatform);
        }
    } else {
        runtime.y = currentPlatform.top - petHeight();
    }

    runtime.y = clampY(runtime.y);

    if (!runtime.grounded) {
        const below = findNearestPlatformBelow();
        if (!below && runtime.y + petHeight() >= window.innerHeight - 1) {
            snapToPlatform(makeViewportFloorPlatform());
        }
    }

    if (Math.abs(runtime.x - prevX) > 0.25) {
        persistPosition();
    }
}

function persistPosition(force = false) {
    const now = performance.now();
    if (!force && (now - runtime.lastPositionPersistAt) < PHYSICS.positionPersistMs) return;
    runtime.lastPositionPersistAt = now;
    const settings = getSettings();
    settings.x = Math.round(runtime.x);
    settings.y = Math.round(runtime.y);
    settings.facing = runtime.facing;
    void saveSettings(force);
}

function showBubble(text, durationMs = 1400) {
    if (!runtime.bubbleEl) {
        return;
    }

    runtime.bubbleEl.textContent = text;
    runtime.bubbleEl.classList.add('visible');
    const token = `${Date.now()}-${Math.random()}`;
    runtime.bubbleEl.dataset.token = token;
    window.setTimeout(() => {
        if (runtime.bubbleEl && runtime.bubbleEl.dataset.token === token) {
            runtime.bubbleEl.classList.remove('visible');
        }
    }, durationMs);
}

function mapExpressionToReaction(expression) {
    return EXPRESSION_TO_REACTION[expression] || 'idle';
}

function currentCharacterExpressionKey() {
    const context = getContext();

    if (context.groupId && Array.isArray(context.chat)) {
        for (let i = context.chat.length - 1; i >= 0; i--) {
            const message = context.chat[i];
            if (!message || message.is_user) {
                continue;
            }

            const avatar = message.original_avatar || resolveAvatarFromForceAvatar(context, message.force_avatar);
            if (avatar) {
                const character = context.characters?.find(item => item.avatar === avatar);
                return character ? characterSpriteFolder(character) : avatar.replace(/\.[^/.]+$/, '');
            }
        }
    }

    const character = context.characters?.[context.characterId];
    if (character?.avatar) {
        return characterSpriteFolder(character);
    }

    return '';
}

function resolveAvatarFromForceAvatar(context, forceAvatar) {
    if (!forceAvatar || !Array.isArray(context.characters)) {
        return '';
    }

    const decoded = decodeURIComponent(String(forceAvatar));
    const match = context.characters.find(character => decoded.includes(character.avatar));
    return match?.avatar || '';
}

function pollExpressionReaction(force = false) {
    const now = performance.now();
    if (!force && (now - runtime.lastMoodPollAt) < PHYSICS.moodPollMs) {
        return;
    }

    runtime.lastMoodPollAt = now;

    if (!getSettings().reactToExpressions) {
        return;
    }

    const key = currentCharacterExpressionKey();
    if (!key) {
        return;
    }

    const expression = lastExpression[key] || '';
    if (!expression || expression === runtime.currentExpression) {
        return;
    }

    runtime.currentExpression = expression;
    const reaction = mapExpressionToReaction(expression);
    if (reaction && reaction !== 'idle') {
        playTemporaryAnimation(reaction, 2200, { bubble: expression === 'joy' ? '♪' : '…' });
    }
}


function isGenerationRequestUrl(input) {
    try {
        const raw = typeof input === 'string'
            ? input
            : input instanceof Request
                ? input.url
                : String(input?.url || input || '');
        const url = new URL(raw, window.location.href);
        const path = url.pathname.replace(/\/+$/, '');

        return /^\/api\/backends\/(?:chat-completions|text-completions|kobold|koboldhorde)\/generate$/i.test(path)
            || /^\/api\/novelai\/generate$/i.test(path);
    } catch {
        return false;
    }
}

function beginGenerationRequestActivity() {
    const now = performance.now();
    runtime.generationRequestActive = true;
    runtime.generationRequestStartedAt = now;
    runtime.generating = true;
    runtime.nextHopAt = now + randomBetween(PHYSICS.hopIntervalMin, PHYSICS.hopIntervalMax);

    // The active/run state starts at the actual LLM request, not when ST begins
    // prompt assembly or emits GENERATION_STARTED.
    if (!runtime.dragging) {
        runtime.temporaryAnimation = null;
        startRun(runtime.facing || 1, randomBetween(1100, 2200), PHYSICS.activeRunSpeed);
    }
}

function endGenerationRequestActivity() {
    if (!runtime.generationRequestActive && !runtime.generating) {
        return;
    }

    runtime.generationRequestActive = false;
    runtime.generating = false;
    runtime.streamPulseUntil = 0;
    runtime.vx = 0;

    if (!runtime.dragging) {
        const duration = randomBetween(1800, 3200);
        startIdle(duration);
        runtime.nextIdleDecisionAt = performance.now() + duration;
    }
}

function installGenerationRequestTracker() {
    if (runtime.generationFetchHookInstalled || typeof window.fetch !== 'function') {
        return;
    }

    const originalFetch = window.fetch.bind(window);
    const wrappedFetch = async function (input, init) {
        const generationRequest = isGenerationRequestUrl(input);
        if (generationRequest) {
            beginGenerationRequestActivity();
        }

        try {
            return await originalFetch(input, init);
        } catch (error) {
            if (generationRequest) {
                endGenerationRequestActivity();
            }
            throw error;
        }
    };

    wrappedFetch.__codexPetGenerationTracker = true;
    window.fetch = wrappedFetch;
    runtime.generationFetchHookInstalled = true;
}

function onGenerationStarted() {
    // Intentionally do not enter the active state here. SillyTavern emits
    // GENERATION_STARTED before prompt assembly, command processing and the
    // actual model request. Active movement begins only when the LLM fetch starts.
    runtime.lastGenerationAt = performance.now();
}

function onGenerationEnded() {
    endGenerationRequestActivity();
}

function onStreamTokenReceived() {
    if (!runtime.generationRequestActive) {
        return;
    }

    runtime.streamPulseUntil = performance.now() + 1200;
    if (Math.random() < 0.12) {
        playTemporaryAnimation('bounce', 1100);
    }
}

function bindAppEvents() {
    if (runtime.eventsBound) {
        return;
    }

    runtime.eventsBound = true;
    eventSource.on(event_types.GENERATION_STARTED, onGenerationStarted);
    eventSource.on(event_types.GENERATION_STOPPED, onGenerationEnded);
    eventSource.on(event_types.GENERATION_ENDED, onGenerationEnded);
    eventSource.on(event_types.STREAM_TOKEN_RECEIVED, onStreamTokenReceived);
    eventSource.on(event_types.CHAT_CHANGED, async () => {
        runtime.currentExpression = '';
        requestPlatformRefresh();
        if (getSettings().petSelection === 'auto') {
            await loadPetDefinition(true);
        }
    });
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, () => pollExpressionReaction(true));
    eventSource.on(event_types.APP_READY, () => requestPlatformRefresh());
}

function bindPointerHandlers() {
    runtime.petEl.addEventListener('pointerdown', event => {
        if (!(event instanceof PointerEvent)) {
            return;
        }

        runtime.dragging = true;
        runtime.dragMoved = false;
        runtime.jumpTargetId = null;
        runtime.airborneVx = null;
        runtime.nextJumpAllowedAt = performance.now() + 1200;
        runtime.dragOffsetX = event.clientX - runtime.x;
        runtime.dragOffsetY = event.clientY - runtime.y;
        runtime.vx = 0;
        runtime.vy = 0;
        runtime.petEl.setPointerCapture?.(event.pointerId);
        runtime.petEl.classList.add('dragging');
        event.preventDefault();
    });

    runtime.petEl.addEventListener('pointermove', event => {
        if (!(event instanceof PointerEvent) || !runtime.dragging) {
            return;
        }

        const nextX = clampX(event.clientX - runtime.dragOffsetX);
        const nextY = clampY(event.clientY - runtime.dragOffsetY);
        if (Math.abs(nextX - runtime.x) > PHYSICS.dragThreshold || Math.abs(nextY - runtime.y) > PHYSICS.dragThreshold) {
            runtime.dragMoved = true;
        }

        runtime.x = nextX;
        runtime.y = nextY;
        runtime.grounded = false;
        runtime.currentPlatformId = null;
        persistPosition();
    });

    const endDrag = event => {
        if (!runtime.dragging) {
            return;
        }

        runtime.dragging = false;
        runtime.petEl.classList.remove('dragging');
        runtime.petEl.releasePointerCapture?.(event.pointerId);
        runtime.grounded = false;
        runtime.currentPlatformId = null;
        requestPlatformRefresh();
        snapDraggedPetToNearestSurface();
        if (!runtime.dragMoved) {
            playTemporaryAnimation('wave_once', 850, { bubble: 'hi' });
        }
        persistPosition(true);
    };

    runtime.petEl.addEventListener('pointerup', endDrag);
    runtime.petEl.addEventListener('pointercancel', endDrag);
}

function populatePetSelect() {
    const select = document.querySelector('#codex_pet_select');
    if (!(select instanceof HTMLSelectElement)) return;
    const settings = getSettings();
    const currentValue = settings.petSelection || 'auto';
    select.innerHTML = '';

    const autoOption = new Option('Auto — current character spritesheet, else Lumi', 'auto');
    select.add(autoOption);
    const builtinGroup = document.createElement('optgroup');
    builtinGroup.label = 'Included pets';
    builtinGroup.appendChild(new Option('Lumi', 'builtin:lumi'));
    select.appendChild(builtinGroup);

    const assetPets = runtime.petCatalog.filter(item => item.type === 'asset');
    if (assetPets.length) {
        const group = document.createElement('optgroup');
        group.label = 'User pets (assets/pet)';
        for (const pet of assetPets) group.appendChild(new Option(pet.label, pet.key));
        select.appendChild(group);
    }

    const characterPets = runtime.petCatalog.filter(item => item.type === 'character');
    if (characterPets.length) {
        const group = document.createElement('optgroup');
        group.label = 'Character expression pets';
        for (const pet of characterPets) group.appendChild(new Option(pet.label, pet.key));
        select.appendChild(group);
    }

    select.value = Array.from(select.options).some(option => option.value === currentValue) ? currentValue : 'auto';
    const status = document.querySelector('#codex_pet_active_source');
    if (status) status.textContent = runtime.loadedPetKey || 'loading…';
}

async function refreshPetCatalog(force = false) {
    const button = document.querySelector('#codex_pet_refresh_pets');
    button?.classList.add('disabled');
    try {
        await discoverPetCatalog(force);
    } finally {
        button?.classList.remove('disabled');
    }
}

async function maybeRefreshPetCatalog(now) {
    if (now < runtime.nextPetCatalogRefreshAt || runtime.petCatalogRefreshPromise) {
        return;
    }

    runtime.nextPetCatalogRefreshAt = now + PHYSICS.petCatalogRefreshMs;
    runtime.petCatalogRefreshPromise = (async () => {
        const oldLoadedKey = runtime.loadedPetKey;
        await discoverPetCatalog(false);
        if (getSettings().petSelection === 'auto') {
            const resolved = await resolveSelectedPet();
            if (resolved.key !== oldLoadedKey) {
                await loadPetDefinition(true);
            }
        }
    })();

    try {
        await runtime.petCatalogRefreshPromise;
    } finally {
        runtime.petCatalogRefreshPromise = null;
    }
}

async function injectSettingsUi() {
    if (runtime.settingsInjected) {
        syncSettingsUi();
        return;
    }

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    $('#extensions_settings2').append(html);
    runtime.settingsInjected = true;
    bindSettingsUi();
    syncSettingsUi();
}

function bindSettingsUi() {
    const updateCheckbox = (selector, key, postAction = null) => {
        $(selector).on('change', function () {
            void updateSetting(key, Boolean($(this).prop('checked')), true);
            postAction?.();
        });
    };

    updateCheckbox('#codex_pet_enabled', 'enabled');
    updateCheckbox('#codex_pet_gravity_enabled', 'gravityEnabled');
    updateCheckbox('#codex_pet_platforms_enabled', 'platformsEnabled', requestPlatformRefresh);
    updateCheckbox('#codex_pet_auto_platforms', 'autoDetectPlatforms', requestPlatformRefresh);
    updateCheckbox('#codex_pet_div_bottom_platforms', 'divBottomPlatformsEnabled', requestPlatformRefresh);
    updateCheckbox('#codex_pet_idle_roam', 'idleRoam');
    updateCheckbox('#codex_pet_cursor_tracking', 'cursorTrackingEnabled');
    updateCheckbox('#codex_pet_react_expressions', 'reactToExpressions');
    updateCheckbox('#codex_pet_debug_platforms', 'showDebugPlatforms', requestPlatformRefresh);
    updateCheckbox('#codex_pet_generation_boost', 'generationActivityBoost');

    $('#codex_pet_select').on('change', async function () {
        await updateSetting('petSelection', String($(this).val() || 'auto'), true);
        await loadPetDefinition(true);
        persistPosition(true);
    });

    $('#codex_pet_refresh_pets').on('click', async function () {
        await refreshPetCatalog(true);
    });

    $('#codex_pet_scale').on('input', function () {
        const scale = Number($(this).val()) || DEFAULT_SETTINGS.scale;
        getSettings().scale = scale;
        $('#codex_pet_scale_value').text(scale.toFixed(2));
        applySpriteSheetStyle();
        requestPlatformRefresh();
        void saveSettings(false);
    }).on('change', function () {
        void saveSettings(true);
    });

    $('#codex_pet_floor_offset').on('input', function () {
        getSettings().floorOffset = Number($(this).val()) || DEFAULT_SETTINGS.floorOffset;
        requestPlatformRefresh();
        void saveSettings(false);
    }).on('change', function () {
        void saveSettings(true);
    });

    $('#codex_pet_platform_selectors').on('input', function () {
        getSettings().platformSelectors = String($(this).val())
            .split(/\r?\n|,/)
            .map(x => x.trim())
            .filter(Boolean);
        requestPlatformRefresh();
        void saveSettings(false);
    }).on('change', function () {
        void saveSettings(true);
    });

    $('#codex_pet_reset_position').on('click', function () {
        resetPosition();
    });
}

function syncSettingsUi() {
    const settings = getSettings();
    $('#codex_pet_enabled').prop('checked', settings.enabled);
    $('#codex_pet_gravity_enabled').prop('checked', settings.gravityEnabled);
    $('#codex_pet_platforms_enabled').prop('checked', settings.platformsEnabled);
    $('#codex_pet_auto_platforms').prop('checked', settings.autoDetectPlatforms);
    $('#codex_pet_div_bottom_platforms').prop('checked', settings.divBottomPlatformsEnabled);
    $('#codex_pet_idle_roam').prop('checked', settings.idleRoam);
    $('#codex_pet_cursor_tracking').prop('checked', settings.cursorTrackingEnabled);
    $('#codex_pet_react_expressions').prop('checked', settings.reactToExpressions);
    $('#codex_pet_debug_platforms').prop('checked', settings.showDebugPlatforms);
    $('#codex_pet_generation_boost').prop('checked', settings.generationActivityBoost);
    $('#codex_pet_scale').val(String(settings.scale));
    $('#codex_pet_scale_value').text(Number(settings.scale).toFixed(2));
    $('#codex_pet_floor_offset').val(String(settings.floorOffset));
    $('#codex_pet_platform_selectors').val(settings.platformSelectors.join('\n'));
    populatePetSelect();
}

function resetPosition(persist = true) {
    const settings = getSettings();
    runtime.x = 32;
    runtime.y = window.innerHeight - petHeight() - settings.floorOffset;
    runtime.vx = 0;
    runtime.vy = 0;
    runtime.facing = 1;
    runtime.grounded = false;
    runtime.currentPlatformId = null;
    requestPlatformRefresh();
    if (persist) persistPosition(true);
}

function restorePosition() {
    const settings = getSettings();
    runtime.x = clampX(Number(settings.x) || 32);
    runtime.y = settings.y == null
        ? window.innerHeight - petHeight() - settings.floorOffset
        : clampY(Number(settings.y));
    runtime.facing = Number(settings.facing) === -1 ? -1 : 1;
    runtime.nextIdleDecisionAt = performance.now() + randomBetween(3000, 6500);
    runtime.grounded = false;
    runtime.currentPlatformId = null;
}

function bindObservers() {
    if (runtime.observersBound) {
        return;
    }

    runtime.observersBound = true;
    if (runtime.mutationObserver) {
        return;
    }

    runtime.mutationObserver = new MutationObserver(() => {
        requestPlatformRefresh();
        if (toastContainerElement()?.children?.length) {
            positionToastContainer();
        }
    });
    runtime.mutationObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'open'],
    });

    window.addEventListener('pointermove', event => {
        runtime.pointer.x = event.clientX;
        runtime.pointer.y = event.clientY;
        runtime.pointer.seen = true;
    }, { passive: true });
    window.addEventListener('resize', requestPlatformRefresh);
    window.addEventListener('scroll', requestPlatformRefresh, true);
}

function step(ts) {
    if (!runtime.loopPrevTs) {
        runtime.loopPrevTs = ts;
    }

    const dt = Math.min(0.05, (ts - runtime.loopPrevTs) / 1000);
    runtime.loopPrevTs = ts;

    installToastrHooks();
    handleBehaviorTimers(ts);
    pursueCursorWhileActive();
    pollExpressionReaction();
    void maybeRefreshPetCatalog(ts);
    physicsStep(dt);
    if (toastContainerElement()?.children?.length) {
        positionToastContainer();
    }
    renderPet(ts);

    runtime.rafId = window.requestAnimationFrame(step);
}

function randomBetween(min, max) {
    return Math.round(min + Math.random() * (max - min));
}

async function init() {
    try {
        getSettings();
        await discoverPetCatalog(false);
        await loadPetDefinition();
        await ensureDom();
        await injectSettingsUi();
        applySpriteSheetStyle();
        restorePosition();
        refreshPlatforms(true);
        installGenerationRequestTracker();
        bindAppEvents();
        bindObservers();

        if (!runtime.rafId) {
            runtime.rafId = window.requestAnimationFrame(step);
        }

        console.info('[Codex Pet] Loaded');
    } catch (error) {
        console.error('[Codex Pet] Failed to initialize', error);
        toastr?.error?.(String(error?.message || error), 'Codex Pet');
    }
}
