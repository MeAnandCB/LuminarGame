import { facesQuestions } from './faces.js';
import { bingoCalls } from './bingo.js';
import { quizQuestions } from './quiz.js';
import { lightningQuestions } from './lightning.js';
import { showdownQuestions } from './showdown.js';
import type { SeedRound } from './types.js';

export type { SeedChallenge, SeedRound } from './types.js';

export const SEED_ROUNDS: SeedRound[] = [
  {
    level: 1,
    name: 'Level 1 - Tech Faces',
    kind: 'faces',
    instructions:
      'Live! A tech personality appears on the big screen and on your phone. Pick the right name before the clock runs out. Faster answers earn a speed bonus, the first correct team gets a fastest-finger bonus, and a streak of correct answers adds even more.',
    challenges: facesQuestions,
  },
  {
    level: 2,
    name: 'Level 2 - Tech Bingo',
    kind: 'bingo',
    instructions:
      'Every team gets a 4x4 bingo card with the same 16 tech tiles in a different order. The host reads a clue; tap the tile it describes before time is up. Each correct tile is marked on your card. Complete a row, a column or a diagonal for a bonus, and fill the whole card for a blackout.',
    challenges: bingoCalls,
  },
  {
    level: 3,
    name: 'Level 3 - Quick Brain',
    kind: 'quiz',
    instructions:
      'Tech trivia at your own pace. You get ONE answer per question and cannot go back. Faster correct answers earn a speed bonus. Not sure? Skip the question - it costs nothing.',
    challenges: quizQuestions,
  },
  {
    level: 4,
    name: 'Level 4 - Reel Rush',
    kind: 'lightning',
    instructions:
      'Live! Every team sees the same question at the same time. Answer fast: speed, streaks and the first correct answer all earn bonus points. Use your one Double Down wisely - right doubles the points, wrong costs you.',
    challenges: lightningQuestions,
  },
  {
    level: 5,
    name: 'Level 5 - Final Showdown',
    kind: 'showdown',
    instructions:
      'Finalists only. Three lives. A wrong or missing answer costs a life, and the fastest correct team steals points from a team that just slipped. Lose all your lives and you are out. Last team standing wins a survivor bonus.',
    challenges: showdownQuestions,
  },
];
