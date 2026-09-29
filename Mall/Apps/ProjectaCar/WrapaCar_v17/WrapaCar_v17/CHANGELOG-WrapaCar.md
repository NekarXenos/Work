# WrapaCar Changelog

---

## v17 — intakes: the vinyl laid flat across, the artwork projected down into them

### The fault

An intake, a vent or a grille opening is a negative space, and v16 unwrapped
it like any other part of the panel. Its walls and floor were flattened
together with the surface round it, so the flat layout had to make room for
walls the vinyl never lies on. The surface round the opening was pushed aside
to do it, and artwork that should run straight across bent round the hole.

On a flat 800 × 600 plate with one 200 × 100 × 40 mm pocket:

```
                      the plate round it moved in the layout   worst stretch
v16, vertical walls   26.0 mm                                  ×1.41
v16, drafted walls    21.8 mm                                  ×1.31
v16, a lip            8.0 mm                                   ×1.16
v17, all three        0.00000000001 mm                         ×1.00
```

In v16's flat-projection mode, vertical walls project to nothing and their
stretch is infinite. A straight line drawn across the pocket strays 4–7 mm off
straight in v16. In v17 it stays straight.

On the new built-in bumper, the mean stretch is 1.20× with the walls flattened
and 1.06× with the lids laid over. `tests/shots/before-after.png` shows both
atlases side by side.

### What v17 does, the way an installer does it

The installer lays the vinyl flat across the opening, then uses a heat gun to
press it in. v17 does the same:

1. **A lid is put over the opening.** It is fitted to the surface round the
   opening, so it continues that surface across the hole.
2. **The panel is flattened as if the lid filled the intake flush.** The print
   lays out true, and there is no hole to bend round.
3. **The artwork is projected straight down from the lid** into the intake. The
   floor gets it at full size. The walls get it as streaks, which is what the
   heat gun does.

In POV-Ray terms, the lid is a `height_field` stretched over the opening and
shaped by the ring of surface round it. The projection is an `image_map` with
`map_type 0` (planar), aimed square to that lid.

### Finding intakes: a rolling ball

**Find intakes** (new Intakes section) rolls a ball over the wrap panels. The
ball is as wide as the **widest intake** setting, 300 mm by default, measured
across the narrow side. Wherever the ball cannot touch, the surface falls away
beneath the vinyl, and that is a negative space.

A negative space counts as an intake when:

- the panel rings it, so it does not run off the panel's edge;
- it is deeper than 5 mm;
- it is no wider than the ball.

Anything else is left as it is. Mirrored pairs are found together.

The **review card** works like Suggested seams:

- ✓ or ✕ on each row, plus Accept all and Reject all;
- tap a row to fly to it;
- Esc dismisses the card.

Each row gives the opening's size, depth and stretch. Stretch ×2.0 means the
piece of vinyl over the opening gets pulled to twice its flat area.

**Intake mode** (key 8):

- tap an intake the search missed to add it; if the ball is too small for it,
  a ball two, four or eight times as wide is tried;
- tap a projected intake to take it away;
- with Mirror seams on, its mirror image goes with it;
- Undo cut takes any of it back.

### The lid

The lid is fitted to the **positive space round the opening**. It leaves out:

- any other negative space, so a grille's slots don't pull each other's lids
  down;
- anything past a crease;
- anything past a turn of more than 40° from the surface along the rim.

So a vent beside a body line, or near an edge that rolls under, gets a lid
that follows the surface it sits in. The lid's own triangles meet the rim
exactly, and accepting an intake creases its rim so that a rebuild keeps the
edge of the opening where it is.

The intake is kept by where it is (its rim, a point on its floor, its lid),
not by face numbers, so it survives seams and rebuilds elsewhere. A seam
through it drops it and says so.

### An opening that goes right through: covered

A grille with a lip, or a plain hole in the model: the lid covers it and the
artwork runs across it. The cut line skips the hole, and the installer trims
it on the car and tucks the edge. The lid is painted into the atlas and the
PDF clips the artwork to include it.

### Undercuts

A floor that runs out under the rim can't be seen from the lid. It is held to
the edge of the opening, as the vinyl would be.

### Vector artwork

Nothing changes in how you draw. A straight line across an intake prints as
one straight line and drops onto the floor like a slide. On the model, the
guide line is drawn on the surface and on the intake's floor. The walls are
almost edge-on to the lid, so the line crosses them in one step. To see the
streaks the walls get, tick **Atlas on the model**.

### Retopology and suggested seams

- Faces under a lid don't count toward "Retopology needed".
- **Suggest seams** treats a projected intake as filled. It proposes no seam
  round its walls or round the edge of a covered hole. It measures a panel's
  width as the vinyl will actually lie. It doesn't offer a covered opening's
  corners as notch points.

### Project artwork across intakes

On by default. Untick it and the panels are flattened as they are, walls and
all, exactly as in v16, and the unwrap reruns at once so you can compare.

### New built-in model: Bumper with intakes

It is 1800 mm across. It has a grille in the middle that goes right through
(its lip turns in 70 mm) and a vent in each lower corner with a floor 50 mm
down. Its mesh is mirror-symmetric down to the triangulation, so the two vents
measure exactly alike.

### Housekeeping

- v17 in the title, the brand line and the script banner.
- The PDF names its creator from the title. v16's PDF still said "WrapaCar
  v14".
- The .obj and .mtl headers say WrapaCar, not Seamwork.
- **At rest, v17 is v16.** With no intake accepted, every readout, every
  message and every saved byte (PDF, atlas PNG, OBJ, MTL and the zip) is
  identical to v16's, apart from those names.

### Caught during the build

- **The line caught on the walls.** Near a rim, samples of a vector line
  snapped onto a projected wall beside them and strayed 0.3–1.25 mm. The fix:
  a projected face takes only the samples it actually holds, and it wins them.
- **The bumper's two vents measured 272 and 271 mm.** The generator split
  every quad the same way, so the two sides were not mirror images: two
  corners of one vent were cut off diagonally. Each half is now split as the
  other's mirror image, and a corner of an opening keeps its corner.
- **A grille of 40 mm slots with 15 mm bars found nothing.** Each slot's lid
  was fitted partly into the next slot. The lid now leaves every other
  negative space out.
- **A vent 20–60 mm from a sharp fold was not found at all.** Its lid wrapped
  round the fold. The lid now stops at creases and at turns past 40°.
- **A noisy scan broke detection.** With ±0.5 mm of noise the vent measured
  159 × 322 mm instead of 120 × 200 mm, and at ±1 mm nothing was found.
  Detection now measures how rough the surface is: the ball may press into
  the surface by that much, and dents within the noise are left alone. The
  vent is now found true to size with noise up to ±1.5 mm.
- **The lid-fit rejection was removed.** No surface could be built where it
  decided anything the ball test hadn't already decided, and on a noisy scan
  it would have turned away small real vents.
- **The "no longer projected" note stayed up after Undo cut.** It is now
  cleared.
- **The mutation suite found four guards that no test exercised:**
  - a dent the ball bridges but which is too shallow to count;
  - a hole wider than the ball;
  - a lid pulled into a neighbouring dimple;
  - an L-shaped panel whose covered opening offered its corners as notch
    points.

  Each now has its own test. Three mutations turned out to be equivalent, so
  no test could ever catch them, and they were replaced:
  - the lid rule reaching panels without intakes changes nothing on a clean
    layout;
  - an unused residual field;
  - flattening every panel through the filled route with no holes, which is
    byte-identical.

### Tests

`bash tests/validate.sh`, after `npm install` for three.js 0.147.0:

1. the patch script rebuilds v17 from the shipped v16, byte for byte
2. `node --check` on the three scripts
3. one `var S = {`
4. the stamps, with nothing of v16 left
5. `comm -23` function list against the shipped v16: 73 additions, no
   removals
6. **geometry tier**, 112 checks. The cores run against synthetic surfaces
   with known answers:
   - pockets, drafted, curved, lipped and undercut;
   - plain holes and mirrored pairs;
   - folds, creases, slot grilles and noisy scans;
   - the lid's triangulation and the filled flattening;
   - the straight line;
   - resolving intakes again after seams and rebuilds;
   - suggested seams and the topology check.

   v16's cores run alongside as the control.
7. **DOM-stub tier**, 74 checks. The whole page runs in `vm.createContext`,
   driven through its own listeners:
   - Find, the review card, Esc, accept, clear and undo;
   - the unwrap with projection on and off;
   - the lids in the atlas and in the PDF clip;
   - one cut line against two;
   - Intake-mode taps, with and without the mirror;
   - a seam through the vents;
   - a pocket plate opened as an .obj, with the line on the model measured
     straight to 0.00001 mm.
8. **regression tier**, 61 checks. One session runs on v16 and v17 and every
   step and every saved byte is compared:
   - seams and a suggested seam;
   - the topology check and a rebuild;
   - both flattening modes, with mirrored twins shared and split;
   - vector art;
   - the sphere and the box.
9. **mutation suite**, 43 faults, one at a time. Every one is caught.
10. **browser tier**, optional: headless Chromium with real WebGL and real
    clicks, 8 checks and three screenshots.
