import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 3 - Quick Brain: tech basics (self-paced, one answer each).
export const quizQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'Brain of the computer', prompt: 'What does CPU stand for?', options: opts('Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Power Unit'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Web styling', prompt: 'Which technology controls the colours, fonts and layout of a web page?', options: opts('SQL', 'CSS', 'Bash', 'JSON'), answers: ['b'], points: 100 },
  { kind: 'number', title: 'First iPhone', prompt: 'In which year was the first iPhone released?', answers: ['2007'], points: 100 },
  { kind: 'choice', title: 'Inventor of the Web', prompt: 'Who is credited with inventing the World Wide Web?', options: opts('Vint Cerf', 'Bill Gates', 'Tim Berners-Lee', 'Steve Jobs'), answers: ['c'], points: 100 },
  { kind: 'number', title: 'Bits in a byte', prompt: 'How many bits are there in one byte?', answers: ['8'], points: 100 },
  { kind: 'choice', title: 'The web protocol', prompt: 'What does HTTP stand for?', options: opts('High Transfer Text Process', 'Hyper Terminal Transfer Port', 'Host Text Transmission Protocol', 'HyperText Transfer Protocol'), answers: ['d'], points: 100 },
  { kind: 'choice', title: 'Comedy-named language', prompt: 'Which programming language is named after a British comedy group?', options: opts('Python', 'Ruby', 'Java', 'Swift'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Odd one out', prompt: 'Which of these is NOT a web browser?', options: opts('Firefox', 'Safari', 'Ubuntu', 'Opera'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Chatbot of 2022', prompt: 'Which company launched ChatGPT in November 2022?', options: opts('Google', 'Meta', 'Anthropic', 'OpenAI'), answers: ['d'], points: 100 },
  { kind: 'number', title: 'Binary maths', prompt: 'What is the decimal value of the binary number 1010?', answers: ['10'], points: 100 },
  { kind: 'choice', title: 'Voice assistant', prompt: 'What is the name of Apple\'s voice assistant?', options: opts('Alexa', 'Siri', 'Cortana', 'Bixby'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Social media owner', prompt: 'Which company owns Instagram, WhatsApp and Facebook?', options: opts('Meta', 'Alphabet', 'Microsoft', 'Snap'), answers: ['a'], points: 100 },
];
