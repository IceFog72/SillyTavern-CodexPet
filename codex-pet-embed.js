/*
 * Standalone Codex Pet embed.
 * Edit SPRITESHEET_URL below, then paste this file into any page.
 * The URL must point to the same 8-column / 9-row spritesheet used by the extension.
 */
(function (global) {
    'use strict';

    const SPRITESHEET_URL = 'https://raw.githubusercontent.com/IceFog72/SillyTavern-CodexPet/8a0506a1ecb1e14d8d628e6177bfe961927b9b61/assets/lumi/spritesheet.webp';
    const PLATFORM_SELECTORS = ['div', 'p'];

    const CONFIG = {
        scale: 0.5,
        frameWidth: 192,
        frameHeight: 208,
        columns: 8,
        rows: 9,
        floorOffset: 18,
        edgePadding: 14,
        gravity: 1700,
        slowWalkSpeed: 24,
        runSpeed: 62,
        jumpVelocity: 820,
        maxFallSpeed: 1500,
        platformRefreshMs: 900,
        hopIntervalMin: 9000,
        hopIntervalMax: 16000,
        jumpCooldownMin: 4200,
        jumpCooldownMax: 7200,
    };

    const TRACKS = {
        idle: [
            [0, 1680], [1, 660], [2, 660], [3, 840], [4, 840], [5, 1920],
        ],
        walkRight: Array.from({ length: 8 }, (_, i) => [8 + i, i === 7 ? 170 : 135]),
        walkLeft: Array.from({ length: 8 }, (_, i) => [16 + i, i === 7 ? 170 : 135]),
        run: Array.from({ length: 6 }, (_, i) => [56 + i, i === 5 ? 170 : 120]),
        jump: Array.from({ length: 5 }, (_, i) => [32 + i, i === 4 ? 280 : 140]),
    };

    function randomBetween(min, max) {
        return Math.round(min + Math.random() * (max - min));
    }

    function chooseIdleBehavior(roll) {
        if (roll < 1 / 3) return 'run';
        if (roll < 2 / 3) return 'idle';
        return 'walk';
    }

    function visibleElement(element, root) {
        if (root.contains(element)) return false;
        const rect = element.getBoundingClientRect();
        const style = global.getComputedStyle(element);
        return rect.width >= 48
            && rect.height >= 6
            && rect.bottom >= 0
            && rect.right >= 0
            && rect.left <= global.innerWidth
            && rect.top <= global.innerHeight
            && style.display !== 'none'
            && style.visibility !== 'hidden'
            && Number(style.opacity || 1) > 0
            && !(rect.width > global.innerWidth * 0.92
                && rect.height > global.innerHeight * 0.68
                && rect.top < 12);
    }

    function makePlatform(element, root) {
        if (!visibleElement(element, root)) return null;
        const rect = element.getBoundingClientRect();
        return {
            left: Math.max(0, rect.left),
            right: Math.min(global.innerWidth, rect.right),
            top: rect.top,
            id: element,
        };
    }

    function collectPlatforms(root, petWidth) {
        const platforms = [{
            left: 0,
            right: global.innerWidth,
            top: global.innerHeight - CONFIG.floorOffset,
            id: 'viewport-floor',
        }];
        const candidates = [];

        for (const selector of PLATFORM_SELECTORS) {
            for (const element of global.document.querySelectorAll(selector)) {
                const platform = makePlatform(element, root);
                if (platform && platform.right - platform.left >= Math.max(48, petWidth * 0.55)) {
                    candidates.push(platform);
                }
            }
        }

        // Nested divs often describe one surface several times. Keep the smaller
        // visible surface when their top edges and spans are effectively identical.
        candidates.sort((a, b) => (a.right - a.left) - (b.right - b.left));
        for (const candidate of candidates) {
            const duplicate = platforms.some(existing => {
                if (existing.id === 'viewport-floor' || Math.abs(existing.top - candidate.top) > 3) {
                    return false;
                }
                const overlap = Math.max(0, Math.min(existing.right, candidate.right)
                    - Math.max(existing.left, candidate.left));
                const smallerWidth = Math.min(
                    existing.right - existing.left,
                    candidate.right - candidate.left,
                );
                return smallerWidth > 0 && overlap / smallerWidth > 0.82;
            });
            if (!duplicate) platforms.push(candidate);
        }

        return platforms.sort((a, b) => a.top - b.top || a.left - b.left);
    }

    function createStyles() {
        const style = global.document.createElement('style');
        style.textContent = `
            .codex-pet-embed-root { position: fixed; inset: 0; pointer-events: none; z-index: 2147483000; }
            .codex-pet-embed-actor { position: absolute; left: 0; top: 0; pointer-events: auto; cursor: grab; user-select: none; touch-action: none; }
            .codex-pet-embed-actor.dragging { cursor: grabbing; }
            .codex-pet-embed-sprite { width: 100%; height: 100%; background-repeat: no-repeat; image-rendering: auto; filter: drop-shadow(0 3px 10px rgba(0,0,0,.42)); }
        `;
        global.document.head.appendChild(style);
        return style;
    }

    function createPet() {
        if (!SPRITESHEET_URL || SPRITESHEET_URL === 'PASTE_SPRITESHEET_URL_HERE') {
            throw new Error('Set SPRITESHEET_URL in codex-pet-embed.js first.');
        }

        const root = global.document.createElement('div');
        root.className = 'codex-pet-embed-root';
        const actor = global.document.createElement('div');
        actor.className = 'codex-pet-embed-actor';
        actor.title = 'Drag pet';
        const sprite = global.document.createElement('div');
        sprite.className = 'codex-pet-embed-sprite';
        actor.appendChild(sprite);
        root.appendChild(actor);
        global.document.body.appendChild(root);

        const style = createStyles();
        const width = Math.round(CONFIG.frameWidth * CONFIG.scale);
        const height = Math.round(CONFIG.frameHeight * CONFIG.scale);
        actor.style.width = `${width}px`;
        actor.style.height = `${height}px`;
        sprite.style.backgroundImage = `url(${JSON.stringify(SPRITESHEET_URL)})`;
        sprite.style.backgroundSize = `${CONFIG.columns * width}px ${CONFIG.rows * height}px`;

        const state = {
            x: 32,
            y: global.innerHeight - height - CONFIG.floorOffset,
            vx: 0,
            vy: 0,
            facing: 1,
            grounded: false,
            platform: null,
            platforms: [],
            behavior: 'idle',
            behaviorUntil: 0,
            nextBehaviorAt: performance.now() + randomBetween(2500, 5000),
            nextHopAt: performance.now() + randomBetween(CONFIG.hopIntervalMin, CONFIG.hopIntervalMax),
            nextJumpAllowedAt: 0,
            animationStartedAt: 0,
            animationName: '',
            dragging: false,
            dragOffsetX: 0,
            dragOffsetY: 0,
            rafId: 0,
            previousTimestamp: 0,
            lastPlatformRefresh: 0,
            observer: null,
            resizeHandler: null,
            scrollHandler: null,
        };

        const clampX = x => Math.max(0, Math.min(global.innerWidth - width, x));
        const clampY = y => Math.max(0, Math.min(global.innerHeight - height, y));
        const refreshPlatforms = (force = false) => {
            const now = performance.now();
            if (!force && now - state.lastPlatformRefresh < CONFIG.platformRefreshMs) return;
            state.platforms = collectPlatforms(root, width);
            state.lastPlatformRefresh = now;
        };
        const currentPlatform = () => state.platforms.find(item => item.id === state.platform) || null;
        const footprint = x => ({ left: x + width * 0.34, right: x + width * 0.66 });
        const supports = (platform, x, y) => {
            const feet = y + height;
            const feetBox = footprint(x);
            return feetBox.right >= platform.left && feetBox.left <= platform.right
                && Math.abs(feet - platform.top) <= 3;
        };
        const landingPlatform = (previousFeet, nextFeet, x) => {
            const feetBox = footprint(x);
            return state.platforms
                .filter(platform => feetBox.right >= platform.left && feetBox.left <= platform.right)
                .filter(platform => previousFeet <= platform.top + 2 && nextFeet >= platform.top)
                .sort((a, b) => a.top - b.top)[0] || null;
        };
        const snapToPlatform = platform => {
            state.platform = platform.id;
            state.y = platform.top - height;
            state.vy = 0;
            state.grounded = true;
        };
        const reverse = () => {
            state.facing *= -1;
            state.vx = Math.abs(state.vx || CONFIG.slowWalkSpeed) * state.facing;
            state.animationName = '';
        };
        const jump = () => {
            const now = performance.now();
            if (!state.grounded || state.dragging || now < state.nextJumpAllowedAt) return false;
            state.nextJumpAllowedAt = now + randomBetween(CONFIG.jumpCooldownMin, CONFIG.jumpCooldownMax);
            state.vy = -CONFIG.jumpVelocity;
            state.grounded = false;
            state.platform = null;
            state.animationName = '';
            return true;
        };
        const chooseBehavior = now => {
            state.behavior = chooseIdleBehavior(Math.random());
            state.behaviorUntil = now + randomBetween(1800, 4200);
            state.nextBehaviorAt = state.behaviorUntil;
            if (state.behavior === 'idle') state.vx = 0;
            else state.facing = Math.random() < 0.5 ? -1 : 1;
        };
        const render = timestamp => {
            const animationName = state.grounded
                ? state.behavior === 'run' ? 'run' : state.behavior === 'walk' ? 'walk' : 'idle'
                : 'jump';
            if (animationName !== state.animationName) {
                state.animationName = animationName;
                state.animationStartedAt = timestamp;
            }
            const track = animationName === 'walk'
                ? state.facing < 0 ? TRACKS.walkLeft : TRACKS.walkRight
                : animationName === 'run' ? TRACKS.run : TRACKS[animationName];
            const elapsed = timestamp - state.animationStartedAt;
            const total = track.reduce((sum, [, duration]) => sum + duration, 0);
            let remaining = total ? elapsed % total : 0;
            let spriteIndex = track[0][0];
            for (const [index, duration] of track) {
                if (remaining < duration) {
                    spriteIndex = index;
                    break;
                }
                remaining -= duration;
            }
            const column = spriteIndex % CONFIG.columns;
            const row = Math.floor(spriteIndex / CONFIG.columns);
            actor.style.transform = `translate(${Math.round(state.x)}px, ${Math.round(state.y)}px)`;
            sprite.style.backgroundPosition = `${-column * width}px ${-row * height}px`;
            sprite.style.transform = state.facing < 0 && animationName === 'run' ? 'scaleX(-1)' : 'none';
        };
        const step = timestamp => {
            if (!state.previousTimestamp) state.previousTimestamp = timestamp;
            const dt = Math.min(0.05, (timestamp - state.previousTimestamp) / 1000);
            state.previousTimestamp = timestamp;
            refreshPlatforms();

            if (state.grounded && !supports(currentPlatform() || state.platforms[0], state.x, state.y)) {
                state.grounded = false;
                state.platform = null;
            }
            if (state.grounded && timestamp >= state.nextHopAt) {
                jump();
                state.nextHopAt = timestamp + randomBetween(CONFIG.hopIntervalMin, CONFIG.hopIntervalMax);
            }
            if (state.grounded && timestamp >= state.nextBehaviorAt) chooseBehavior(timestamp);

            const platform = currentPlatform();
            if (state.grounded && platform) {
                const feet = footprint(state.x);
                if (platform.id === 'viewport-floor') {
                    if ((state.facing < 0 && state.x <= CONFIG.edgePadding)
                        || (state.facing > 0 && state.x + width >= global.innerWidth - CONFIG.edgePadding)) {
                        reverse();
                    }
                } else if ((state.facing < 0 && feet.left <= platform.left + CONFIG.edgePadding)
                    || (state.facing > 0 && feet.right >= platform.right - CONFIG.edgePadding)) {
                    if (!jump()) reverse();
                }
            }

            if (!state.dragging) {
                if (state.behavior === 'run') state.vx = state.facing * CONFIG.runSpeed;
                else if (state.behavior === 'walk') state.vx = state.facing * CONFIG.slowWalkSpeed;
                else if (state.grounded) state.vx = 0;

                const previousFeet = state.y + height;
                const proposedX = state.x + state.vx * dt;
                state.x = clampX(proposedX);
                if (state.grounded && Math.abs(state.x - proposedX) > 0.01) reverse();

                if (!state.grounded) {
                    state.vy = Math.min(CONFIG.maxFallSpeed, state.vy + CONFIG.gravity * dt);
                    state.y += state.vy * dt;
                    const landed = landingPlatform(previousFeet, state.y + height, state.x);
                    if (landed) snapToPlatform(landed);
                }
                state.y = clampY(state.y);
                if (!state.grounded && state.y + height >= global.innerHeight - 1) {
                    snapToPlatform(state.platforms[0]);
                }
            }

            render(timestamp);
            state.rafId = global.requestAnimationFrame(step);
        };
        const onPointerDown = event => {
            state.dragging = true;
            state.dragOffsetX = event.clientX - state.x;
            state.dragOffsetY = event.clientY - state.y;
            state.vx = 0;
            state.vy = 0;
            state.grounded = false;
            state.platform = null;
            actor.classList.add('dragging');
            actor.setPointerCapture?.(event.pointerId);
            event.preventDefault();
        };
        const onPointerMove = event => {
            if (!state.dragging) return;
            state.x = clampX(event.clientX - state.dragOffsetX);
            state.y = clampY(event.clientY - state.dragOffsetY);
        };
        const endDrag = event => {
            if (!state.dragging) return;
            state.dragging = false;
            actor.classList.remove('dragging');
            actor.releasePointerCapture?.(event.pointerId);
            refreshPlatforms(true);
            const petFootprint = footprint(state.x);
            const nearest = state.platforms
                .filter(platform => petFootprint.right >= platform.left && petFootprint.left <= platform.right)
                .sort((a, b) => Math.abs((state.y + height) - a.top) - Math.abs((state.y + height) - b.top))[0];
            if (nearest && Math.abs(state.y + height - nearest.top) < height * 0.7) snapToPlatform(nearest);
            state.nextBehaviorAt = performance.now() + 4000;
        };

        actor.addEventListener('pointerdown', onPointerDown);
        actor.addEventListener('pointermove', onPointerMove);
        actor.addEventListener('pointerup', endDrag);
        actor.addEventListener('pointercancel', endDrag);
        state.resizeHandler = () => refreshPlatforms(true);
        state.scrollHandler = () => refreshPlatforms(true);
        global.addEventListener('resize', state.resizeHandler);
        global.addEventListener('scroll', state.scrollHandler, true);
        state.observer = new MutationObserver(() => refreshPlatforms());
        state.observer.observe(global.document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['style', 'class', 'hidden'],
        });

        refreshPlatforms(true);
        state.rafId = global.requestAnimationFrame(step);
        return {
            destroy() {
                global.cancelAnimationFrame(state.rafId);
                state.observer?.disconnect();
                global.removeEventListener('resize', state.resizeHandler);
                global.removeEventListener('scroll', state.scrollHandler, true);
                style.remove();
                root.remove();
            },
        };
    }

    function start() {
        if (global.CodexPetEmbed) global.CodexPetEmbed.destroy();
        const image = new global.Image();
        image.onload = () => {
            try {
                global.CodexPetEmbed = createPet();
            } catch (error) {
                console.error('[Codex Pet] Failed to initialize:', error);
            }
        };
        image.onerror = () => console.error('[Codex Pet] Failed to load spritesheet:', SPRITESHEET_URL);
        image.src = SPRITESHEET_URL;
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { chooseIdleBehavior, collectPlatforms };
    } else if (global.document) {
        if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', start, { once: true });
        else start();
    }
}(typeof window !== 'undefined' ? window : globalThis));
