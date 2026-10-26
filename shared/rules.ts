import type { RoundKind } from './types.js';

/**
 * The rules teams read when a game is about to start (the ROUND_READY screen of the phones and the projector), in English and Malayalam.
 *
 * Malayalam keeps the on-screen game terms in English (Level, Streak, Double Down, Skip, Steal, Lock in, reveal ...), as the printed
 * rules sheet does. No point values are written here: the host can change them before a round starts, so a number in this text could
 * go stale. The one fixed number is the 3 lives of the Final Showdown, which the phone UI also assumes.
 */
export interface GameRules {
  en: string[];
  ml: string[];
}

export const RULES: Record<RoundKind, GameRules> = {
  faces: {
    en: [
      'A tech personality appears on the big screen and on your phone. Pick the right name from the options.',
      'Tap a name, then press Lock in. You get one answer per question and it is final.',
      'Nothing is scored until the host reveals the answer. Answers after the clock runs out score nothing.',
      'A correct answer earns points. The faster you answer, the bigger your speed bonus.',
      'The first team with a correct answer gets the Fastest finger bonus.',
      'Correct answers in a row build a Streak bonus. A wrong or missing answer resets it.',
    ],
    ml: [
      'വലിയ സ്ക്രീനിലും നിങ്ങളുടെ ഫോണിലും ടെക് ലോകത്തെ ഒരു പ്രമുഖ വ്യക്തിയുടെ ചിത്രം വരും. ഓപ്ഷനുകളിൽ നിന്ന് ശരിയായ പേര് തിരഞ്ഞെടുക്കുക.',
      'ഒരു പേരിൽ ടാപ്പ് ചെയ്ത് Lock in അമർത്തുക. ഓരോ ചോദ്യത്തിനും ഒരു ഉത്തരം മാത്രം; അത് അന്തിമമാണ്.',
      'ഹോസ്റ്റ് ഉത്തരം വെളിപ്പെടുത്തുംവരെ (reveal) ഒന്നും സ്കോർ ചെയ്യില്ല. സമയം കഴിഞ്ഞ് നൽകുന്ന ഉത്തരങ്ങൾക്ക് പോയിന്റ് ഇല്ല.',
      'ശരിയുത്തരത്തിന് പോയിന്റ് കിട്ടും. എത്ര വേഗത്തിൽ ഉത്തരം നൽകുന്നുവോ അത്ര കൂടുതൽ സ്പീഡ് ബോണസ് കിട്ടും.',
      'ആദ്യം ശരിയുത്തരം നൽകുന്ന ടീമിന് Fastest finger ബോണസ് കിട്ടും.',
      'തുടർച്ചയായ ശരിയുത്തരങ്ങൾക്ക് Streak ബോണസ് കിട്ടും. തെറ്റോ ഉത്തരമില്ലായ്മയോ വന്നാൽ അത് 0 ആകും.',
    ],
  },
  bingo: {
    en: [
      'Every team has its own 4x4 card with the same 16 tech tiles in a different order.',
      'A clue is called. Tap the tile it describes, then press Lock in before time runs out.',
      'Your tile is marked on your card when the host reveals the answer. Each correct tile earns points plus a speed bonus.',
      'Once a tile has been called it is used up, so the choices shrink as the game goes on.',
      'Complete a row, a column or a diagonal for a line bonus. Mark the whole card for a blackout bonus.',
    ],
    ml: [
      'ഓരോ ടീമിനും സ്വന്തം 4x4 കാർഡ് ഉണ്ടാകും. 16 ടെക് ടൈലുകൾ എല്ലാവർക്കും ഒന്നുതന്നെയാണ്, ക്രമം മാത്രം വ്യത്യസ്തം.',
      'ഒരു സൂചന (clue) വിളിക്കും. അത് സൂചിപ്പിക്കുന്ന ടൈലിൽ ടാപ്പ് ചെയ്ത്, സമയം തീരുംമുമ്പ് Lock in അമർത്തുക.',
      'ഹോസ്റ്റ് ഉത്തരം വെളിപ്പെടുത്തുമ്പോൾ നിങ്ങളുടെ ടൈൽ കാർഡിൽ മാർക്ക് ചെയ്യും. ശരിയായ ഓരോ ടൈലിനും പോയിന്റും സ്പീഡ് ബോണസും കിട്ടും.',
      'ഒരു ടൈൽ വിളിച്ചുകഴിഞ്ഞാൽ അത് ഉപയോഗിച്ചുതീർന്നു. കളി മുന്നേറുംതോറും തിരഞ്ഞെടുപ്പുകൾ കുറയും.',
      'ഒരു വരിയോ നിരയോ കോണോടുകോണോ പൂർത്തിയാക്കിയാൽ line ബോണസ്. കാർഡ് മുഴുവൻ മാർക്ക് ചെയ്താൽ blackout ബോണസ്.',
    ],
  },
  quiz: {
    en: [
      'Tech trivia at your own pace. One clock runs for the whole round, not one per question.',
      'You get one answer per question. It is final and you cannot go back.',
      'A correct answer earns points. Answering sooner earns a speed bonus.',
      'Not sure? Skip the question. Skipping costs nothing.',
      'Questions still unanswered when the clock runs out score nothing.',
    ],
    ml: [
      'സ്വന്തം വേഗത്തിൽ ചെയ്യാവുന്ന ടെക് ക്വിസ്. ഓരോ ചോദ്യത്തിനും വെവ്വേറെ അല്ല, റൗണ്ട് മുഴുവനും ഒറ്റ ക്ലോക്കാണ്.',
      'ഓരോ ചോദ്യത്തിനും ഒരു ഉത്തരം മാത്രം. അത് അന്തിമമാണ്, പിന്നോട്ട് പോകാൻ കഴിയില്ല.',
      'ശരിയുത്തരത്തിന് പോയിന്റ് കിട്ടും. വേഗത്തിൽ ഉത്തരം നൽകിയാൽ സ്പീഡ് ബോണസും കിട്ടും.',
      'ഉറപ്പില്ലേ? ചോദ്യം Skip ചെയ്യാം. Skip ചെയ്യുന്നതിന് പിഴയില്ല.',
      'ക്ലോക്ക് തീരുമ്പോൾ ഉത്തരം നൽകാത്ത ചോദ്യങ്ങൾക്ക് പോയിന്റ് ഇല്ല.',
    ],
  },
  lightning: {
    en: [
      'Every team sees the same question at the same time. Pick an answer and press Lock in. It is final.',
      'Nothing is scored until the reveal. The question closes early once every team has answered, and late answers score nothing.',
      'Speed matters: faster correct answers earn a bigger speed bonus, and the first correct team gets the Fastest finger bonus.',
      'Correct answers in a row build a Streak bonus. A wrong or missing answer resets it.',
      "Double Down, once per team: tick it before you lock in. Right doubles the question's points. Wrong loses its base points.",
    ],
    ml: [
      'എല്ലാ ടീമുകളും ഒരേ സമയം ഒരേ ചോദ്യം കാണും. ഉത്തരം തിരഞ്ഞെടുത്ത് Lock in അമർത്തുക; അത് അന്തിമമാണ്.',
      'റിവീൽ (reveal) വരെ ഒന്നും സ്കോർ ചെയ്യില്ല. എല്ലാ ടീമുകളും ഉത്തരം നൽകിയാൽ ചോദ്യം നേരത്തേ അവസാനിക്കും; വൈകിയ ഉത്തരങ്ങൾക്ക് പോയിന്റ് ഇല്ല.',
      'വേഗതയാണ് പ്രധാനം: വേഗത്തിലുള്ള ശരിയുത്തരത്തിന് കൂടുതൽ സ്പീഡ് ബോണസ്; ആദ്യം ശരിയുത്തരം നൽകുന്ന ടീമിന് Fastest finger ബോണസ്.',
      'തുടർച്ചയായ ശരിയുത്തരങ്ങൾക്ക് Streak ബോണസ് കിട്ടും. തെറ്റോ ഉത്തരമില്ലായ്മയോ വന്നാൽ അത് 0 ആകും.',
      'Double Down (ഓരോ ടീമിനും ഒരിക്കൽ മാത്രം): Lock in ചെയ്യുംമുമ്പ് ടിക്ക് ചെയ്യുക. ശരിയായാൽ ആ ചോദ്യത്തിന്റെ പോയിന്റ് ഇരട്ടിയാകും; തെറ്റിയാൽ അടിസ്ഥാന പോയിന്റ് നഷ്ടമാകും.',
    ],
  },
  showdown: {
    en: [
      'Finalists only. Every team sees the same question at the same time. Pick an answer and press Lock in.',
      'Speed bonus and Fastest finger bonus still apply.',
      'Each team starts with 3 lives. A wrong or missing answer costs one life. A correct answer costs nothing.',
      'At 0 lives your team is out. You keep your points but cannot answer any more.',
      'Steal: the fastest correct team takes points from the top-scoring team that did not answer correctly.',
      'The last team standing wins, and every team still alive at the end gets a survivor bonus. If all remaining teams would lose their last life on the same question, nobody is eliminated.',
    ],
    ml: [
      'ഫൈനലിസ്റ്റുകൾ മാത്രം കളിക്കും. എല്ലാ ടീമുകളും ഒരേ സമയം ഒരേ ചോദ്യം കാണും. ഉത്തരം തിരഞ്ഞെടുത്ത് Lock in അമർത്തുക.',
      'സ്പീഡ് ബോണസും Fastest finger ബോണസും ഇവിടെയും ഉണ്ട്.',
      'ഓരോ ടീമിനും 3 ജീവൻ (lives) ഉണ്ടാകും. തെറ്റായ ഉത്തരത്തിനോ ഉത്തരം നൽകാതിരിക്കുന്നതിനോ ഒരു ജീവൻ നഷ്ടമാകും; ശരിയുത്തരത്തിന് നഷ്ടമില്ല.',
      'ജീവൻ 0 ആകുന്ന ടീം പുറത്താകും. പോയിന്റ് നിലനിൽക്കും, പക്ഷേ പിന്നീട് ഉത്തരം നൽകാൻ കഴിയില്ല.',
      'Steal: ശരിയുത്തരം നൽകാത്ത ടീമുകളിൽ ഏറ്റവും കൂടുതൽ പോയിന്റുള്ള ടീമിൽ നിന്ന്, ഏറ്റവും വേഗത്തിൽ ശരിയുത്തരം നൽകിയ ടീം പോയിന്റ് എടുക്കും.',
      'അവസാനം വരെ നിൽക്കുന്ന ടീം ജയിക്കും; അതിജീവിക്കുന്ന ഓരോ ടീമിനും survivor bonus കിട്ടും. ശേഷിക്കുന്ന എല്ലാ ടീമുകൾക്കും ഒരേ ചോദ്യത്തിൽ അവസാന ജീവൻ നഷ്ടമാകുമെങ്കിൽ ആരും പുറത്താകില്ല.',
    ],
  },
};
