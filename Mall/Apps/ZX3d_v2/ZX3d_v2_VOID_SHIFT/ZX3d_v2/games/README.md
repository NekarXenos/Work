# VOID SHIFT — Spectrum Doom

The complete game listing is in `DOOM.bas`. It uses this application's Sinclair BASIC interpreter and its existing `SCREEN 4` voxel commands. The level builder, sentries, line of sight, damage, ammunition, supplies, doors, and transitions are all BASIC code.

Launch **VOID SHIFT** from the application. Move with **WASD**, aim with the **mouse** or **arrow keys**, fire with **click or Space**, and press **E** to open a yellow door or operate the green lift. Press **Esc** to pause and release the mouse. The pause and result screens provide restart and exit controls.

Find and destroy all six sentries in each level, then stand on the green landing at the east edge and press E. The lift wraps the player to the west entrance while replacing the entire map. Health, ammunition, and total kills carry across the transition. The arrival landing is blue and is far from the next exit, so it cannot immediately trigger another transition. Clear **Reactor**, **Foundry**, and **Void Core** to win.

Yellow supply crates restore 16 rounds. White medkits with a red cross restore 30 health. Supplies remain available when their corresponding resource is already full. Each defeated sentry also returns two rounds. Health is capped at 100 and ammunition at 99. Sentries take two hits in the first level and three in the later levels; walls and closed doors stop bullets and block enemy sight.

## Editing the BASIC game

The main loop starts at line 500 and pauses for five Spectrum frames per iteration. The map builder is at 1000, shooting at 2000, door/lift use at 2500, supplies at 2800, sentry behavior at 3000, and sprite definitions at 4000. The three map data sections start at 6000, 6200, and 6400.

The app's virtual tape contains the program as **DOOM**. In the 3D Screen terminal, open Tape, select DOOM, and use LIST to inspect it. Enter a numbered BASIC line to replace that line, then SAVE under a new tape name and RUN to try the change. The text file is also editable in an ordinary editor; importing its contents requires the program to be stored on the virtual tape or included in the bundled listing.

Each map is an 11 × 11 grid of 20-voxel cells, beginning at x/z 17. Map strings use `1` for a wall, `0` for an open cell, and `2` for a closed yellow door. Coordinates in the following DATA lines are one-based column and row. Every map has exactly two doors, six enemies, and four supplies. Supply entries also contain a kind: `1` ammunition or `2` medkit. Keep the west arrival at cell (2,6) and the east lift at (10,6) open.

The floor is at y=0 and the closed ceiling begins at y=28. The player arrives at x=47, feet y=1, z=127, looking east. Sentries are seven voxels wide, nineteen high, and five deep. BASIC checks their movement against walls, the player, other sentries, and supplies so their saved sprite backgrounds never overlap. Every sprite is removed before changing the map.

## BASIC-to-screen interface

The host supplies input, the first occupied voxel under the crosshair, movement, and the HUD. It does not decide damage, kills, doors, map progression, or victory.

| Address | Meaning |
| --- | --- |
| POKE 64000 | State: 0 exit, 1 building, 2 playing, 3 dead, 4 victory |
| PEEK 64001–64003 | Player x, feet y, and z in BASIC coordinates |
| PEEK 64004 | Yaw byte: 0 +z, 64 −x, 128 −z, 192 +x |
| PEEK 64005–64007 | First aimed voxel x, y, z |
| PEEK 64008 | Aimed voxel found, 0/1 |
| PEEK 64009 | Distance to the aimed voxel |
| PEEK 64013 | Consume fire event and latch its aim snapshot |
| PEEK 64014 | Consume use event |
| POKE 64020–64024 | Health, ammunition, level, total kills, current enemies remaining |
| POKE 64025 | Status message identifier |
| POKE 64026 / 64027 | Shot / damage feedback pulse |
| POKE 64028 | Set yaw byte for arrival |

Status IDs are 0 normal, 1 building, 2 use yellow doors, 3 lift locked, 4 door open, 5 ammo collected, 6 medkit collected, 7 hostile hit, 8 hostile defeated, 9 no ammunition, 10 map changed, 11 death, 12 victory, 13 use green lift, 14 weapon cooling, and 15 under fire. BASIC reads the aim coordinates after consuming a fire event, so each shot uses the correct captured direction.
