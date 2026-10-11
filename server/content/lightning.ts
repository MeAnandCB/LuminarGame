import type { SeedChallenge } from './types.js';
import { opts } from './types.js';

// Level 2 - Reel Rush: live, host-paced questions about Malayalam films (all teams, same question, same clock).
export const lightningQuestions: SeedChallenge[] = [
  { kind: 'choice', title: 'Cable operator', prompt: 'Georgekutty, a cable TV operator who protects his family with a carefully built alibi, is the hero of which film?', options: opts('Drishyam', 'Oru Vadakkan Selfie', 'Bangalore Days', 'Ustad Hotel'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Stephen Nedumpally', prompt: 'Mohanlal plays Stephen Nedumpally in which 2019 political thriller?', options: opts('Pulimurugan', 'Lucifer', 'Odiyan', 'Big Brother'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Who is Malar?', prompt: 'Which actress played Malar, the teacher George falls for, in Premam (2015)?', options: opts('Nazriya Nazim', 'Parvathy Thiruvothu', 'Sai Pallavi', 'Madonna Sebastian'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'The viral song', prompt: 'The song "Jimikki Kammal" comes from which Mohanlal film?', options: opts('Velipadinte Pustakam', 'Munthirivallikal Thalirkkumbol', 'Villain', 'Ittymaani: Made in China'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Fishing village', prompt: 'Kumbalangi Nights (2019) is set in a fishing village near which Kerala city?', options: opts('Kozhikode', 'Thiruvananthapuram', 'Kochi', 'Kannur'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Ganga and Nagavalli', prompt: 'Who won a National Award for playing Ganga / Nagavalli in Manichitrathazhu?', options: opts('Urvashi', 'Shobana', 'Revathi', 'Manju Warrier'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Aadu Thoma', prompt: 'Mohanlal played the rebellious Aadu Thoma in which 1995 film?', options: opts('Kireedam', 'Devasuram', 'Spadikam', 'Thenmavin Kombath'), answers: ['c'], points: 100 },
  { kind: 'choice', title: 'Comedy director', prompt: 'Which director made the Mohanlal comedies Chithram (1988) and Kilukkam (1991)?', options: opts('Priyadarshan', 'Sibi Malayil', 'Siddique-Lal', 'Joshiy'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'The 100 crore director', prompt: 'Who directed Pulimurugan (2016)?', options: opts('Jeethu Joseph', 'Vysakh', 'Shaji Kailas', 'B. Unnikrishnan'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Ranga', prompt: 'Fahadh Faasil plays the flamboyant gangster Ranga in which 2024 film?', options: opts('Aavesham', 'Malik', 'Trance', 'Varathan'), answers: ['a'], points: 100 },
  { kind: 'choice', title: 'Fan nickname', prompt: 'Fans affectionately call Mammootty by which name?', options: opts('Lalettan', 'Mammukka', 'Ikka-Bhai', 'Dulquer Sir'), answers: ['b'], points: 100 },
  { kind: 'choice', title: 'Maheshinte Prathikaram', prompt: 'Maheshinte Prathikaram (2016), the Fahadh Faasil comedy, is set in which district of Kerala?', options: opts('Alappuzha', 'Wayanad', 'Thrissur', 'Idukki'), answers: ['d'], points: 100 },
];
