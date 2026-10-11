import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 1 - Quick Brain: Kerala / Malayalam cinema basics (self-paced, one answer each).
export const quizQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'Drishyam (2013)', prompt: 'Who directed the 2013 Malayalam thriller Drishyam, starring Mohanlal?', options: opts('Priyadarshan', 'Jeethu Joseph', 'Fazil', 'Sathyan Anthikad'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'First talkie', prompt: 'Which was the first Malayalam talkie (sound film)?', options: opts('Neelakuyil', 'Chemmeen', 'Balan', 'Jeevitha Nauka'), answers: ['c'], points: 100 },
  { kind: 'number', title: 'Year of the first talkie', prompt: 'In which year was Balan, the first Malayalam talkie, released?', answers: ['1938'], points: 100 },
  { kind: 'choice', title: 'Father of Malayalam cinema', prompt: 'Who is known as the Father of Malayalam cinema?', options: opts('J. C. Daniel', 'Ramu Kariat', 'P. Bhaskaran', 'Thikkurissy Sukumaran Nair'), answers: ['a'], points: 100 },
  { kind: 'number', title: 'First Malayalam film', prompt: 'In which year was Vigathakumaran, the first Malayalam feature film, released?', answers: ['1928'], points: 100 },
  { kind: 'choice', title: 'The famous remake', prompt: 'Which Malayalam classic (1993, directed by Fazil) was remade in Hindi as Bhool Bhulaiyaa?', options: opts('Chithram', 'Manichitrathazhu', 'Kireedam', 'Godfather'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Manjummel Boys', prompt: 'The 2024 hit Manjummel Boys is based on a real incident in which place?', options: opts('Edakkal Caves', 'Guna Caves', 'Ajanta Caves', 'Borra Caves'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'The 100 crore club', prompt: 'Which film was the first Malayalam film to cross the Rs 100 crore mark at the box office?', options: opts('Drishyam', 'Premam', 'Pulimurugan', 'Bangalore Days'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Jallikattu', prompt: 'Who directed Jallikattu (2019), India\'s official Oscar entry for 2021?', options: opts('Lijo Jose Pellissery', 'Dileesh Pothan', 'Aashiq Abu', 'Amal Neerad'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Premam (2015)', prompt: 'Who directed the Nivin Pauly starrer Premam (2015)?', options: opts('Anjali Menon', 'Alphonse Puthren', 'Anwar Rasheed', 'Martin Prakkat'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Adoor Gopalakrishnan', prompt: 'What was the first feature film directed by Adoor Gopalakrishnan (1972)?', options: opts('Elippathayam', 'Kodiyettam', 'Swayamvaram', 'Mukhamukham'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Lucifer (2019)', prompt: 'Who made his directorial debut with the Mohanlal film Lucifer (2019)?', options: opts('Prithviraj Sukumaran', 'Dulquer Salmaan', 'Basil Joseph', 'Vineeth Sreenivasan'), answers: ['a'], points: 100 },
];
