# SillyTavern-CodexPet

Browser-side animated pet extension inspired by Codex pet runtime semantics.

## Features

- Persistent always-on pet overlay.
- Draggable pet with saved per-user selection and position.
- Gravity and one-way DOM platform collision.
- Automatic platform discovery plus explicit platform selectors.
- Idle wandering and hopping.
- More active behavior while text is generating/streaming.
- Reactions to SillyTavern expression changes.
- Included Lumi pet.
- Automatic discovery of `spritesheet.webp` in character expression folders.
- Optional `pet.json` beside a character `spritesheet.webp` for custom animation metadata.
- Automatic spritesheet grid detection. This also tolerates malformed/custom atlases whose row count differs from Codex's normal 8x9 atlas.

## Pet selection

The default **Auto** mode checks the current character's effective expression folder. If that folder contains `spritesheet.webp`, it is used as the pet. Otherwise the bundled Lumi pet is used.

The pet picker also lists every character expression folder in the current SillyTavern user library where a `spritesheet.webp` was detected. The selected value is stored in SillyTavern extension settings, so it is user-specific and persistent.

## Marking platforms

The extension auto-detects visible panel/div surfaces. For deterministic behavior, explicitly mark a platform:

```html
<div data-pet-platform></div>
```

You can also add any CSS selector in the extension settings.

## Character pet folder

A minimal character pet only needs:

```text
<user data>/characters/<character sprite folder>/spritesheet.webp
```

Optional:

```text
<user data>/characters/<character sprite folder>/pet.json
```

When `pet.json` is absent, Codex-compatible animation defaults are used.

## User pet packs

Place additional pet folders here:

```text
data/<user>/assets/pet/<name>/
├── spritesheet.webp
└── pet.json          # optional
```

The extension periodically rescans `assets/pet` and adds valid pet folders to the selector.

Pet grid sizing is normalized from the Codex 8-column / 192x208 cell contract unless an explicit `frame` object is supplied in `pet.json`. This prevents narrow characters from being misread as extra transparent columns.

## Idle behavior

Default idle choices are weighted per decision: 50% cursor tracking, 33% slow walking, and 17% normal standing idle.
