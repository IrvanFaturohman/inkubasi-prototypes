import type { BandDef } from './table';

// Colour ids: 0 Red, 1 Blue, 2 Yellow, 3 Green, 4 Purple
export interface LevelDef {
  id: number;
  name: string;
  seed: number;
  /** Colours that appear in offered stacks. */
  tileColours: number[];
  /** Five bands top to bottom; each band is one target group (5 or 4 targets). */
  bands: BandDef[];
  /** Locked cells, in the order beams unlock them. Every level: 14 open + 5 locked. */
  locked: number[];
  heights: [number, number][]; // [height, weight]
  runs: [number, number][]; // [colour runs, weight]
  preset?: { cell: number; stack: number[] }[];
  hint: string;
}

// Radius-2 grid indices, row by row:
//        0  1  2
//      3  4  5  6
//    7  8  9 10 11
//     12 13 14 15
//       16 17 18
const LOCKS = [17, 7, 11, 0, 2];

export const LEVELS: LevelDef[] = [
  {
    id: 1,
    name: 'Warm Up',
    seed: 1101,
    tileColours: [0, 1, 2],
    bands: [
      { colour: 0, hp: 5 },
      { colour: 1, hp: 4 },
      { colour: 2, hp: 6 },
      { colour: 0, hp: 4 },
      { colour: 1, hp: 5 },
    ], // 24 HP
    locked: LOCKS,
    heights: [
      [3, 3],
      [4, 4],
      [5, 2],
    ],
    runs: [
      [1, 5],
      [2, 4],
    ],
    hint: 'Drag a stack onto a free cell. 10 of one colour on top become a ball.',
  },
  {
    id: 2,
    name: 'Dead Colour',
    seed: 2202,
    tileColours: [0, 1, 2, 3],
    bands: [
      { colour: 1, hp: 8 },
      { colour: 3, hp: 6 },
      { colour: 0, hp: 7 },
      { colour: 3, hp: 6 },
      { colour: 1, hp: 7 },
    ], // 34 HP, yellow is never needed
    locked: LOCKS,
    heights: [
      [3, 3],
      [4, 4],
      [5, 3],
    ],
    runs: [
      [1, 2],
      [2, 5],
      [3, 3],
    ],
    hint: 'No yellow targets up there. Yellow balls still fly, they just hit nothing.',
  },
  {
    id: 3,
    name: 'Tight Board',
    seed: 3303,
    tileColours: [0, 1, 2, 3, 4],
    bands: [
      { colour: 4, hp: 8 },
      { colour: 0, hp: 6 },
      { colour: 2, hp: 7 },
      { colour: 0, hp: 6 },
      { colour: 4, hp: 7 },
    ], // 34 HP, blue and green are dead colours
    locked: LOCKS,
    heights: [
      [3, 3],
      [4, 4],
      [5, 3],
    ],
    runs: [
      [1, 3],
      [2, 5],
      [3, 2],
    ],
    preset: [
      { cell: 4, stack: [1, 1, 3] },
      { cell: 14, stack: [3, 3, 1, 1] },
    ],
    hint: 'Space is the currency. Every placement costs a cell.',
  },
];
