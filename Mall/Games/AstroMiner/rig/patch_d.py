#!/usr/bin/env python3
"""v2.12.40 patch D: wiring — LMB, SHIFT+digit, the two key readouts, the
substep call, and the controls card."""
import io

P='/home/claude/work/Bleaux_v2_12_40.html'
s=io.open(P,encoding='utf-8').read()

def sub(old,new,label):
    global s
    n=s.count(old)
    assert n==1, 'ANCHOR %s occurs %d times, expected 1'%(label,n)
    s=s.replace(old,new,1)
    print('  ok  '+label)

# ---- D1  LMB dispatch: MEMBERSHIP, not a growing || chain ------------------
sub("""function fireActiveTool(){
    const id=activeToolId();
    if(id==='rifle'){rifleHeld=true;fireLaserRifle();}
    else if(id==='exlance'){lanceHeld=true;fireExorcismLance();}
}""",
"""/* v2.12.40: WHICH TOOLS ANSWER TO LMB AT ALL. Two call sites used to ask this
   as `id==='rifle'||id==='exlance'` — the mousedown handler, to decide whether
   the click is a shot or the start of a mining stroke, and fireActiveTool
   itself. A third member is the moment that stops being a coincidence, so it is
   a SET and the branch is a membership test: the same shape TOOL_IDS already
   uses for "does this thing belong in the hand at all", and for the same
   reason — the next weapon is a row, not an edit to two `||` chains that can
   silently disagree about which one this is. */
const LMB_TOOLS=new Set(['rifle','exlance','spear']);
function fireActiveTool(){
    const id=activeToolId();
    if(id==='rifle'){rifleHeld=true;fireLaserRifle();}
    else if(id==='exlance'){lanceHeld=true;fireExorcismLance();}
    /* v2.12.40: NO held flag, deliberately, and no entry in the mouseup
       release beside rifleHeld/lanceHeld. A beam autofires while the button is
       down; an arm throws once per press. The cooldown is in spearReady, so a
       mashed button is still one throw per SPEAR_CD either way — what the
       absence of the flag buys is that HOLDING does nothing at all, which is
       the honest reading of "throw". */
    else if(id==='spear')throwSpear();
}""",'D1 LMB_TOOLS + fireActiveTool')

sub("""            if(tool==='rifle'||tool==='exlance')fireActiveTool();  // v2.10.7/v2.12.1""",
"""            if(LMB_TOOLS.has(tool))fireActiveTool();  // v2.10.7/v2.12.1/v2.12.40""",'D2 mousedown routing')

# ---- D3  SHIFT+digit reads the key table instead of restating it ----------
sub("""                /* v2.12.39: SHIFT+0 is the LAST tool slot, the same rule the
                   item bar's own key 0 follows two lines below. Before the row
                   was widened past nine there was no tenth slot for it to
                   name, and `selectTool(-1)` was simply never reachable. */
                if(e.shiftKey){selectTool(n===0?HOTBAR_TOOL_SLOTS-1:n-1);break;}""",
"""                /* v2.12.39: SHIFT+0 is the LAST tool slot, the same rule the
                   item bar's own key 0 follows two lines below. Before the row
                   was widened past nine there was no tenth slot for it to
                   name, and `selectTool(-1)` was simply never reachable.
                   v2.12.40 RESTATES THAT AS WHAT IT ACTUALLY MEANT. \"Key 0 is
                   the last slot\" was only ever true while there happened to be
                   exactly as many slots as digits; the row is eleven wide now
                   and the old sentence would have jumped SHIFT+0 to slot 10 and
                   orphaned slot 9. The digit names the slot AT ITS OWN POSITION
                   IN THE KEY TABLE, which is the inverse of the question
                   hotbarToolKey answers for the two readouts — one table, read
                   both ways, so a slot's key and a key's slot cannot disagree.
                   Byte-identical behaviour for all ten digits today.
                   A digit with no slot answers -1, and selectTool refuses it. */
                if(e.shiftKey){selectTool(hotbarToolSlotForKey(String(n)));break;}""",'D3 SHIFT+digit')

# ---- D4  the two key readouts go through the one accessor -----------------
sub("""        d.innerHTML=`<div class="key">SHIFT+${HOTBAR_TOOL_KEYS[i]}</div>`+""",
"""        /* v2.12.40: through hotbarToolKey, so the slot past the last digit
           draws a blank key box rather than the string \"SHIFT+undefined\". */
        const kk=hotbarToolKey(i);
        d.innerHTML=`<div class="key">${kk?'SHIFT+'+kk:'&nbsp;'}</div>`+""",'D4 toolbar key readout')

sub("""            const key=on<0?'':(tool?('SHIFT+'+HOTBAR_TOOL_KEYS[on]):HOTBAR_KEYS[on]);
            const d=document.createElement('div');
            d.className='invitem'+(usable?'':' na')+(on>=0?' on':'');""",
"""            /* v2.12.40: same accessor as the toolbar. A tool sitting in the
               keyless eleventh slot is tagged as ON THE ROW (it is) with no
               key quoted (there is none) — rather than [SHIFT+undefined]. */
            const tk=tool?hotbarToolKey(on):'';
            const key=on<0?'':(tool?(tk?'SHIFT+'+tk:''):HOTBAR_KEYS[on]);
            const d=document.createElement('div');
            d.className='invitem'+(usable?'':' na')+(on>=0?' on':'');""",'D5 inventory key readout')

sub("""                        (on>=0?` <span style="color:var(--dim)">[${key}]</span>`:'')+""",
"""                        (on>=0&&key?` <span style="color:var(--dim)">[${key}]</span>`:'')+""",'D6 inventory key tag')

# ---- D7  the substep call --------------------------------------------------
sub("""            updateLogs(dt);          // v2.11.37        // v2.10.11: detached rock falls and settles""",
"""            updateLogs(dt);          // v2.11.37        // v2.10.11: detached rock falls and settles
            /* v2.12.40: beside the logs, and INSIDE the substep loop for the
               reason v2.11.53 states twenty lines up — a segment sweep run once
               per frame is as many times too long as there are substeps. After
               updateResidents/updateFish/updateCavers, so every creature it can
               hit has already moved for THIS substep. */
            updateSpears(dt);""",'D7 updateSpears in the substep loop')

# ---- D8  the controls card -------------------------------------------------
sub("""        SHIFT+1-7 or click a slot picks a tool directly · Wheel: material (tractor: hold distance)<br>""",
"""        SHIFT+1-9,0 or click a slot picks a tool directly · Wheel: material (tractor: hold distance)<br>""",'D8 help: tool keys')

sub("""        Oar equipped: [F] three rope-bound logs (side by side) to raft them — boards and paddles like the dugout canoe<br>""",
"""        Oar equipped: [F] three rope-bound logs (side by side) to raft them — boards and paddles like the dugout canoe<br>
        Spear equipped: LMB throws it. No range limit — but it falls the whole way, so aim high for distance. Works under water (shorter, the water drags it). [F] to pick it back up where it lands<br>""",'D9 help: the spear')

io.open(P,'w',encoding='utf-8').write(s)
print('patch D written')
