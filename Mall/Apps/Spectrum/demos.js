/* ============================================================
   Spectrum · demos.js
   Short programs that show the terminal is a real BASIC, not a
   picture of one. They are stored as plain text and tokenised on
   the way in, exactly as if somebody had typed them.
   ============================================================ */
export const DEMOS = {
  cube: {
    title: '3D cube',
    note: 'A wireframe cube, rotated and projected in BASIC',
    text: `10 REM 3D wireframe - NX Dev
20 DIM x(8): DIM y(8): DIM z(8): DIM p(8): DIM q(8)
30 FOR i=1 TO 8: READ x(i),y(i),z(i): NEXT i
40 DATA -1,-1,-1,1,-1,-1,1,1,-1,-1,1,-1
50 DATA -1,-1,1,1,-1,1,1,1,1,-1,1,1
60 DIM e(12): DIM f(12)
70 FOR i=1 TO 12: READ e(i),f(i): NEXT i
80 DATA 1,2,2,3,3,4,4,1,5,6,6,7,7,8,8,5,1,5,2,6,3,7,4,8
90 BORDER 0: PAPER 0: INK 5: CLS
100 FOR a=0 TO 999 STEP .06
110 LET s=SIN a: LET c=COS a
120 LET s2=SIN (a*.6): LET c2=COS (a*.6)
130 FOR i=1 TO 8
140 LET u=x(i)*c-z(i)*s
150 LET w=x(i)*s+z(i)*c
160 LET v=y(i)*c2-w*s2
170 LET d=y(i)*s2+w*c2+4.2
180 LET p(i)=128+u*105/d
190 LET q(i)=88+v*105/d
200 NEXT i
210 CLS
220 FOR i=1 TO 12
230 PLOT p(e(i)),q(e(i))
240 DRAW p(f(i))-p(e(i)),q(f(i))-q(e(i))
250 NEXT i
260 PAUSE 1: NEXT a`
  },
  stars: {
    title: 'Starfield',
    note: 'Forty stars, projected and recycled',
    text: `10 REM Starfield - NX Dev
20 BORDER 0: PAPER 0: INK 7: CLS
30 DIM a(40): DIM b(40): DIM d(40)
40 FOR i=1 TO 40
50 LET a(i)=RND*2-1: LET b(i)=RND*2-1: LET d(i)=RND*3+.2
60 NEXT i
70 FOR t=1 TO 9999
80 CLS
90 FOR i=1 TO 40
100 LET d(i)=d(i)-.07
110 IF d(i)<.2 THEN LET a(i)=RND*2-1: LET b(i)=RND*2-1: LET d(i)=3.2
120 LET u=128+a(i)*130/d(i): LET v=88+b(i)*92/d(i)
130 IF u>0 AND u<255 AND v>0 AND v<175 THEN PLOT u,v
140 NEXT i
150 PAUSE 1: NEXT t`
  },
  noclash: {
    title: 'No clash',
    note: 'Fifteen circles on top of each other, every pixel its own colour',
    text: `10 REM No attribute clash - NX Dev
20 BORDER 0: PAPER 0: CLS
30 FOR i=1 TO 15
40 INK i: CIRCLE 128+44*SIN (i/2.4),92+44*COS (i/2.4),30
50 NEXT i
60 FOR y=0 TO 20 STEP 4
70 INK 8+y/4: PLOT 20,y+2: DRAW 215,0
80 NEXT y
90 INK 15: PRINT AT 21,2;"16 colours a pixel, no clash"`
  },
  colours: {
    title: 'Colour test',
    note: 'The sixteen colours, and flashing',
    text: `10 REM Colours
20 BORDER 1: CLS
30 FOR p=0 TO 7
40 FOR i=0 TO 7
50 PAPER p: INK i: BRIGHT 0
60 PRINT AT p*2,i*4;" ";i;" ";
70 PAPER p: INK i: BRIGHT 1
80 PRINT AT p*2+1,i*4;" ";i;" ";
90 NEXT i
100 NEXT p
110 PAPER 7: INK 0: BRIGHT 0
120 PRINT AT 20,0;"PAPER down, INK across"`
  }
};


