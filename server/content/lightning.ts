import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 4 - Reel Rush: live, host-paced tech questions (all teams, same question, same clock).
export const lightningQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'Java\'s parent', prompt: 'Which company originally created the Java programming language?', options: opts('Microsoft', 'IBM', 'Sun Microsystems', 'Intel'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Phone chips', prompt: 'Which company designs the Snapdragon chips found in many Android phones?', options: opts('Qualcomm', 'Intel', 'AMD', 'Broadcom'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Code home', prompt: 'Which company bought the code-hosting site GitHub in 2018?', options: opts('Google', 'Amazon', 'Oracle', 'Microsoft'), answers: ['d'], points: 100 },
  { kind: 'choice', title: 'Google\'s AI', prompt: 'Google\'s family of AI models launched in December 2023 is called what?', options: opts('Copilot', 'Gemini', 'Llama', 'Grok'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Talking to databases', prompt: 'Which language is mainly used to query relational databases?', options: opts('HTML', 'CSS', 'SQL', 'PHP'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Console maker', prompt: 'Which company makes the PlayStation?', options: opts('Sony', 'Nintendo', 'Sega', 'Microsoft'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Chip blueprints', prompt: 'Which company designs the architecture used in most smartphone processors?', options: opts('Intel', 'Nvidia', 'Texas Instruments', 'Arm'), answers: ['d'], points: 100 },
  { kind: 'choice', title: 'Electric truck', prompt: 'What is the name of Tesla\'s angular electric pickup truck?', options: opts('Roadster', 'Cybertruck', 'Model Z', 'Semi'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Amazon\'s cloud', prompt: 'What is the name of Amazon\'s cloud computing platform?', options: opts('Azure', 'Alexa Cloud', 'AWS', 'Firebase'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Graphics chips', prompt: 'What does GPU stand for?', options: opts('Graphics Processing Unit', 'General Power Unit', 'Game Program Utility', 'Grid Processing Unit'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'The padlock', prompt: 'What does the "S" in HTTPS stand for?', options: opts('Server', 'Speed', 'Software', 'Secure'), answers: ['d'], points: 100 },
  { kind: 'choice', title: 'Linux mascot', prompt: 'Which animal is the mascot of the Linux operating system?', options: opts('A fox', 'A penguin', 'A panda', 'An owl'), answers: ['b'], points: 100 },
];
