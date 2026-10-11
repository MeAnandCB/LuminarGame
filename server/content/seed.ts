import { quizQuestions } from './quiz.js';
import { lightningQuestions } from './lightning.js';
import { showdownQuestions } from './showdown.js';
import type { SeedRound } from './types.js';

export type { SeedChallenge, SeedRound } from './types.js';

export const SEED_ROUNDS: SeedRound[] = [
  {
    level: 1,
    name: 'Level 1 - Quick Brain',
    kind: 'quiz',
    instructions:
      'Kerala film trivia at your own pace. You get ONE answer per question and cannot go back. Faster correct answers earn a speed bonus. Not sure? Skip the question - it costs nothing.',
    challenges: quizQuestions,
  },
  {
    level: 2,
    name: 'Level 2 - Reel Rush',
    kind: 'lightning',
    instructions:
      'Live! Every team sees the same question at the same time. Answer fast: speed, streaks and the first correct answer all earn bonus points. Use your one Double Down wisely - right doubles the points, wrong costs you.',
    challenges: lightningQuestions,
  },
  {
    level: 3,
    name: 'Level 3 - Final Showdown',
    kind: 'showdown',
    instructions:
      'Finalists only. Three lives. A wrong or missing answer costs a life, and the fastest correct team steals points from a team that just slipped. Lose all your lives and you are out. Last team standing wins a survivor bonus.',
    challenges: showdownQuestions,
  },
];
