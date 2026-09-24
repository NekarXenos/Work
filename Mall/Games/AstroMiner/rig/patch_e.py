#!/usr/bin/env python3
"""v2.12.40 patch E — MEASURED, not planned.

The consolidation in patch B said the submersion rule was written twice. The
live-code guard then failed, because it was written FOUR times, and the two the
guard found are the two that disagreed with the other two: `playerInWater`
(v2.11.11) and the mob ground-clamp probe both carry an extra `!oc.dead` guard
that the swim check and `caveWaterAt` do not.

MEASURED ON THE SHIPPED BYTES: `oceanAtLocal` ends `if(!o||o.dead)return null;`
— on BOTH the strict path and the cone fallback, which also skips dead seas —
so it can never hand a dead ocean back and `!oc.dead` is provably inert at every
one of its callers. It is a dead arm, and this project deletes those rather than
keeping them as an apparent safeguard (the v2.11.44 `bySpecies` precedent).

So `playerInWater` becomes the third reader of pointSubmerged. The FOURTH site
is left exactly as it is and is not a restatement: the mob ground clamp compares
`hr` — the creature's own ground radius — against the level, not the length of
the point it probed with, so it is a different question with a coincidentally
similar shape."""
import io

P='/home/claude/work/Bleaux_v2_12_40.html'
s=io.open(P,encoding='utf-8').read()

def sub(old,new,label):
    global s
    n=s.count(old)
    assert n==1, 'ANCHOR %s occurs %d times, expected 1'%(label,n)
    s=s.replace(old,new,1)
    print('  ok  '+label)

sub("""function playerInWater(body){
    if(!body||!body.oceans)return false;
    const lp=_mS.copy(player.position).sub(body.position);
    const oc=oceanAtLocal(body,lp,true,true);   // v2.12.13: strict — see oceanAtLocal's header
    return !!(oc&&!oc.dead&&lp.length()<oc.level-0.15);
}""",
"""/* v2.12.40: THE THIRD READER OF pointSubmerged, and the one that made the
   consolidation worth doing — this was a FOURTH copy of the same sentence, and
   it is the copy that disagreed with the others. It carried an extra
   `!oc.dead`, which is MEASURED INERT: oceanAtLocal returns null for a dead
   ocean on both its paths (the cone fallback skips them and the tail re-checks),
   so no caller has ever been able to receive one. A guard that reduces to a
   no-op is deleted, not kept as an apparent safeguard — the v2.11.44
   `bySpecies` precedent. `_mS` is kept: this runs once a frame and the scratch
   vector is why it allocates nothing. */
function playerInWater(body){
    return !!pointSubmerged(body,_mS.copy(player.position).sub(body.position));
}""",'E1 playerInWater reads pointSubmerged')

# annotate the ONE remaining site so a future reader knows it was looked at
sub("""                let oc=null,submerged=false;
                if(body.oceans){
                    oc=oceanAtLocal(body,_mP,true,true);
                    submerged=!!(oc&&!oc.dead&&hr<oc.level-0.15);
                }""",
"""                /* v2.12.40 LOOKED AT AND DELIBERATELY LEFT. This is the one
                   test in the file that LOOKS like pointSubmerged and is not
                   one: it compares `hr` — the creature's own ground radius —
                   against the level, NOT the length of the point it probed
                   with, so \"is this creature's footing under water\" and \"is
                   this point under water\" are different questions that happen
                   to share a shape. Folding it in would have needed a second
                   parameter that exactly one caller ever passes, which is how a
                   consolidation turns back into a special case.
                   The `!oc.dead` here is inert for the reason stated at
                   playerInWater (oceanAtLocal cannot return a dead ocean) and
                   is left ONLY because this line is not being rewritten;
                   nothing reads it that the tail of oceanAtLocal has not
                   already answered. */
                let oc=null,submerged=false;
                if(body.oceans){
                    oc=oceanAtLocal(body,_mP,true,true);
                    submerged=!!(oc&&!oc.dead&&hr<oc.level-0.15);
                }""",'E2 annotate the fourth site')

io.open(P,'w',encoding='utf-8').write(s)
print('patch E written')
