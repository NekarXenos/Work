/* ==========================================================================
   zxconst.js -- palette, character set, keyword table and the +2 keyboard.
   ========================================================================== */
(function (ZX) {
  'use strict';

  /* ---- geometry of the machine ------------------------------------------ */
  ZX.SCREEN_W = 255;   // pixels across  (x)
  ZX.SCREEN_H = 175;   // pixels up      (y)
  ZX.SCREEN_D = 255;   // pixels deep    (z, into the screen)
  ZX.PIX = 0.125;      // one pixel is one eighth of a metre
  ZX.CHUNK = 32;       // voxels per chunk edge

  // 3D text grid: whole 8x8 cells that fit in the solid display
  ZX.TCOLS = Math.floor(ZX.SCREEN_W / 8);   // 31
  ZX.TROWS = Math.floor(ZX.SCREEN_H / 8);   // 21

  /* ---- the sixteen colours ---------------------------------------------- */
  // 0-7 normal (0xD7 components), 8-15 BRIGHT (0xFF components)
  ZX.PALETTE = [
    0x000000, 0x000095, 0x880000, 0xD60073,
    0x00A800, 0x00AFEF, 0x888800, 0xCCCCCC,
    0x333333, 0x0000FF, 0xFF0000, 0xFF00FF,
    0x00FF00, 0x00FFFF, 0xFFFF00, 0xFFFFFF
  ];
  ZX.COLOUR_NAMES = ['BLACK', 'BLUE', 'RED', 'MAGENTA', 'GREEN', 'CYAN', 'YELLOW', 'WHITE'];

  // pre-split float components for vertex colours
  ZX.PAL_F = ZX.PALETTE.map(function (c) {
    return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  });

  /* ---- voxel encoding ---------------------------------------------------
     0            = empty
     1  + colour  = solid   (1..16)
     17 + colour  = glass   (17..32)
     33 + colour  = glowing (33..48)                                       */
  ZX.MAT_SOLID = 0; ZX.MAT_GLASS = 1; ZX.MAT_GLOW = 2;
  ZX.vox = function (colour, mat) { return 1 + (colour & 15) + 16 * (mat || 0); };
  ZX.voxColour = function (v) { return v ? (v - 1) & 15 : 0; };
  ZX.voxMat = function (v) { return v ? (v - 1) >> 4 : -1; };

  /* ---- 8x8 character set, codes 32..127 --------------------------------- */
  var FONTHEX =
    '0000000000000000' + '0010101010001000' + '0024240000000000' + '00247E24247E2400' +
    '00083E283E0A3E08' + '0062640810264600' + '001028102A443A00' + '0008100000000000' +
    '0004080808080400' + '0020101010102000' + '000014083E081400' + '000008083E080800' +
    '0000000000080810' + '000000003E000000' + '0000000000181800' + '0000020408102000' +
    '003C464A52623C00' + '0018280808083E00' + '003C42023C407E00' + '003C420C02423C00' +
    '00081828487E0800' + '007E407C02423C00' + '003C407C42423C00' + '007E020408101000' +
    '003C423C42423C00' + '003C42423E023C00' + '0000001000001000' + '0000100000101020' +
    '0000040810080400' + '0000003E003E0000' + '0000100804081000' + '003C420408000800' +
    '003C4A565E403C00' + '003C42427E424200' + '007C427C42427C00' + '003C424040423C00' +
    '0078444242447800' + '007E407C40407E00' + '007E407C40404000' + '003C42404E423C00' +
    '0042427E42424200' + '003E080808083E00' + '0002020242423C00' + '0044487048444200' +
    '0040404040407E00' + '0042665A42424200' + '004262524A464200' + '003C424242423C00' +
    '007C42427C404000' + '003C4242524A3C00' + '007C42427C444200' + '003C403C02423C00' +
    '00FE101010101000' + '0042424242423C00' + '0042424242241800' + '004242425A664200' +
    '0042241818244200' + '0082442810101000' + '007E040810207E00' + '000E080808080E00' +
    '0000402010080400' + '0070101010107000' + '0010385410101000' + '00000000000000FF' +
    '001C227820207E00' + '000038043C443C00' + '0020203C22223C00' + '00001C2020201C00' +
    '0004043C44443C00' + '0000384478403C00' + '000C101810101000' + '00003C44443C0438' +
    '0040407844444400' + '0010003010103800' + '0004000404042418' + '0020283030282400' +
    '0010101010100C00' + '0000685454545400' + '0000784444444400' + '0000384444443800' +
    '0000784444784040' + '00003C44443C0406' + '00001C2020202000' + '0000384038047800' +
    '0010381010100C00' + '0000444444443800' + '0000444428281000' + '0000445454542800' +
    '0000442810284400' + '00004444443C0438' + '00007C0810207C00' + '000E083008080E00' +
    '0008080808080800' + '0070100C10107000' + '0014280000000000' + '3C4299A1A199423C';

  ZX.FONT = (function () {
    var f = new Uint8Array(96 * 8);
    for (var i = 0; i < 96 * 8; i++) f[i] = parseInt(FONTHEX.substr(i * 2, 2), 16);
    return f;
  })();

  /** Eight bytes for one character code; unknown codes fall back to '?'. */
  ZX.glyph = function (code) {
    if (code < 32 || code > 127) code = 63;
    return ZX.FONT.subarray((code - 32) * 8, (code - 32) * 8 + 8);
  };

  /* ---- BASIC keywords ----------------------------------------------------
     Order matters only for the longest-match scanner in the tokeniser.      */
  ZX.KEYWORDS = [
    // two-word forms first
    'GO TO', 'GO SUB', 'DEF FN', 'OPEN #', 'CLOSE #', 'DRAW TO',
    // statements
    'RANDOMIZE', 'CONTINUE', 'RESTORE', 'INVERSE', 'BRIGHT', 'BORDER', 'CIRCLE',
    'SPHERE', 'SPRITE', 'SDATA', 'UNPUT', 'SCREEN$', 'SCREEN', 'FORMAT', 'RETURN',
    'VERIFY', 'LPRINT', 'LLIST', 'INKEY$', 'DEPTH', 'ERASE', 'CLEAR', 'INPUT',
    'PRINT', 'PAUSE', 'PAPER', 'PLOT', 'POKE', 'PEEK', 'POINT', 'MERGE', 'FLASH',
    'THEN', 'STEP', 'STOP', 'SAVE', 'LOAD', 'LIST', 'LINE', 'LET', 'DRAW', 'DIM',
    'DATA', 'READ', 'COPY', 'CONT', 'CUBE', 'CAT', 'BEEP', 'BIN', 'ATTR', 'OVER',
    'NEXT', 'NEW', 'MOVE', 'MAT', 'REM', 'RUN', 'CLS', 'FOR', 'GOTO', 'GOSUB',
    'FILL', 'TEXT', 'PUT', 'BOX', 'SUN', 'VIEW', 'INK', 'IF', 'TO', 'AT', 'FN',
    'USR', 'OUT', 'IN', 'MEM', 'FREE',
    // functions
    'ASN', 'ACS', 'ATN', 'SIN', 'COS', 'TAN', 'INT', 'ABS', 'SGN', 'SQR', 'LN',
    'EXP', 'RND', 'PI', 'LEN', 'STR$', 'CHR$', 'CODE', 'VAL$', 'VAL', 'TAB',
    // operators spelled with letters
    'AND', 'OR', 'NOT'
  ];

  /* ---- the +2 keyboard ---------------------------------------------------
     w    : width in key units (one unit = 1/8 m)
     kw   : K-mode keyword produced by a single press
     sym  : SYMBOL SHIFT result
     ext  : EXTEND mode (green, above the key)
     esym : EXTEND + SYMBOL SHIFT (red, below the key)
     x3d  : EXTEND pressed twice -- this machine's solid-display words       */
  function K(id, cap, o) {
    o = o || {};
    return {
      id: id, cap: cap, w: o.w || 1, kw: o.kw || '', sym: o.sym || '',
      ext: o.ext || '', esym: o.esym || '', x3d: o.x3d || '',
      type: o.type || 'normal', tall: !!o.tall,
      ch: o.ch !== undefined ? o.ch : cap
    };
  }

  ZX.KEYROWS = [
    [ // function row, as on the +2
      K('EXTMODE', 'EXTEND', { w: 1.5, type: 'extmode' }),
      K('EDIT', 'EDIT', { type: 'edit' }),
      K('CAPSLOCK', 'CAPS LOCK', { type: 'capslock' }),
      K('TRUEVID', 'TRUE VID', { type: 'truevid' }),
      K('INVVID', 'INV VID', { type: 'invvid' }),
      K('BREAK', 'BREAK', { type: 'break' }),
      K('LEFT', '←', { type: 'arrow' }),
      K('DOWN', '↓', { type: 'arrow' }),
      K('UP', '↑', { type: 'arrow' }),
      K('RIGHT', '→', { type: 'arrow' }),
      K('DELETE', 'DELETE', { w: 1.5, type: 'delete' })
    ],
    [
      K('1', '1', { sym: '!', ext: 'DEF FN', esym: 'BLUE' }),
      K('2', '2', { sym: '@', ext: 'FN', esym: 'RED' }),
      K('3', '3', { sym: '#', ext: 'LINE', esym: 'MAGENTA' }),
      K('4', '4', { sym: '$', ext: 'OPEN #', esym: 'GREEN' }),
      K('5', '5', { sym: '%', ext: 'CLOSE #', esym: 'CYAN' }),
      K('6', '6', { sym: '&', ext: 'MOVE', esym: 'YELLOW' }),
      K('7', '7', { sym: "'", ext: 'ERASE', esym: 'WHITE' }),
      K('8', '8', { sym: '(', ext: 'POINT', esym: '' }),
      K('9', '9', { sym: ')', ext: 'CAT', esym: '' }),
      K('0', '0', { sym: '_', ext: 'FORMAT', esym: 'BLACK' }),
      K('GRAPH', 'GRAPH', { w: 2, type: 'graph' })
    ],
    [
      K('Q', 'Q', { kw: 'PLOT', sym: '<=', ext: 'SIN', esym: 'ASN', x3d: 'SPHERE' }),
      K('W', 'W', { kw: 'DRAW', sym: '<>', ext: 'COS', esym: 'ACS', x3d: 'CUBE' }),
      K('E', 'E', { kw: 'REM', sym: '>=', ext: 'TAN', esym: 'ATN', x3d: 'TEXT' }),
      K('R', 'R', { kw: 'RUN', sym: '<', ext: 'INT', esym: 'VERIFY', x3d: 'DEPTH' }),
      K('T', 'T', { kw: 'RANDOMIZE', sym: '>', ext: 'RND', esym: 'MERGE', x3d: 'MAT' }),
      K('Y', 'Y', { kw: 'RETURN', sym: 'AND', ext: 'STR$', esym: '[', x3d: 'SPRITE' }),
      K('U', 'U', { kw: 'IF', sym: 'OR', ext: 'CHR$', esym: ']', x3d: 'SDATA' }),
      K('I', 'I', { kw: 'INPUT', sym: 'AT', ext: 'CODE', esym: 'IN', x3d: 'PUT' }),
      K('O', 'O', { kw: 'POKE', sym: ';', ext: 'PEEK', esym: 'OUT', x3d: 'UNPUT' }),
      K('P', 'P', { kw: 'PRINT', sym: '"', ext: 'TAB', esym: '©', x3d: 'MOVE' }),
      K('ENTER', 'ENTER', { w: 2, type: 'enter', tall: true })
    ],
    [
      K('A', 'A', { kw: 'NEW', sym: 'STOP', ext: 'READ', esym: '~', x3d: 'BOX' }),
      K('S', 'S', { kw: 'SAVE', sym: 'NOT', ext: 'RESTORE', esym: '|', x3d: 'SUN' }),
      K('D', 'D', { kw: 'DIM', sym: 'STEP', ext: 'DATA', esym: '\\', x3d: 'VIEW' }),
      K('F', 'F', { kw: 'FOR', sym: 'TO', ext: 'SGN', esym: '{', x3d: 'FILL' }),
      K('G', 'G', { kw: 'GO TO', sym: 'THEN', ext: 'ABS', esym: '}', x3d: 'SCREEN' }),
      K('H', 'H', { kw: 'GO SUB', sym: '^', ext: 'SQR', esym: 'CIRCLE', x3d: '' }),
      K('J', 'J', { kw: 'LOAD', sym: '-', ext: 'VAL', esym: 'VAL$', x3d: '' }),
      K('K', 'K', { kw: 'LIST', sym: '+', ext: 'LEN', esym: 'SCREEN$', x3d: '' }),
      K('L', 'L', { kw: 'LET', sym: '=', ext: 'USR', esym: 'ATTR', x3d: '' }),
      K('PAD1', '', { type: 'blank' })
    ],
    [
      K('CAPSSHIFT', 'CAPS SHIFT', { w: 1.5, type: 'capsshift' }),
      K('Z', 'Z', { kw: 'COPY', sym: ':', ext: 'LN', esym: 'BEEP', x3d: '' }),
      K('X', 'X', { kw: 'CLEAR', sym: '£', ext: 'EXP', esym: 'INK', x3d: '' }),
      K('C', 'C', { kw: 'CONTINUE', sym: '?', ext: 'LPRINT', esym: 'PAPER', x3d: '' }),
      K('V', 'V', { kw: 'CLS', sym: '/', ext: 'LLIST', esym: 'FLASH', x3d: '' }),
      K('B', 'B', { kw: 'BORDER', sym: '*', ext: 'BIN', esym: 'BRIGHT', x3d: '' }),
      K('N', 'N', { kw: 'NEXT', sym: ',', ext: 'INKEY$', esym: 'OVER', x3d: '' }),
      K('M', 'M', { kw: 'PAUSE', sym: '.', ext: 'PI', esym: 'INVERSE', x3d: '' }),
      K('SYMSHIFT', 'SYMBOL SHIFT', { w: 1.5, type: 'symshift' }),
      K('SPACE', 'SPACE', { w: 2, type: 'space', ch: ' ' })
    ]
  ];

  /** Flat list with laid-out positions, in key units from the top-left. */
  ZX.KEYS = (function () {
    var out = [], y, r, x, i, k;
    for (y = 0; y < ZX.KEYROWS.length; y++) {
      r = ZX.KEYROWS[y]; x = 0;
      for (i = 0; i < r.length; i++) {
        k = r[i];
        k.ux = x; k.uy = y; k.uw = k.w; k.uh = k.tall ? 2 : 1;
        x += k.w;
        if (k.type !== 'blank') out.push(k);
      }
    }
    return out;
  })();
  ZX.KEY_UNITS_W = 12;                    // widest row, in key units
  ZX.KEY_UNITS_H = ZX.KEYROWS.length;     // 5 rows

  ZX.KEYBYID = (function () {
    var m = {};
    ZX.KEYS.forEach(function (k) { m[k.id] = k; });
    return m;
  })();

  /* ---- PC keyboard -> Spectrum key -------------------------------------- */
  ZX.PCMAP = {
    Digit1: '1', Digit2: '2', Digit3: '3', Digit4: '4', Digit5: '5',
    Digit6: '6', Digit7: '7', Digit8: '8', Digit9: '9', Digit0: '0',
    KeyQ: 'Q', KeyW: 'W', KeyE: 'E', KeyR: 'R', KeyT: 'T', KeyY: 'Y',
    KeyU: 'U', KeyI: 'I', KeyO: 'O', KeyP: 'P',
    KeyA: 'A', KeyS: 'S', KeyD: 'D', KeyF: 'F', KeyG: 'G', KeyH: 'H',
    KeyJ: 'J', KeyK: 'K', KeyL: 'L',
    KeyZ: 'Z', KeyX: 'X', KeyC: 'C', KeyV: 'V', KeyB: 'B', KeyN: 'N', KeyM: 'M',
    Enter: 'ENTER', NumpadEnter: 'ENTER', Space: 'SPACE',
    Backspace: 'DELETE', Delete: 'DELETE',
    ArrowLeft: 'LEFT', ArrowRight: 'RIGHT', ArrowUp: 'UP', ArrowDown: 'DOWN',
    ShiftLeft: 'CAPSSHIFT', ShiftRight: 'CAPSSHIFT',
    ControlLeft: 'SYMSHIFT', ControlRight: 'SYMSHIFT',
    AltLeft: 'SYMSHIFT', AltRight: 'EXTMODE',
    CapsLock: 'CAPSLOCK', Tab: 'EXTMODE', F1: 'EDIT'
  };

  /* ---- editing modes ----------------------------------------------------- */
  ZX.MODE_K = 'K'; ZX.MODE_L = 'L'; ZX.MODE_C = 'C';
  ZX.MODE_E = 'E'; ZX.MODE_G = 'G'; ZX.MODE_X = 'X';   // X = second EXTEND, 3D words

  ZX.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

  /* ---- the programs that come on the tape --------------------------------
     Kept here rather than inline so the test suite can run every one of them
     and catch a built-in example that does not parse.                       */
  ZX.BUILTIN_PROGRAMS = {
    LINE: [
      '10 REM your first line in 3D',
      '20 SCREEN 4',
      '30 CLS',
      '40 INK 6',
      '50 PLOT 20,20,200',
      '60 DRAW 200,120,-150'
    ].join('\n'),

    SPRITE: [
      '10 REM a two-frame voxel sprite',
      '20 SPRITE 1,3,3,1,2',
      '30 SDATA 1,0,0,".6."',
      '40 SDATA 1,0,1,"666"',
      '50 SDATA 1,0,2,".6."',
      '60 SDATA 1,1,0,"6.6"',
      '70 SDATA 1,1,1,".6."',
      '80 SDATA 1,1,2,"6.6"',
      '90 SCREEN 4: CLS',
      '100 LET f=0',
      '110 FOR x=0 TO 240',
      '120 LET f=1-f',
      '130 MOVE 1,x,80,128,f',
      '140 PAUSE 2',
      '150 NEXT x',
      '160 UNPUT 1'
    ].join('\n'),

    DEMO: [
      '10 REM --- 3D SPRITE DEMO ---',
      '20 SCREEN 4: CLS',
      '30 INK 6: TEXT 40,150,120,"HELLO",2',
      '40 SPRITE 1,5,5,2,2',
      '50 SDATA 1,0,0,"..2.."',
      '60 SDATA 1,0,1,".222."',
      '70 SDATA 1,0,2,"22222"',
      '80 SDATA 1,0,3,".222."',
      '90 SDATA 1,0,4,"..2.."',
      '100 SDATA 1,1,0,"..E.."',
      '110 SDATA 1,1,1,".EEE."',
      '120 SDATA 1,1,2,"EEEEE"',
      '130 SDATA 1,1,3,".EEE."',
      '140 SDATA 1,1,4,"..E.."',
      '150 INK 4',
      '160 FOR t=0 TO 240',
      '170 LET x=20+t',
      '180 LET y=60+40*SIN (t/18)',
      '190 LET z=60+60*COS (t/23)',
      '195 LET f=INT (t/6)-2*INT (t/12)',
      '200 MOVE 1,x,y,z,f',
      '210 PAUSE 1',
      '220 NEXT t',
      '230 UNPUT 1',
      '240 SCREEN 0: PRINT "DONE"'
    ].join('\n'),

    CUBE: [
      '10 REM 3D wireframe - NX Dev',
      '20 DIM x(8): DIM y(8): DIM z(8): DIM p(8): DIM q(8)',
      '30 FOR i=1 TO 8: READ x(i),y(i),z(i): NEXT i',
      '40 DATA -1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1',
      '50 DATA -1,-1,1,1,-1,1,1,1,1,-1,1,1',
      '60 DIM e(12): DIM f(12)',
      '70 FOR i=1 TO 12: READ e(i),f(i): NEXT i',
      '80 DATA 1,2,2,3,3,4,4,1,5,6,6,7,7,8,8,5,1,5,2,6,3,7,4,8',
      '90 BORDER 0: PAPER 0: INK 5: CLS',
      '100 FOR a=0 TO 999 STEP .06',
      '110 LET s=SIN a: LET c=COS a',
      '120 LET s2=SIN (a*.6): LET c2=COS (a*.6)',
      '130 FOR i=1 TO 8',
      '140 LET u=x(i)*c-z(i)*s',
      '150 LET w=x(i)*s+z(i)*c',
      '160 LET v=y(i)*c2-w*s2',
      '170 LET d=y(i)*s2+w*c2+4.2',
      '180 LET p(i)=128+u*105/d',
      '190 LET q(i)=88+v*105/d',
      '200 NEXT i',
      '210 CLS',
      '220 FOR i=1 TO 12',
      '230 PLOT p(e(i)),q(e(i))',
      '240 DRAW p(f(i))-p(e(i)),q(f(i))-q(e(i))',
      '250 NEXT i',
      '260 PAUSE 1: NEXT a'
    ].join('\n'),

    STARS: [
      '10 REM Starfield - NX Dev',
      '20 BORDER 0: PAPER 0: INK 7: CLS',
      '30 DIM a(40): DIM b(40): DIM d(40)',
      '40 FOR i=1 TO 40',
      '50 LET a(i)=RND*2-1: LET b(i)=RND*2-1: LET d(i)=RND*3+.2',
      '60 NEXT i',
      '70 FOR t=1 TO 9999',
      '80 CLS',
      '90 FOR i=1 TO 40',
      '100 LET d(i)=d(i)-.07',
      '110 IF d(i)<.2 THEN LET a(i)=RND*2-1: LET b(i)=RND*2-1: LET d(i)=3.2',
      '120 LET u=128+a(i)*130/d(i): LET v=88+b(i)*92/d(i)',
      '130 IF u>0 AND u<255 AND v>0 AND v<175 THEN PLOT u,v',
      '140 NEXT i',
      '150 PAUSE 1: NEXT t'
    ].join('\n'),

    NOCLASH: [
      '10 REM No attribute clash - NX Dev',
      '20 BORDER 0: PAPER 0: CLS',
      '30 FOR i=1 TO 15',
      '40 INK i: CIRCLE 128+44*SIN (i/2.4),92+44*COS (i/2.4),30',
      '50 NEXT i',
      '60 FOR y=0 TO 20 STEP 4',
      '70 INK 8+y/4: PLOT 20,y+2: DRAW 215,0',
      '80 NEXT y',
      '90 INK 15: PRINT AT 21,2;"16 colours a pixel, no clash"'
    ].join('\n'),

    COLOURS: [
      '10 REM Colours',
      '20 BORDER 1: CLS',
      '30 FOR p=0 TO 7',
      '40 FOR i=0 TO 7',
      '50 PAPER p: INK i: BRIGHT 0',
      '60 PRINT AT p*2,i*4;" ";i;" "',
      '70 PAPER p: INK i: BRIGHT 1',
      '80 PRINT AT p*2+1,i*4;" ";i;" "',
      '90 NEXT i',
      '100 NEXT p',
      '110 PAPER 7: INK 0: BRIGHT 0',
      '120 PRINT AT 20,0;"PAPER down, INK across"'
    ].join('\n')
  };

})(window.ZX = window.ZX || {});
