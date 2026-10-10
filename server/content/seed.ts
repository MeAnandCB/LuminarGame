import type { ChallengeKind } from '../../shared/types.js';
import { atbash, caesarShift, toBinary8 } from './ciphers.js';

export interface SeedChallenge {
  kind: ChallengeKind;
  title: string;
  prompt: string;
  options?: { id: string; text: string }[];
  answers: string[];
  points: number;
  hint?: string;
}

export interface SeedRound {
  level: number;
  name: string;
  kind: 'quiz' | 'puzzle';
  instructions: string;
  challenges: SeedChallenge[];
}

const opts = (...texts: string[]) => texts.map((text, i) => ({ id: 'abcd'[i]!, text }));

// ---- Level 1 : Quick Brain (Kerala / Malayalam cinema) ----------------------
const level1: SeedChallenge[] = [
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

// ---- Level 2 : Codebreaker ---------------------------------------------------
export const L2_BINARY_LETTER = 'M';
export const L2_SHIFT_WORD = 'PREMAM';
export const L2_SHIFT_TARGET = 'PULI';
export const L2_CAESAR_SHIFT = 4;
export const L2_CAESAR_PLAIN = 'BALAN';
export const L2_CAESAR_CIPHER = caesarShift(L2_CAESAR_PLAIN, L2_CAESAR_SHIFT);
export const L2_FINAL_PASSWORD = `${L2_CAESAR_PLAIN}-42${L2_BINARY_LETTER}`;

const level2: SeedChallenge[] = [
  {
    kind: 'text',
    title: 'Stage 1 - Reel Code',
    prompt: `The film can marked "${toBinary8(L2_BINARY_LETTER)}" holds an 8-bit ASCII letter - the first letter of Malayalam cinema's nickname, Mollywood.\n\n${toBinary8(L2_BINARY_LETTER)}\n\nWhich character is it?`,
    answers: [L2_BINARY_LETTER],
    points: 200,
    hint: 'ASCII 77 is a capital letter. 01001101 = 64 + 8 + 4 + 1.',
  },
  {
    kind: 'text',
    title: 'Stage 2 - Secret Poster Alphabet',
    prompt: `A poster printer shifts every letter FORWARD by one position in the alphabet.\n\nIf ${L2_SHIFT_WORD} becomes ${caesarShift(L2_SHIFT_WORD, 1)}, what does ${L2_SHIFT_TARGET} become?`,
    answers: [caesarShift(L2_SHIFT_TARGET, 1)],
    points: 200,
    hint: 'Shift each of P, U, L and I one letter forward.',
  },
  {
    kind: 'number',
    title: 'Stage 3 - Box Office Lock',
    prompt: 'A theatre in Kochi counts its housefull shows in a pattern:\n\n2, 6, 12, 20, 30, ?\n\nComplete the sequence.',
    answers: ['42'],
    points: 200,
    hint: 'Look at the differences: 4, 6, 8, 10 ... Or: 1x2, 2x3, 3x4 ...',
  },
  {
    kind: 'text',
    title: 'Stage 4 - Cipher Challenge',
    prompt: `The title of Malayalam cinema's first talkie was hidden with a Caesar cipher: every letter was shifted FORWARD by ${L2_CAESAR_SHIFT} positions (A becomes E, B becomes F ...).\n\nCiphertext: ${L2_CAESAR_CIPHER}\n\nDecrypt it. Enter the plaintext title.`,
    answers: [L2_CAESAR_PLAIN],
    points: 300,
    hint: `To decrypt, shift every letter BACK by ${L2_CAESAR_SHIFT}.`,
  },
  {
    kind: 'text',
    title: 'Stage 5 - Final Vault',
    prompt:
      'The vault password is built from your earlier answers, in this order:\n\n  1. the Stage 4 title\n  2. a hyphen (-)\n  3. the Stage 3 number\n  4. the Stage 1 letter\n\nExample of the format: TITLE-99Z\n\nEnter the vault password.',
    answers: [L2_FINAL_PASSWORD],
    points: 500,
    hint: 'Your solved answers are listed above. Join them exactly as described.',
  },
];

// ---- Level 3 : The Final Hack ------------------------------------------------
export const L3_CIPHER_PLAIN = 'PREMAM';
export const L3_CIPHER_TEXT = atbash(L3_CIPHER_PLAIN);
export const L3_LOGIC_CODE = '231';
export const L3_PATTERN_WORD = 'MOHANLAL';
export const L3_FINAL_PASSWORD = `${L3_PATTERN_WORD}-${L3_LOGIC_CODE}-${L3_CIPHER_PLAIN.slice(0, 3)}`;

export const L3_PATTERN_LINES = [
  'Malayalam cinema began in a silent era',
  'Old projectors still hum in Kerala theatres',
  'Heroes and villains share the same screen',
  'Audiences clap at every punch dialogue',
  'Nobody leaves before the climax',
  'Late-night shows sell out in Kochi',
  'Applause echoes through the balcony',
  'Little theatres keep the magic alive',
];

const level3: SeedChallenge[] = [
  {
    kind: 'text',
    title: 'Stage 1 - Cipher',
    prompt: `INTERCEPTED TRANSMISSION\n\nThe name of a 2015 Malayalam blockbuster was hidden with the Atbash cipher, which mirrors the alphabet: A<->Z, B<->Y, C<->X ... M<->N.\n\nDecode: ${L3_CIPHER_TEXT}`,
    answers: [L3_CIPHER_PLAIN],
    points: 300,
    hint: 'Mirror each letter: K becomes P, I becomes R ...',
  },
  {
    kind: 'number',
    title: 'Stage 2 - Logic Grid',
    prompt:
      'Three film posters - Drishyam, Lucifer and Premam - hang in three different halls numbered 1, 2 and 3 (one poster per hall).\n\n  - Drishyam is not in hall 1.\n  - Lucifer is in a higher-numbered hall than Premam.\n  - Premam is not in hall 2.\n  - Drishyam is in a lower-numbered hall than Lucifer.\n\nThe access code is the three hall numbers in the order Drishyam, Lucifer, Premam.\nEnter the 3-digit code.',
    answers: [L3_LOGIC_CODE],
    points: 300,
    hint: 'Premam must be in hall 1 or 3. Lucifer is above Premam, so Premam cannot be 3.',
  },
  {
    kind: 'text',
    title: 'Stage 3 - Hidden Pattern',
    prompt: `Something is hidden in plain sight. Read the review carefully:\n\n${L3_PATTERN_LINES.join('\n')}\n\nWhat single word is hidden inside?`,
    answers: [L3_PATTERN_WORD],
    points: 300,
    hint: 'Look at where each line begins.',
  },
  {
    kind: 'text',
    title: 'Stage 4 - Final Password Vault',
    prompt:
      'The vault password is assembled from the clues you recovered, in this order:\n\n  1. the Stage 3 word\n  2. a hyphen (-)\n  3. the Stage 2 code\n  4. a hyphen (-)\n  5. the FIRST THREE letters of the Stage 1 title\n\nEnter the vault password.',
    answers: [L3_FINAL_PASSWORD],
    points: 400,
    hint: 'Your solved answers are listed above. Mind the order and the hyphens.',
  },
];

export const SEED_ROUNDS: SeedRound[] = [
  {
    level: 1,
    name: 'Level 1 - Quick Brain',
    kind: 'quiz',
    instructions:
      'Answer each question as fast and accurately as you can. You get ONE answer per question and cannot go back. Faster correct answers can earn a speed bonus.',
    challenges: level1,
  },
  {
    level: 2,
    name: 'Level 2 - Codebreaker: Crack the Secret',
    kind: 'puzzle',
    instructions:
      'Five encrypted challenges. Solve each one to unlock the next. Wrong codes never advance you, so keep trying. Your final vault password is built from your earlier answers.',
    challenges: level2,
  },
  {
    level: 3,
    name: 'Level 3 - The Final Hack',
    kind: 'puzzle',
    instructions:
      'Finalists only. Break the cipher, solve the logic grid, spot the hidden pattern, then open the final password vault. Every stage feeds the next.',
    challenges: level3,
  },
];
