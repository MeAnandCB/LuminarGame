import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 1 - Tech Faces: identify the tech personality in the picture.
// Pictures are NOT bundled (licensing): put your own photos in web/public/faces/ named 01.jpg ... 10.jpg
// (.png / .webp also work), in the order below. The numbered names keep the answer out of the image URL.
// `hint` is the "did you know" shown after the reveal.
export const facesQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'Face 1', image: '/faces/01', prompt: 'Who is this tech icon?', options: opts('Steve Wozniak', 'Steve Jobs', 'Tim Cook', 'Larry Ellison'), answers: ['b'], points: 100, hint: 'Co-founded Apple and unveiled the first iPhone in 2007.' }, // Steve Jobs
  { kind: 'choice', title: 'Face 2', image: '/faces/02', prompt: 'Who is this tech icon?', options: opts('Paul Allen', 'Steve Ballmer', 'Bill Gates', 'Satya Nadella'), answers: ['c'], points: 100, hint: 'Co-founded Microsoft with Paul Allen in 1975.' }, // Bill Gates
  { kind: 'choice', title: 'Face 3', image: '/faces/03', prompt: 'Who is this tech icon?', options: opts('Jeff Bezos', 'Peter Thiel', 'Jack Dorsey', 'Elon Musk'), answers: ['d'], points: 100, hint: 'Leads Tesla and SpaceX, and bought Twitter, now called X.' }, // Elon Musk
  { kind: 'choice', title: 'Face 4', image: '/faces/04', prompt: 'Who is this tech icon?', options: opts('Mark Zuckerberg', 'Evan Spiegel', 'Reid Hoffman', 'Sergey Brin'), answers: ['a'], points: 100, hint: 'Started Facebook in a Harvard dorm room in 2004.' }, // Mark Zuckerberg
  { kind: 'choice', title: 'Face 5', image: '/faces/05', prompt: 'Who is this tech icon?', options: opts('Satya Nadella', 'Sundar Pichai', 'Shantanu Narayen', 'Arvind Krishna'), answers: ['b'], points: 100, hint: 'Born in Madurai, India. CEO of Google and its parent Alphabet.' }, // Sundar Pichai
  { kind: 'choice', title: 'Face 6', image: '/faces/06', prompt: 'Who is this tech icon?', options: opts('Sundar Pichai', 'Parag Agrawal', 'Satya Nadella', 'Jensen Huang'), answers: ['c'], points: 100, hint: 'Born in Hyderabad. Microsoft CEO since 2014 and a big cloud and AI bet-maker.' }, // Satya Nadella
  { kind: 'choice', title: 'Face 7', image: '/faces/07', prompt: 'Who is this tech icon?', options: opts('Jeff Bezos', 'Michael Dell', 'Tim Cook', 'Sam Altman'), answers: ['a'], points: 100, hint: 'Started Amazon as an online bookstore in 1994.' }, // Jeff Bezos
  { kind: 'choice', title: 'Face 8', image: '/faces/08', prompt: 'Who is this tech icon?', options: opts('Sergey Brin', 'Eric Schmidt', 'Larry Page', 'Jack Ma'), answers: ['c'], points: 100, hint: 'Co-founded Google with Sergey Brin; the "Page" in PageRank is his own name.' }, // Larry Page
  { kind: 'choice', title: 'Face 9', image: '/faces/09', prompt: 'Who is this tech icon?', options: opts('Richard Stallman', 'Dennis Ritchie', 'Guido van Rossum', 'Linus Torvalds'), answers: ['d'], points: 100, hint: 'Created the Linux kernel in 1991 and later the Git version-control system.' }, // Linus Torvalds
  { kind: 'choice', title: 'Face 10', image: '/faces/10', prompt: 'Who is this tech icon?', options: opts('Jensen Huang', 'Lisa Su', 'Pat Gelsinger', 'Andy Grove'), answers: ['a'], points: 100, hint: 'Co-founder and CEO of NVIDIA, whose GPUs power modern AI.' }, // Jensen Huang
];
