# ZX SPECTRUM 3D

A Sinclair machine you can walk around inside.

The screen is **255 × 175 pixels, extruded 255 blocks into the display**. Every
coordinate takes a third value. Every pixel may be any of the 16 Spectrum
colours, and — as on the SAM Coupé — there is no attribute cell, so nothing
ever clashes. One pixel is **1/8 metre**, so the whole display is roughly
32 m wide, 22 m tall and 32 m deep, and you are about fourteen pixels tall.

Four terminals stand at the centre of each edge of the display. Each carries a
ZX Spectrum +2 keyboard with 1/8 m keys and a CRT the same width as the
keyboard. Type BASIC on it; `SCREEN 4` sends what you draw into the world
itself.

---

## Running it

Double-click `index.html`. That is all — `vendor/three.min.js` is bundled, so
it works offline and straight off a `file://` URL.

If you would rather serve it:

```
python -m http.server 8000
```

then open <http://localhost:8000>.

Tested in Chromium-based browsers and Firefox. It needs WebGL.

---

## First five minutes

1. Click **CLICK TO ENTER**, then walk with `W A S D`.
2. Walk up to the terminal in front of you and press `E`.
3. Type this (the `TYPING: SPECTRUM` button switches between single-key
   Sinclair entry and ordinary typing — `AUTO` is easier if 1982 is not in
   your muscle memory):

   ```
   10 SCREEN 4
   20 CLS
   30 INK 6
   40 PLOT 20,20,200
   50 DRAW 200,120,-150
   RUN
   ```

4. Press `Esc`, walk into the display, and look at your line from the side.
5. Press `H` at any time for the full manual, `T` for the tape.

---

## Controls

| | |
|---|---|
| `W A S D` | move |
| `Space` | jump / fly up |
| `Shift` | sprint / fly down |
| `Ctrl` | crouch |
| `F` | fly on/off |
| Left mouse | remove a voxel (or press a key cap you are looking at) |
| Right mouse | place a voxel |
| Wheel, `1`–`8` | colour &nbsp;·&nbsp; `B` bright &nbsp;·&nbsp; `G` material |
| `E` | use the nearest terminal &nbsp;·&nbsp; `Esc` leave it |
| `H` / `T` | manual / tape &nbsp;·&nbsp; `R` return to the spawn point |
| `F2` | switch between SPECTRUM and AUTO typing (at a terminal) |
| `F4` | save the 3D screen as scenery or a character / sprite |

**Inside** the display you move like Minecraft: blocky gravity, a short
auto-step, voxels you can stand on, dig and build. **Outside** it you get
ordinary first-person movement — longer stride, faster sprint, nothing in the
way but the furniture. The HUD says which you are in.

---

## The keyboard

Every key cap **re-letters itself in real time**. Hold `Shift` (CAPS SHIFT) or
`Ctrl` (SYMBOL SHIFT), or press `Tab` for EXTEND, and all four keyboards in the
world repaint to show what each key will now produce. Hovering the pointer over
a key does the same for that key and prints the result in the toolbar before
you commit to it.

Press `Tab` **twice** for a fifth layer that does not exist on a real Spectrum:
this machine's solid-display words, printed in cyan on the key caps —
`SPHERE`, `CUBE`, `TEXT`, `DEPTH`, `MAT`, `SPRITE`, `SDATA`, `PUT`, `UNPUT`,
`MOVE`, `BOX`, `SUN`, `VIEW`, `FILL`, `SCREEN`.

You can also click the key caps with the mouse, from the seat or while walking
past.

---

## BASIC

Everything Sinclair shipped works: `LET PRINT INPUT IF/THEN FOR/NEXT GO TO
GO SUB RETURN DIM DATA/READ/RESTORE DEF FN REM STOP PAUSE RANDOMIZE POKE/PEEK
BORDER INK PAPER BRIGHT FLASH INVERSE OVER CLS PLOT DRAW CIRCLE BEEP CLEAR
CONTINUE LIST RUN NEW SAVE LOAD MERGE VERIFY CAT ERASE`, string slicing
(`a$(2 TO 5)`), the usual function set, and `AND OR NOT`.

### Screens

| | |
|---|---|
| `SCREEN 0` | output to the terminal CRT (32 × 24 text) |
| `SCREEN 4` | output to the solid display (31 × 21 text) |

`SCREEN 4` is this machine's answer to the SAM Coupé's `MODE 3`: the same idea,
one dimension further on. Modes 1–3 are reserved for flat screens, so the solid
display took the next free number.

Naming a third coordinate always reaches the solid display, whichever `SCREEN`
is selected — `PLOT 7,8,9` draws in the world even from `SCREEN 0`.

### Solid-display words

| | |
|---|---|
| `PLOT x,y,z` | set one voxel |
| `DRAW dx,dy,dz` | relative 3D line |
| `DRAW TO x,y,z` | absolute 3D line |
| `CIRCLE x,y,z,r` | circle on the x/y plane at depth z |
| `SPHERE x,y,z,r[,solid]` | ball, hollow unless the last argument is 1 |
| `CUBE x,y,z,w,h,d` | filled box |
| `BOX x,y,z,w,h,d` | wireframe box |
| `TEXT x,y,z,a$[,depth]` | text as pixel blocks, extruded (1 block default) |
| `FILL x,y,z` | bounded 3D flood fill |
| `DEPTH z` | default z for two-argument PLOT/DRAW |
| `MAT n` | 0 solid, 1 glass, 2 glowing |
| `INK c` / `PAPER c` | colour 0–15 (8–15 are BRIGHT) |
| `POINT(x,y,z)` | colour at a voxel, −1 if empty |
| `SUN az,el` | move the sun (degrees) |
| `VIEW x,y,z` | teleport the camera to a pixel coordinate |
| `MEM` | free bytes |

Coordinates: **x** 0–254 left→right, **y** 0–174 bottom→top, **z** 0–254
front→back. The origin is the bottom-front-left corner, so `PLOT 0,0,0` is
exactly where Sinclair always put it, plus depth.

### Animated voxel sprites

```
SPRITE n,w,h,d[,frames]        define a sprite
SDATA n,frame,row,a$[,layer]   fill one row: hex colour digits, "." transparent
PUT n,x,y,z[,frame]            stamp it, remembering what was underneath
UNPUT n                        put the background back
MOVE n,x,y,z[,frame]           UNPUT then PUT -- your animation loop
```

Three programs come on the tape: `LOAD "LINE"` (the first-line example),
`LOAD "SPRITE"` (the listing above) and `LOAD "DEMO"` -- a two-frame sprite
flying a Lissajous path through the display. The desk terminals' demos are
also included: `CUBE`, `STARS`, `NOCLASH` and `COLOURS`. `RUN` any of them.

---

## Tape

### Save builds for a BASIC 3D game

Press **F4**, click **SAVE 3D / ASSETS** while walking, or **SAVE 3D** on the
terminal toolbar. Give the asset a name and choose:

- **Scenery** captures the entire voxel display, including its floor, empty
  space, colours and materials, at the original coordinates.
- **Character / sprite** crops to the occupied voxels. Empty space remains
  transparent and the floor row is excluded by default. Choose **Only a
  coordinate box** to isolate one build; its coordinates use the same x/y/z
  system as `PLOT`. Turn on **Include floor voxels** if your build uses y = 0.

**SAVE + DOWNLOAD .ZX3D** adds the asset to the virtual tape and downloads a
portable file. The current BASIC program and display are preserved. The panel
shows ready-to-use BASIC commands and reports if browser storage is full or
unavailable, so keep the downloaded file for a reliable backup.

To reuse a file in another session, click **IMPORT .ZX3D**, use **IMPORT FILE**
on the tape, or drop it onto the window. Import adds it to the tape without
replacing your program or display. Then load scenery in your game's setup:

```
10 SCREEN 4
20 LOAD "MY SCENE" SCREEN$
```

Or load and move a character:

```
10 SCREEN 4
20 LOAD "HERO" SPRITE 1
30 PUT 1,20,10,20
40 PAUSE 5
50 MOVE 1,21,10,20
```

`PUT` positions the sprite's bottom-front-left corner. `MOVE` restores its
previous background before stamping at the new location; `UNPUT 1` removes it
and restores that background. Captured sprites retain each voxel's solid,
glass or glow material, even if the current `MAT` changes. A screen capture
has one frame. `SAVE "HERO" SPRITE 1` saves all frames of an existing BASIC
sprite, and `LOAD "HERO" SPRITE 2` loads them under another number.

**VIEW SAVED ASSETS** opens the tape. Click a scenery entry to restore it or a
sprite entry to load it using the sprite number in the save panel (1 by
default). Each asset has a **.ZX3D** download button.

The `.zx3d` format is native to this machine's 3D BASIC extensions; it is not a
standard Spectrum tape or a general-purpose 3D model format. It stores voxel
data, not the surrounding desks, camera, sun or running program. `.TAP` export
exports BASIC and ordinary tape blocks; download 3D assets separately. Native
assets support the full display size without TAP's 64 KB block limit.

### Programs and emulation

`SAVE "name"` writes the program; `SAVE "name" SCREEN$` writes the whole voxel
world; `LOAD`, `CAT` and `ERASE` behave as you would expect. The tape survives
between sessions in `localStorage`.

The tape panel (`T`) **exports a genuine `.tap`** with properly tokenised
Sinclair BASIC — a program written here will load on a real Spectrum emulator.
It imports `.tap`, `.tzx`, `.sna` and `.z80`; drop a file anywhere on the
window.

- A tape whose first block is a BASIC program comes straight into the editor.
- Anything else starts the built-in Z80 and runs as a genuine 48K Spectrum on
  the terminal CRT.
- Turn on **PROJECT TO 3D** and the emulated 256 × 192 display is rebuilt as
  voxels one block deep inside the world, sampled down to the 175 rows the
  solid display has.

### About the ROM

No Spectrum ROM is bundled — it is Amstrad's. A compact substitute is built in
that boots, services the 50 Hz interrupt and keeps `FRAMES` ticking, which is
enough for most snapshots and for the ROM-less turbo loader (it reads the BASIC
loader off the tape, drops the CODE blocks where their headers say, and jumps
to the address `RANDOMIZE USR` names).

For full compatibility, drop your own 16 KB `48.rom` into the tape panel.
Tape loading is then done through a trap on `LD_BYTES`, so blocks land
instantly instead of in real time.

---

## Memory

The machine has no fixed RAM. On startup it measures the host — JS heap limit
where the browser exposes one, otherwise `navigator.deviceMemory` — and takes a
share of it. The gauge at the top left shows the budget and what is left;
`PRINT MEM` reports free bytes to BASIC. The display itself is the bulk of it:
255 × 175 × 255 is 11.4 MB of voxels.

---

## How it is put together

```
index.html          markup, HUD, manual, tape panel
css/style.css
vendor/three.min.js three r149 (UMD build, so no module server is needed)
js/boot.js          loads three (local first, then three CDNs) and the modules
js/zxconst.js       palette, 8x8 character set, keyword table, +2 key layout
js/memory.js        the RAM budget
js/world.js         voxel store, greedy chunk mesher, drawing primitives, raycast
js/screen2d.js      the 256x192 CRT -- one colour per pixel, no attribute file
js/keyboard.js      key-cap atlas and the 3D keyboard
js/basic.js         tokeniser, interpreter, the 3D extensions
js/tape.js          virtual tape, .tap tokenising and detokenising
js/assets.js        portable .zx3d scenery/sprite capture and validation
js/assetpanel.js    game-asset save/import panel and BASIC examples
js/z80.js           Z80 CPU core
js/spectrum.js      48K machine: ULA, ports, tape traps, snapshots, projection
js/terminal.js      the Machine (CRT + BASIC + tape + Z80) and the desks
js/player.js        the two movement modes
js/main.js          scene, sun, terminals, input, game loop
selftest.html       open it in a browser after changing anything: it builds the
                    world, runs the physics, the interpreter and the Z80, and
                    prints a pass/fail list
```

From the repository root, `node tools/test-zx3d-assets.js` verifies native asset
round-trips, sprite movement, materials, BASIC loading, invalid files and
large exports without requiring a browser or extra packages.

Notes on the interesting bits:

- **Chunk meshing.** 32³ chunks, greedy rectangle merge with the voxel value as
  the merge key, so a flood-filled background costs a handful of quads rather
  than forty thousand. Rebuilds are queued and spent against a 6 ms budget per
  frame. Solid voxels cast and receive shadows; glass is a second pass; glowing
  voxels are unlit.
- **Key caps.** All four keyboards share one canvas atlas, one cell per key,
  mapped onto each key box's top face. Redrawing the atlas re-letters every
  keyboard in the world at once — which is what has to happen the instant a
  shift goes down.
- **One machine, four windows.** The four terminals are access points to a
  single computer: one program, one screen, one tape. Walk to whichever is
  nearest and carry on.
- **Timing.** The BASIC interpreter runs in 4 ms slices and the mesher in 6 ms
  slices, so a running program never blocks the frame.

### Things worth knowing

- The floor of the display (voxel row 0) is protected from digging, so you
  cannot fall out of the world. `CLS` clears everything above it; `CLS 1`
  clears the floor too.
- A word is a keyword only if the *whole* word is one, except that a keyword
  running straight into a number still splits (`GOTO10`, `PAUSE50`). It will
  not split before a letter, so `letter`, `value`, `length` and `matrix`
  stay variables rather than becoming LET+ter and VAL+ue. Both entry modes put
  a space after a keyword anyway.
- There is no `MOD`; Sinclair never had one. Write `a-INT (a/b)*b`.
- `PUT` records the background for one instance per sprite number. Stamping
  the same sprite twice without an `UNPUT` between will record the first copy
  as part of the background — use `MOVE` in animation loops.
- 128K snapshots load, but as a 48K machine using pages 5, 2 and 0. Programs
  that page memory will misbehave.
- `.tzx` support covers standard and turbo data blocks; exotic block types are
  skipped.
