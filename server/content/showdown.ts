import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 5 - Final Showdown: harder questions for the finalists. Wrong or missing answers cost a life.
export const showdownQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'Memory-safe systems', prompt: 'The Rust programming language grew out of a project sponsored by which organisation?', options: opts('Mozilla', 'Apache', 'Canonical', 'Red Hat'), answers: ['a'], points: 200 },
  { kind: 'choice', title: 'Version control', prompt: 'Who created the Git version-control system?', options: opts('Guido van Rossum', 'Linus Torvalds', 'James Gosling', 'Bjarne Stroustrup'), answers: ['b'], points: 200 },
  { kind: 'number', title: 'Google\'s birth', prompt: 'In which year was Google founded?', answers: ['1998'], points: 200 },
  { kind: 'choice', title: 'Browser pioneer', prompt: 'Which graphical web browser, released in 1993, helped make the web popular?', options: opts('Netscape Navigator', 'Internet Explorer', 'Mosaic', 'Chrome'), answers: ['c'], points: 200 },
  { kind: 'choice', title: 'Internet plumbing', prompt: 'What does TCP stand for in TCP/IP?', options: opts('Terminal Control Process', 'Total Connection Package', 'Transfer Code Protocol', 'Transmission Control Protocol'), answers: ['d'], points: 200 },
  { kind: 'choice', title: 'First programmer', prompt: 'Who is widely regarded as the first computer programmer, for her notes on Babbage\'s Analytical Engine?', options: opts('Grace Hopper', 'Ada Lovelace', 'Margaret Hamilton', 'Hedy Lamarr'), answers: ['b'], points: 200 },
  { kind: 'choice', title: 'Apple silicon', prompt: 'What was the name of the first Apple-designed chip for Macs, introduced in 2020?', options: opts('M1', 'A14X', 'T2', 'S1'), answers: ['a'], points: 200 },
  { kind: 'choice', title: 'Search ranking', prompt: 'What is the name of the algorithm Google originally used to rank web pages?', options: opts('HubRank', 'LinkSort', 'PageRank', 'WebScore'), answers: ['c'], points: 200 },
  { kind: 'choice', title: 'AI hardware', prompt: 'Which company makes the H100 GPUs that power much of today\'s AI training?', options: opts('AMD', 'Intel', 'Qualcomm', 'Nvidia'), answers: ['d'], points: 200 },
  { kind: 'choice', title: 'Email origins', prompt: 'In which decade was the first network email sent by Ray Tomlinson?', options: opts('1950s', '1960s', '1970s', '1980s'), answers: ['c'], points: 200 },
];
