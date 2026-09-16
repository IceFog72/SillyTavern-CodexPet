const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync('./codex-pet-embed.js', 'utf8'), context);
const { chooseIdleBehavior, collectPlatforms, detectRows } = context.module.exports;

assert.equal(chooseIdleBehavior(0.00), 'run');
assert.equal(chooseIdleBehavior(0.32), 'run');
assert.equal(chooseIdleBehavior(1 / 3), 'idle');
assert.equal(chooseIdleBehavior(0.65), 'idle');
assert.equal(chooseIdleBehavior(2 / 3), 'walk');
assert.equal(chooseIdleBehavior(0.99), 'walk');
assert.equal(detectRows({ naturalWidth: 1374, naturalHeight: 2048 }), 11);

const div = { getBoundingClientRect: () => ({ left: 50, right: 450, top: 200, bottom: 260, width: 400, height: 60 }) };
const paragraph = { getBoundingClientRect: () => ({ left: 500, right: 900, top: 400, bottom: 430, width: 400, height: 30 }) };
context.innerWidth = 1000;
context.innerHeight = 600;
context.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
context.document = {
    querySelectorAll(selector) {
        assert.ok(selector === 'div' || selector === 'p');
        return selector === 'div' ? [div] : [paragraph];
    },
};

const root = { contains: () => false };
const platforms = collectPlatforms(root, 96);
assert.strictEqual(platforms[0].id, div);
assert.strictEqual(platforms[1].id, paragraph);
assert.equal(platforms[2].id, 'viewport-floor');

console.log('Codex Pet embed behavior split: 33% run / 33% idle / 33% slow walk');
