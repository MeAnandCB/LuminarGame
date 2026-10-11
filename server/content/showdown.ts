import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 3 - Final Showdown: harder questions for the finalists. Wrong or missing answers cost a life.
export const showdownQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'First Golden Lotus', prompt: 'Which Malayalam film won the President\'s Gold Medal (Golden Lotus) for Best Feature Film in 1965?', options: opts('Neelakuyil', 'Chemmeen', 'Swayamvaram', 'Elippathayam'), answers: ['b'], points: 200 },
  { kind: 'choice', title: 'Source novel', prompt: 'Chemmeen (1965) is based on a novel by which writer?', options: opts('Vaikom Muhammad Basheer', 'M. T. Vasudevan Nair', 'Thakazhi Sivasankara Pillai', 'S. K. Pottekkatt'), answers: ['c'], points: 200 },
  { kind: 'choice', title: 'Streaming debut', prompt: 'On which platform did Drishyam 2 (2021) release directly?', options: opts('Netflix', 'Amazon Prime Video', 'Disney+ Hotstar', 'SonyLIV'), answers: ['b'], points: 200 },
  { kind: 'choice', title: 'Flood film', prompt: 'Which 2023 Malayalam film, directed by Jude Anthany Joseph, is based on the 2018 Kerala floods?', options: opts('Kuruthi', '2018: Everyone Is a Hero', 'Minnal Murali', 'Romancham'), answers: ['b'], points: 200 },
  { kind: 'choice', title: 'The Kitchen', prompt: 'Who directed The Great Indian Kitchen (2021)?', options: opts('Jeo Baby', 'Dileesh Pothan', 'Mahesh Narayanan', 'Ranjith Sankar'), answers: ['a'], points: 200 },
  { kind: 'choice', title: 'Black and white', prompt: 'Which 2024 Mammootty horror film was shot entirely in black and white?', options: opts('Turbo', 'Bramayugam', 'Kannur Squad', 'Christopher'), answers: ['b'], points: 200 },
  { kind: 'choice', title: 'The Goat Life', prompt: 'Aadujeevitham (The Goat Life) is based on a novel by which author?', options: opts('Benyamin', 'Paul Zacharia', 'O. V. Vijayan', 'Madhavikutty'), answers: ['a'], points: 200 },
  { kind: 'choice', title: 'Evergreen hero', prompt: 'Which actor is celebrated as the "Nithya Haritha Nayakan" (evergreen hero) of Malayalam cinema?', options: opts('Sathyan', 'Madhu', 'Prem Nazir', 'Jayan'), answers: ['c'], points: 200 },
  { kind: 'choice', title: 'The festival city', prompt: 'The International Film Festival of Kerala (IFFK) is held every year in which city?', options: opts('Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur'), answers: ['a'], points: 200 },
  { kind: 'number', title: 'National Awards', prompt: 'How many times has Mammootty won the National Film Award for Best Actor?', answers: ['3'], points: 200 },
];
