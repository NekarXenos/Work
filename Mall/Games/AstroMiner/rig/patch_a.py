#!/usr/bin/env python3
"""v2.12.40 THE SPEAR — patch A: the item, the row it lives in, the recipe.
Every replacement asserts its anchor occurs EXACTLY once before it fires."""
import io,sys

P='/home/claude/work/Bleaux_v2_12_40.html'
s=io.open(P,encoding='utf-8').read()

def sub(old,new,label):
    global s
    n=s.count(old)
    assert n==1, 'ANCHOR %s occurs %d times, expected 1'%(label,n)
    s=s.replace(old,new,1)
    print('  ok  '+label)

# ---- A1  the material row -------------------------------------------------
sub("""defMat('axe',0x7a6a52,false);""",
"""defMat('axe',0x7a6a52,false);
/* v2.12.40 THE SPEAR. Filed here rather than with the flint it is tipped with
   for the reason v2.12.39 gave when it filed the axe under ORGANIC: a composite
   tool is named by its haft. Not buildable — a 1-unit cube of spear is not a
   thing, and TOOL_IDS is what earns it a slot (see the v2.11.37 note there).
   The colour splits the axe's haft-brown toward the flint head's blue-grey,
   the same way the axe splits the difference between its own two halves. */
defMat('spear',0x6d5a3e,false);""",'A1 defMat spear')

# ---- A2  ITEM_GROUPS: the composite tools ---------------------------------
sub("""     ids:['wood','stick','oar','rope','axe','frond','grass','hay','anemone']},""",
"""     /* v2.12.40: the spear files beside the axe, and for the axe's own stated
        reason — wood plus something lashed to it. Directly after it, because
        that is the order the player makes them in: an edge first, then an edge
        on the end of a stick. */
     ids:['wood','stick','oar','rope','axe','spear','frond','grass','hay','anemone']},""",'A2 ITEM_GROUPS organic')

# ---- A3  the tool row widens to seven carried tools ------------------------
sub("""const HOTBAR_TOOL_ITEM_SLOTS=6;                        // stick/oar/rope/flint/blade/axe
const HOTBAR_TOOL_SLOTS=HOTBAR_STANCE_SLOTS+HOTBAR_TOOL_ITEM_SLOTS;   // 10
const HOTBAR_TOOL_KEYS=['1','2','3','4','5','6','7','8','9','0'];   // read with SHIFT held""",
"""/* v2.12.40 WIDENED TO SEVEN, AND THE DIGITS RAN OUT. The spear is the seventh
   carried tool, which makes eleven slots against ten digits, and that is not a
   number this file gets to choose. So the KEY TABLE stops being an index into
   the slots and becomes what it always actually was — a list of the digits
   there are. hotbarToolKey() is the one place that answers "what key names this
   slot", it answers '' for a slot past the end of the digits, and the two
   readers (the toolbar and the inventory screen) both go through it.
   WHICH SLOT LOSES ITS DIGIT IS THE CARE. Slot 10 is the LAST entry in the MRU
   half — the carried tool you have gone longest without touching. Everything
   you have just gained or just used is at the front of that list (hotbarFront),
   so the keyless slot is by construction the one you were least likely to reach
   for. It is still selected by MMB (cycleTool walks every occupied slot) and by
   clicking it, both of which the row has had since v2.12.0; and [I] ->
   hotbarPromote re-fronts anything from the inventory screen. Nothing became
   unreachable — one thing became one click instead of one key. */
const HOTBAR_TOOL_ITEM_SLOTS=7;                        // stick/oar/rope/flint/blade/axe/spear
const HOTBAR_TOOL_SLOTS=HOTBAR_STANCE_SLOTS+HOTBAR_TOOL_ITEM_SLOTS;   // 11
const HOTBAR_TOOL_KEYS=['1','2','3','4','5','6','7','8','9','0'];   // read with SHIFT held
/* the digit that names a tool slot, or '' when there is none. ONE site, three
   callers: the toolbar draw, the inventory screen's [SHIFT+n] tag, and the
   SHIFT+digit handler, which now asks the INVERSE of this question rather than
   restating "key 0 is the last slot" — a sentence that was true only while the
   two counts happened to match. */
function hotbarToolKey(slot){return HOTBAR_TOOL_KEYS[slot]||'';}
function hotbarToolSlotForKey(k){return HOTBAR_TOOL_KEYS.indexOf(k);}""",'A3 tool row width')

# ---- A4  TOOL_IDS ----------------------------------------------------------
sub("""const TOOL_IDS=new Set(['stick','oar','rope','flint','flint_blade','axe']);""",
"""/* v2.12.40: a seventh, and STILL membership rather than a branch — a spear is
   held to be thrown, which is one more reason to be in the hand and no reason
   at all to be a new kind of thing. */
const TOOL_IDS=new Set(['stick','oar','rope','flint','flint_blade','axe','spear']);""",'A4 TOOL_IDS')

# ---- A5  the recipe --------------------------------------------------------
sub(""" {key:'electrolysis',name:'Electrolyse Ice',""",
""" /* v2.12.40 THE SPEAR. \"It needs flint blade, string, and 2 sticks.\"
    FLAGGED INTERPRETATION — \"STRING\" IS `rope`. There is no string item and
    adding one would have been a second cordage sitting beside the first with
    the same meaning: rope is what this game binds things with, it is what the
    axe two rows up lashes its own head on with, and it comes off two coconuts
    at once:false so nothing here is gated behind a rare drop. Inventing
    `string` would have needed a source, a hotbar home and a reason to exist
    that is not \"rope, but smaller\".
    The head is a KNAPPED BLADE, not a whole rock — that is the brief's own
    word and it is also what separates this from the axe, which takes the rock
    entire. Two sticks, exactly as asked, and they are the shaft: SPEAR_LEN is
    derived from that count rather than picked (see it).
    once:false for the reason every other tool on this list is: a spear is
    thrown, and a thrown thing can be lost. */
 {key:'spear',name:'Flint Spear',desc:'A knapped blade lashed to a two-stick shaft. A TOOL — equip it in the tool row and LMB to throw. It flies as far as the arm and the ground allow, drops further the further it goes, and works just as well under water. It comes to rest where it lands: [F] to pick it back up.',
  cost:{flint_blade:1,rope:1,stick:2},yields:{spear:1},once:false},

 {key:'electrolysis',name:'Electrolyse Ice',""",'A5 recipe row')

io.open(P,'w',encoding='utf-8').write(s)
print('patch A written')
