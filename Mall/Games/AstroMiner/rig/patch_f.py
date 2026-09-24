#!/usr/bin/env python3
"""v2.12.40 patch F: the title tag and the changelog entry."""
import io
P='/home/claude/work/Bleaux_v2_12_40.html'
s=io.open(P,encoding='utf-8').read()

def sub(old,new,label):
    global s
    n=s.count(old)
    assert n==1,'ANCHOR %s occurs %d times, expected 1'%(label,n)
    s=s.replace(old,new,1);print('  ok  '+label)

sub("<title>Bleaux AstroMiner — v2.12.39</title>",
    "<title>Bleaux AstroMiner — v2.12.40</title>",'F1 title')

ENTRY = """   v2.12.40: THE SPEAR — AND THE DIGITS RAN OUT.
             PLAYER BRIEF, VERBATIM: "Add a Spear as a craftable item. It needs
             flint blade, string, and 2 sticks. Since its a tiny planet, theres
             no limit on distance. You can also spear under water. Gravity
             affects the spear so it drops more with distance."

             THE FIRST WEAPON IN THIS GAME THAT IS NOT A BEAM. The rifle, the
             mining laser and the radiation lance are all ONE raycast at the
             instant of the click: they arrive where the crosshair was,
             immediately, out to a range constant. Every line of this release
             exists because a spear is none of those — it is an OBJECT that
             leaves your hand, is pulled on the way, arrives somewhere the
             crosshair was not, and is still lying there afterwards.

             "NO LIMIT ON DISTANCE" IS THE ABSENCE OF A CONSTANT, NOT A LARGE
             ONE. There is no SPEAR_RANGE. RIFLE_RANGE is 60 because a beam that
             reached forever would be a sniper rifle with no counterplay; a
             spear needs no such number because GRAVITY IS THE RANGE. The
             brief's third sentence is why its second one costs nothing.
             MEASURED on the rig, thrown from a standing height on a sphere of
             known radius: level 38 u, lofted 21 degrees 147 u, lofted 45
             degrees 125 u. SPEAR_LIFE (10 s) is a backstop against a shaft that
             finds nothing at all to hit, not a range in disguise.

             GRAVITY IS 14 AND IT IS NOT A NEW 14. Mobs, falling cubes, boulders
             and logs already fall at that rate; SPEAR_G is DERIVED from LOG_G,
             which is itself derived from BOULDER_G. A spear that fell at a
             different rate from the log it lands beside would be a second
             answer to a question this file already answered once.

             THE SWEEP IS A SEGMENT, so nothing tunnels: each substep the shaft
             asks what is FIRST between where it was and where it is going.
             Inside the substep loop, beside updateLogs, for the reason v2.11.53
             states at that exact spot. WHAT IT HITS IS DELIBERATELY NARROWER
             THAN THE BEAM'S TEN-WAY ARBITRATION — a flint point damages things
             that bleed (the three creature substrates and a ground guard) and
             merely STOPS on everything else. It does not chop a tree, crack a
             crystal, wreck a hut or dig. Sharing the beam's arbitration would
             have meant either giving a thrown stick the mining laser's powers
             or bolting a "but not if it is a spear" flag onto ten branches.

             UNDER WATER IS THE SAME THROW WITH DRAG ON IT. Nothing about the
             verb, the aim or the targets changes — fish were already one of the
             three substrates. SPEAR_WATER_K decays the WHOLE velocity, gravity's
             accumulation included, so the shaft also stops plummeting and
             settles to a slow sink at SPEAR_G/SPEAR_WATER_K = 4 u/s. Reach
             under water is SPEAR_SPEED/SPEAR_WATER_K = 12 u: a lake's width of
             fish, and nothing like the open-air throw.

             IT LANDS AS A HEAP, WHICH IS THE WHOLE OF "GO AND GET IT BACK". A
             LOG_KINDS row and nothing else: [F] picks it up through carryVerb's
             existing `pocket` branch, mining it works, the tractor beam grabs
             it, and saveBodyLogs/restoreSavedLogs persist it. Not one line of
             the heap system was edited. This is v2.11.44's promise collected
             for the third time, after v2.12.35's coal and v2.12.39's flint.

             FLAGGED INTERPRETATION — "STRING" IS `rope`. There is no string
             item, and adding one would have been a second cordage beside the
             first with the same meaning: rope is what this game binds with, it
             is what the flint axe lashes its own head on with, and it is
             once:false off two coconuts. Inventing `string` would have needed a
             source, a hotbar home and a reason to exist that is not "rope, but
             smaller". The HEAD is a knapped BLADE, not a whole rock — the
             brief's own word, and what separates this from the axe.

             THE DIGITS RAN OUT, AND THAT IS A REAL CHANGE. The spear is the
             seventh carried tool, which makes ELEVEN slots against TEN digits.
             So HOTBAR_TOOL_KEYS stops being an index into the slots and becomes
             what it always was — a list of the digits there are. hotbarToolKey
             answers "what key names this slot" (and '' past the end);
             hotbarToolSlotForKey answers the inverse, and the SHIFT+digit
             handler now asks it instead of restating "key 0 is the last slot" —
             a sentence that was true only while the two counts happened to
             match, and which at eleven slots would have jumped SHIFT+0 to slot
             10 and silently ORPHANED slot 9. Byte-identical for all ten digits
             today. The keyless slot is the LAST entry in the MRU half, i.e. the
             tool gone longest untouched; it is still reached by MMB and by
             clicking it, and [I] re-fronts anything. Nothing became
             unreachable — one thing became one click instead of one key.

             [DEFECT FOUND WHILE CONSOLIDATING, MEASURED] "IS THIS POINT UNDER
             WATER" WAS WRITTEN FOUR TIMES AND THE FOUR DISAGREED. The pair
             "strict local-ocean read, then below its level by the 0.15 skin"
             appeared in updatePlayerOnFoot, in caveWaterAt, in playerInWater and
             in the mob ground clamp — and TWO of them carried an extra
             `!oc.dead` that the other two did not. MEASURED on the shipped
             bytes: oceanAtLocal ends `if(!o||o.dead)return null;` and its cone
             fallback skips dead seas, so it can NEVER hand a dead ocean back and
             `!oc.dead` is provably inert at every caller. Three sites now read
             one `pointSubmerged`; the inert guard is DELETED rather than kept as
             an apparent safeguard (the v2.11.44 `bySpecies` precedent). The
             FOURTH site is left exactly as it was and is NOT a restatement: it
             compares `hr`, the creature's own ground radius, against the level
             rather than the length of the point it probed with. Two questions
             that share a shape.

             ALSO FLAGGED: (a) an in-flight spear is not save state — the save
             is PROGRESS and already declines to capture anything mid-flight; a
             landed one is a log and is saved like every other log, and leaving
             the planet drops an airborne one for the same reason. (b) The shaft
             keeps the pose it arrived at (attachLog takes an explicit
             quaternion, updateLogs has no rotation term), so it stands in the
             ground at the angle it came down; a terrain hit is born RESTING, a
             creature hit is NOT, because the animal may have been swimming or
             six units up a slope. (c) SPEAR_DMG is 6, twice a rifle bolt,
             because it is one throw you then have to walk to. (d) LMB dispatch
             became a SET rather than a third `||` in two places that could
             disagree. (e) No held-fire flag: a beam autofires, an arm throws
             once per press.

             TESTS: 48 assertions against real three r170 with the shipped module
             sliced out of the file, pre-fix controls on v2.12.39 bytes, 31/31
             targeted mutants killed, null mutant survives, 7/7 seeds
             (7/3/11/42/99/5/13). FIVE mutants survived the first sweep and every
             one was a TEST defect, not an equivalent mutant: the SHIFT+digit
             tests all asserted the helper and never the handler that calls it;
             the sweep fixture only ever populated ONE candidate list, so "take
             the first list that answers" passed; nothing asserted either half of
             the landing pose; and the dead-ocean test went through the cone
             fallback, whose own loop already skips dead seas, so oceanAtLocal's
             closing guard was never reached. THREE RIG DEFECTS were found and
             fixed on the way: the top-level scanner was line-based and dropped
             every name past the first line of a wrapped declaration list
             (`rocketState` among them — the same family as the v2.12.27 defect,
             exports 1965 -> 2037); its replacement then dropped 811 names
             because a statement body starts at the space after `const` and a
             space is not an identifier character; and the DOM shim rebuilt its
             listener registry per module instance, so dispatched events went to
             whichever game booted last and the keydown test read as vacuous
             three runs running.

"""

sub("   v2.12.39: FLINT — STRIKE, KNAP, HAFT.",
    ENTRY+"   v2.12.39: FLINT — STRIKE, KNAP, HAFT.",'F2 changelog entry')

io.open(P,'w',encoding='utf-8').write(s)
print('patch F written')
