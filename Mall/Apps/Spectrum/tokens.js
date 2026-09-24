/* ============================================================
   Spectrum · tokens.js
   The BASIC keyword table and the keyboard it is printed on.

   A Spectrum program is stored with every keyword as a single
   byte, 0xA5..0xFF. The editor, the lister, the tokeniser and the
   3D keycaps all read this one table, so a keyword only ever has
   to be spelled once.
   ============================================================ */

/* code -> keyword, exactly as the ROM orders them */
export const TOKENS = {
  0xa3: 'SPECTRUM', 0xa4: 'PLAY',
  0xa5: 'RND', 0xa6: 'INKEY$', 0xa7: 'PI', 0xa8: 'FN', 0xa9: 'POINT',
  0xaa: 'SCREEN$', 0xab: 'ATTR', 0xac: 'AT', 0xad: 'TAB', 0xae: 'VAL$',
  0xaf: 'CODE', 0xb0: 'VAL', 0xb1: 'LEN', 0xb2: 'SIN', 0xb3: 'COS',
  0xb4: 'TAN', 0xb5: 'ASN', 0xb6: 'ACS', 0xb7: 'ATN', 0xb8: 'LN',
  0xb9: 'EXP', 0xba: 'INT', 0xbb: 'SQR', 0xbc: 'SGN', 0xbd: 'ABS',
  0xbe: 'PEEK', 0xbf: 'IN', 0xc0: 'USR', 0xc1: 'STR$', 0xc2: 'CHR$',
  0xc3: 'NOT', 0xc4: 'BIN', 0xc5: 'OR', 0xc6: 'AND', 0xc7: '<=',
  0xc8: '>=', 0xc9: '<>', 0xca: 'LINE', 0xcb: 'THEN', 0xcc: 'TO',
  0xcd: 'STEP', 0xce: 'DEF FN', 0xcf: 'CAT', 0xd0: 'FORMAT', 0xd1: 'MOVE',
  0xd2: 'ERASE', 0xd3: 'OPEN #', 0xd4: 'CLOSE #', 0xd5: 'MERGE', 0xd6: 'VERIFY',
  0xd7: 'BEEP', 0xd8: 'CIRCLE', 0xd9: 'INK', 0xda: 'PAPER', 0xdb: 'FLASH',
  0xdc: 'BRIGHT', 0xdd: 'INVERSE', 0xde: 'OVER', 0xdf: 'OUT', 0xe0: 'LPRINT',
  0xe1: 'LLIST', 0xe2: 'STOP', 0xe3: 'READ', 0xe4: 'DATA', 0xe5: 'RESTORE',
  0xe6: 'NEW', 0xe7: 'BORDER', 0xe8: 'CONTINUE', 0xe9: 'DIM', 0xea: 'REM',
  0xeb: 'FOR', 0xec: 'GO TO', 0xed: 'GO SUB', 0xee: 'INPUT', 0xef: 'LOAD',
  0xf0: 'LIST', 0xf1: 'LET', 0xf2: 'PAUSE', 0xf3: 'NEXT', 0xf4: 'POKE',
  0xf5: 'PRINT', 0xf6: 'PLOT', 0xf7: 'RUN', 0xf8: 'SAVE', 0xf9: 'RANDOMIZE',
  0xfa: 'IF', 0xfb: 'CLS', 0xfc: 'DRAW', 0xfd: 'CLEAR', 0xfe: 'RETURN',
  0xff: 'COPY'
};

export const TOKEN_CODE = {};
for (const k in TOKENS) TOKEN_CODE[TOKENS[k]] = +k;

/* Spellings the natural-typing mode will also accept. GOTO and GOSUB are
   the ones everybody actually types; the rest smooth over spacing. */
export const TOKEN_ALIASES = {
  'GOTO': 0xec, 'GOSUB': 0xed, 'DEFFN': 0xce, 'OPEN#': 0xd3, 'CLOSE#': 0xd4,
  'RANDOMISE': 0xf9, 'INKEY': 0xa6, 'SCREEN': 0xaa
};

/* Longest first, so "RESTORE" is never read as "REST" + "ORE" */
export const TOKEN_WORDS = Object.keys(TOKEN_CODE)
  .concat(Object.keys(TOKEN_ALIASES))
  .filter(w => /^[A-Z]/.test(w))
  .sort((a, b) => b.length - a.length);

export function tokenOf(word) {
  const w = word.toUpperCase();
  return TOKEN_CODE[w] !== undefined ? TOKEN_CODE[w] : (TOKEN_ALIASES[w] !== undefined ? TOKEN_ALIASES[w] : 0);
}

/* ------------------------------------------------------------
   The keyboard matrix — eight half rows of five keys, read back
   on A8..A15 exactly as the ULA does it.
   ------------------------------------------------------------ */
export const MATRIX = [
  ['CAPS', 'Z', 'X', 'C', 'V'],
  ['A', 'S', 'D', 'F', 'G'],
  ['Q', 'W', 'E', 'R', 'T'],
  ['1', '2', '3', '4', '5'],
  ['0', '9', '8', '7', '6'],
  ['P', 'O', 'I', 'U', 'Y'],
  ['ENTER', 'L', 'K', 'J', 'H'],
  ['SPACE', 'SYM', 'M', 'N', 'B']
];
export const MATRIX_POS = {};
MATRIX.forEach((half, r) => half.forEach((k, b) => { MATRIX_POS[k] = [r, b]; }));

/* ------------------------------------------------------------
   The ZX Spectrum +2 keycaps, laid out the way ZX Spectrum 3D
   lays them: a function row across the top, twelve key units
   wide, and ENTER two rows tall.

   Every cap resolves to one or more matrix keys: the +2's extra
   caps are wired as shifted combinations of the original forty,
   which is why DELETE really is CAPS SHIFT and 0.

   legends
     kw      the K-mode keyword
     sym     SYMBOL SHIFT
     ext     EXTEND MODE
     esym    EXTEND MODE with SYMBOL SHIFT
     col     the colour a digit selects, printed where esym would be
   type      'normal' for a letter or digit; anything else is a
             function cap that just says what it is
   ------------------------------------------------------------ */
const N = (id, kw, sym, ext, esym, extra) =>
  Object.assign({ id, main: id, kw, sym, ext, esym, keys: [id], type: 'normal' }, extra || {});
const F = (id, main, keys, extra) =>
  Object.assign({ id, main, kw: '', sym: '', ext: '', esym: '', keys, type: 'fn' }, extra || {});
const GAP = w => ({ gap: w });

const ROWS = [
  [
    F('EXTEND', 'EXTEND', ['CAPS', 'SYM'], { w: 1.5 }),
    F('EDIT', 'EDIT', ['CAPS', '1']),
    F('CAPSLOCK', 'CAPS LOCK', ['CAPS', '2']),
    F('TRUEVID', 'TRUE VID', ['CAPS', '3']),
    F('INVVID', 'INV VID', ['CAPS', '4']),
    F('BREAK', 'BREAK', ['CAPS', 'SPACE']),
    F('LEFT', '←', ['CAPS', '5']),
    F('DOWN', '↓', ['CAPS', '6']),
    F('UP', '↑', ['CAPS', '7']),
    F('RIGHT', '→', ['CAPS', '8']),
    F('DELETE', 'DELETE', ['CAPS', '0'], { w: 1.5 })
  ],
  [
    N('1', '', '!', 'DEF FN', '', { col: 'BLUE' }),
    N('2', '', '@', 'FN', '', { col: 'RED' }),
    N('3', '', '#', 'LINE', '', { col: 'MAGENTA' }),
    N('4', '', '$', 'OPEN #', '', { col: 'GREEN' }),
    N('5', '', '%', 'CLOSE #', '', { col: 'CYAN' }),
    N('6', '', '&', 'MOVE', '', { col: 'YELLOW' }),
    N('7', '', "'", 'ERASE', '', { col: 'WHITE' }),
    N('8', '', '(', 'POINT', ''),
    N('9', '', ')', 'CAT', ''),
    N('0', '', '_', 'FORMAT', '', { col: 'BLACK' }),
    F('GRAPH', 'GRAPH', ['CAPS', '9'], { w: 2 })
  ],
  [
    N('Q', 'PLOT', '<=', 'SIN', 'ASN'),
    N('W', 'DRAW', '<>', 'COS', 'ACS'),
    N('E', 'REM', '>=', 'TAN', 'ATN'),
    N('R', 'RUN', '<', 'INT', 'VERIFY'),
    N('T', 'RANDOMIZE', '>', 'RND', 'MERGE'),
    N('Y', 'RETURN', 'AND', 'STR$', '['),
    N('U', 'IF', 'OR', 'CHR$', ']'),
    N('I', 'INPUT', 'AT', 'CODE', 'IN'),
    N('O', 'POKE', ';', 'PEEK', 'OUT'),
    N('P', 'PRINT', '"', 'TAB', '©'),
    F('ENTER', 'ENTER', ['ENTER'], { w: 2, h: 2 })
  ],
  [
    N('A', 'NEW', 'STOP', 'READ', '~'),
    N('S', 'SAVE', 'NOT', 'RESTORE', '|'),
    N('D', 'DIM', 'STEP', 'DATA', '\\'),
    N('F', 'FOR', 'TO', 'SGN', '{'),
    N('G', 'GO TO', 'THEN', 'ABS', '}'),
    N('H', 'GO SUB', '^', 'SQR', 'CIRCLE'),
    N('J', 'LOAD', '-', 'VAL', 'VAL$'),
    N('K', 'LIST', '+', 'LEN', 'SCREEN$'),
    N('L', 'LET', '=', 'USR', 'ATTR'),
    GAP(1)                                   // where ENTER comes down
  ],
  [
    F('CAPS', 'CAPS SHIFT', ['CAPS'], { w: 1.5, type: 'shift' }),
    N('Z', 'COPY', ':', 'LN', 'BEEP'),
    N('X', 'CLEAR', '£', 'EXP', 'INK'),
    N('C', 'CONTINUE', '?', 'LPRINT', 'PAPER'),
    N('V', 'CLS', '/', 'LLIST', 'FLASH'),
    N('B', 'BORDER', '*', 'BIN', 'BRIGHT'),
    N('N', 'NEXT', ',', 'INKEY$', 'OVER'),
    N('M', 'PAUSE', '.', 'PI', 'INVERSE'),
    F('SYM', 'SYMBOL SHIFT', ['SYM'], { w: 1.5, type: 'shift' }),
    F('SPACE', 'SPACE', ['SPACE'], { w: 2 })
  ]
];

export const KB_UNITS_W = 12;
export const KB_UNITS_H = ROWS.length;

/* lay the caps out: x and y in key units from the top left, w by h */
export const KEYCAPS = [];
ROWS.forEach((row, y) => {
  let x = 0;
  for (const k of row) {
    if (k.gap) { x += k.gap; continue; }
    k.x = x; k.y = y; k.w = k.w || 1; k.h = k.h || 1;
    x += k.w;
    KEYCAPS.push(k);
  }
});

/* Caps a PC keyboard can reach that the +2 board has no key of its
   own for. They are never drawn; the ones with an alias light up the
   cap that does the same job. */
KEYCAPS.push(
  F('CAPS2', 'CAPS SHIFT', ['CAPS'], { type: 'shift', hidden: true, alias: 'CAPS' }),
  F('SEMI', ';', ['SYM', 'O'], { hidden: true, alias: 'O' }),
  F('QUOTE', '"', ['SYM', 'P'], { hidden: true, alias: 'P' }),
  F('COMMA', ',', ['SYM', 'N'], { hidden: true, alias: 'N' }),
  F('STOP', '.', ['SYM', 'M'], { hidden: true, alias: 'M' })
);

export const CAP_BY_ID = {};
for (const k of KEYCAPS) CAP_BY_ID[k.id] = k;

/* what CAPS SHIFT turns a digit into, on the machine and on the caps */
export const CAPS_DIGIT = { '1': 'EDIT', '2': 'CAPSLOCK', '3': 'TRUEVID', '4': 'INVVID', '5': 'LEFT', '6': 'DOWN', '7': 'UP', '8': 'RIGHT', '9': 'GRAPH', '0': 'DELETE' };

/* ------------------------------------------------------------
   What a cap does right now. This is the single source of truth
   for the live legend on the key, the NEXT readout, and the thing
   the editor actually receives.
   st: { mode: 'K'|'L'|'C'|'E'|'G', caps, sym, capsLock, natural }
   natural is ordinary PC typing, where shift and a digit give the
   PC's own symbol rather than the +2's cursor and edit keys.
   ------------------------------------------------------------ */
export function capLegend(cap, st) {
  if (cap.type !== 'normal') return { text: cap.main, kind: 'special' };
  const isLetter = /^[A-Z]$/.test(cap.id);
  if (st.mode === 'E') {
    if (st.sym && cap.esym) return { text: cap.esym, kind: 'esym' };
    if (cap.ext) return { text: cap.ext, kind: 'ext' };
  }
  if (st.sym && cap.sym) return { text: cap.sym, kind: 'sym' };
  if (!isLetter && st.caps && !st.natural && CAPS_DIGIT[cap.id]) return { text: CAP_BY_ID[CAPS_DIGIT[cap.id]].main, kind: 'caps' };
  if (st.mode === 'G') return { text: cap.main, kind: 'graph' };
  if (st.mode === 'K' && cap.kw) return { text: cap.kw, kind: 'kw' };
  if (!isLetter) return { text: cap.main, kind: 'cap' };
  return { text: (!!st.capsLock !== !!st.caps) ? cap.id : cap.id.toLowerCase(), kind: 'cap' };
}
