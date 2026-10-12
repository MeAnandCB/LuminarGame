import type { SeedChallenge } from './types.js';

// Level 2 - Tech Bingo: 16 tiles on every team's 4x4 card (shuffled per team). The host "calls" one clue at a time;
// a team taps the tile it thinks matches. Complete a row, column or diagonal for a bonus; mark every tile for a blackout.
export const BINGO_TILES: { id: string; text: string; icon: string }[] = [
  { id: 'a', text: 'Python', icon: '🐍' },
  { id: 'b', text: 'Wi-Fi', icon: '📶' },
  { id: 'c', text: 'Cloud', icon: '☁️' },
  { id: 'd', text: 'Firewall', icon: '🧱' },
  { id: 'e', text: 'Pixel', icon: '🟦' },
  { id: 'f', text: 'Bug', icon: '🐛' },
  { id: 'g', text: 'Robot', icon: '🤖' },
  { id: 'h', text: 'Blockchain', icon: '⛓️' },
  { id: 'i', text: 'Cookie', icon: '🍪' },
  { id: 'j', text: 'Mouse', icon: '🖱️' },
  { id: 'k', text: 'Keyboard', icon: '⌨️' },
  { id: 'l', text: 'Server', icon: '🗄️' },
  { id: 'm', text: 'Password', icon: '🔑' },
  { id: 'n', text: 'Emoji', icon: '😀' },
  { id: 'o', text: 'Hashtag', icon: '#️⃣' },
  { id: 'p', text: 'Satellite', icon: '🛰️' },
];

const call = (n: number, answer: string, prompt: string): SeedChallenge => ({
  kind: 'choice',
  title: `Call ${n}`,
  prompt,
  options: BINGO_TILES,
  answers: [answer],
  points: 50,
});

// Order is the order the clues are called. It is shuffled so neighbouring calls are unrelated.
export const bingoCalls: SeedChallenge[] = [
  call(1, 'f', 'The first one on record was a real moth, found stuck inside a Harvard computer in 1947.'),
  call(2, 'a', 'This language is named after a British comedy troupe, even though its logo is a pair of snakes.'),
  call(3, 'o', 'The # symbol that social media turned into a way to group posts by topic.'),
  call(4, 'l', 'A powerful computer whose whole job is to "serve" websites and files to other computers.'),
  call(5, 'n', 'From the Japanese for "picture" + "character": tiny faces you send instead of words.'),
  call(6, 'd', 'A security barrier that decides which network traffic is allowed in or out.'),
  call(7, 'h', 'A tamper-proof list of linked blocks of records, the idea behind Bitcoin.'),
  call(8, 'c', 'Someone else\'s computers that you rent over the internet instead of buying your own.'),
  call(9, 'j', 'Invented by Douglas Engelbart; its trailing wire gave it the name of a small rodent.'),
  call(10, 'p', 'GPS only works because a constellation of these is orbiting the Earth.'),
  call(11, 'i', 'A small file a website stores in your browser so it remembers you next time.'),
  call(12, 'g', 'Coined in a 1920 Czech play, its name comes from a word meaning "forced labour".'),
  call(13, 'e', 'The smallest single dot of colour that a screen can display.'),
  call(14, 'b', 'Invisible radio waves that bring the internet to your phone without a cable.'),
  call(15, 'm', 'A secret string of characters that should be long, unique and never shared.'),
  call(16, 'k', 'QWERTY is the best-known layout of this input device.'),
];
