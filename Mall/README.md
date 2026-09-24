# Xeno Plaza — V1

A single-file three.js mall. Four venues off one glass-and-aluminium concourse:
the Gerhard Oosthuizen Gallery, Xeno Games Arcade, NX Dev and the Design Studio.

## Running it

Auto-detection reads folders, which browsers block on `file://`. Serve the folder:

```
python -m http.server 8000
```

Then open `http://localhost:8000/Xeno_Plaza.html`.

It will still run when opened directly as a file — it just falls back to
placeholder art and the first guessed path for each game.

## Folder layout

The page itself sits at the root of the site; everything it loads lives beside
it, either in the shared `images/` folder or under `Mall/`. All paths in
`CONFIG` are relative to the root.

```
Xeno_Plaza.html            at the site root, next to index.html
images/
  Art/       paintings for the gallery — first 10 are hung
  Design/    design work for the studio screens — up to 24 in rotation
Mall/Games/  your games, one folder or HTML file each
Mall/Games/Spectrum/  .tap / .tzx / .z80 / .sna for the NX Dev desks
Mall/Apps/   GONX.html, the web synth the atrium piano opens
             GoPaint.html, the paint studio the gallery easel opens
Mall/Apps/Spectrum/   the emulator the NX Dev desks run, and where 48.rom goes
```

## Adding artwork

Drop `jpg / jpeg / png / webp / avif / gif` files into `images/Art`. Filenames
become titles, so `Blue-Hour.jpg` reads as "Blue Hour". Frames resize themselves
to each image's aspect ratio, portrait or landscape.

Fewer than ten files repeats them around the room; none at all shows generated
stand-ins so the space still reads as finished.

For exact titles, order or captions, add `images/Art/manifest.json`:

```json
[
  { "src": "harbour-nocturne.jpg", "title": "Harbour Nocturne", "note": "Oil on board, 2024" },
  { "src": "dust-index.png",       "title": "Dust Index",       "note": "Acrylic, 2023" }
]
```

Same idea for `images/Design/manifest.json`. Design screens cross-fade through
the folder on staggered timers, and each screen opens full size when clicked.

## Adding games

Each cabinet looks for its game in order and uses the first one that exists:

| Cabinet | Looks for |
| --- | --- |
| Pac-Ball 3D | `Mall/Games/PacBall/index.html`, `Mall/Games/Pac-Ball.html`, `Mall/Games/Pac-Ball_V15.html`, … |
| Elevator Action 3D | `Mall/Games/ElevatorAction/index.html`, `Mall/Games/Elevator_Action_FPS_V18.html`, … |
| Bleaux AstroMiner | `Mall/Games/AstroMiner/index.html`, `Mall/Games/BleauxAstroMiner.html`, … |

To point them somewhere else, add `Mall/Games/manifest.json`:

```json
[
  { "key": "pac",   "url": "Mall/Games/Pac-Ball_V15.html" },
  { "key": "elev",  "url": "Mall/Games/Elevator_Action_FPS_V18.html" },
  { "key": "astro", "url": "Mall/Games/Bleaux_AstroMiner_V3.html" }
]
```

Clicking a cabinet opens that game in a new tab. Titles and marquee colours live
in the `CONFIG` block at the top of the HTML.

## The atrium piano

The grand piano on the dais in the middle of the plaza opens `Mall/Apps/GONX.html`
in a new tab — click the case, the lid, the keys or the card on the music desk.
To point it somewhere else, edit `CONFIG.synth` at the top of the HTML:

```js
synth: { title: 'GONX', sub: 'Open the web synth', url: 'Mall/Apps/GONX.html' },
```

The title is what the music desk reads and what the tooltip says, so changing
the app changes the signage with it.

## The gallery easel

An easel stands in the north-east corner of the gallery, a few steps in and to
the right of the door. It is clear of all three hung walls, so it never gets
between you and a painting. Click any part of it — legs, tray, card or canvas —
and `Mall/Apps/GoPaint.html` opens in a new tab.

Paint something, then close that tab (or just switch back to the plaza). The
finished painting is flattened, handed back, and stretched onto the easel's
canvas at its own aspect ratio, so a wide painting gives a wide canvas and a
tall one a tall canvas. It stays there across reloads.

Nothing is handed back if you didn't paint anything. To point the easel
somewhere else, edit `CONFIG.paint` at the top of the HTML:

```js
paint: { title: 'GoPaint', sub: 'Paint on this easel', url: 'Mall/Apps/GoPaint.html', key: 'xeno_plaza_easel_art' },
```

`key` is the `localStorage` slot the two pages hand the artwork over in — change
it here and in the matching `PLAZA_KEY` in GoPaint, or not at all.

## The NX Dev desks are ZX Spectrums

All four desks in NX Dev run a Spectrum. From across the room a desk shows a
dark slab where a keyboard would be; walk up and it is replaced by a ZX
Spectrum + keyboard with working keys. Click the screen or the board to sit
down, `escape` to stand up again.

**Two ways to type.** The panel switches between them.

- *Normal* — type the way you would anywhere else, `10 print "hello"`, and the
  keywords are recognised when you press ENTER.
- *Spectrum keys* — the real thing. At the start of a statement one press of
  `P` gives you `PRINT`, SYMBOL SHIFT and `P` gives `"`, and so on.

Either way you can also click the keys on the 3D board, and the two mix
freely. The caps are live: hold CAPS SHIFT or SYMBOL SHIFT and every key
repaints with what it will actually type, and the key under the pointer is
spelled out on the strip above the board. The flashing cursor says which mode
you are in — `K` keyword, `L` letter, `C` caps lock, `E` extend, `G` graphics.

| | |
| --- | --- |
| `escape` | stand up |
| `shift` | CAPS SHIFT · `ctrl` or `alt` SYMBOL SHIFT |
| `tab` | EXTEND MODE |
| `shift`+`space` | BREAK |

**How much machine you get depends on the machine you are on.** The terminal
reads `navigator.deviceMemory`, the core count and the screen, and picks
anything from a 16K up to *NX 1024* — a Spectrum with the brakes off, 1024K
and a fast BASIC. Whatever it picked is shown in the panel and can be changed
there. The memory readout is real: fill it and you get `4 Out of memory`.

Speed has three settings. *Authentic* is about what a real 48K managed — an
empty `FOR i=1 TO 1000: NEXT i` takes it four seconds, as it should. *Fast* is
the default. *Turbo* is for programs that are not frame-locked.

**It really is BASIC** — PLOT, DRAW, CIRCLE, arrays, string slicing, DEF FN,
READ/DATA, INKEY$, PEEK and POKE, and USR to run machine code you have poked
in. `SAVE "name"` and `LOAD "name"` keep programs in this browser. The *3D
cube* in the demos menu is a wireframe rotator written in nothing but BASIC;
it is there to show that a Spectrum-style 3D game is a thing you can build at
these desks.

**Real Spectrum software** needs Sinclair's ROM, which is not ours to ship.
Put a `48.rom` in `Mall/Apps/Spectrum/` — or drag one onto the page while seated,
and it is remembered — and the Z80 emulator switches on. After that, drop
`.tap`, `.tzx`, `.z80` or `.sna` files onto a terminal, or leave them in
`Mall/Games/Spectrum/` and they appear in the menu. Tapes load through a ROM trap,
so they load instantly rather than in four minutes.

The emulator is a set of modules under `Mall/Apps/Spectrum/`, imported by the
plaza. Browsers refuse to import modules over `file://`, so this is the part
that needs the page served over http — use `run_xeno_plaza.bat`. Opened
straight off the disk, the desks quietly keep plain screens and the rest of
the plaza is unaffected.

## Getting around

- **Walk to click** (default, and the only mode on phones) — click or tap the
  floor and you walk there. A* routes you around the piano dais, escalators and
  furniture and through doorways. Drag to look around.
- **Mouse look** (desktop) — click the view to capture the mouse, then
  `W A S D`, shift to run, click to interact, escape to release.
- `M` directory · `1`–`4` walk to a venue · `H` controls.

Desktops get soft shadows and real glass transmission; phones get a lighter
build automatically.
