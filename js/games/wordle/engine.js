// Wordle Duel engine: deterministic secret words, guess scoring with
// correct duplicate-letter handling, and the score encoding. Pure.
//
// Round score = guesses * 10000 + seconds (capped), lowest total wins —
// so the match compares total guesses first, total time as the tiebreak.
// A failed round (out of guesses) is charged as 7 guesses.

import { makeRng } from "../wordgrid/engine.js";

export const WORD_LEN = 5;
export const MAX_GUESSES = 6;
export const FAIL_GUESSES = 7; // the price of not solving a round
const TIME_CAP = 9999;

// Secret-word pool baked into code (like wordgrid's dice and the anagrams
// rack pool) so a dictionary edit can never hand the two players different
// words. Common words only — guesses may still use the whole dictionary.
export const POOL = ("about above actor adult after again agent agree ahead alarm album alert alike alive allow alone along " +
  "alter angel anger angle angry apart apple apply arena argue arise armor aroma array arrow aside asset avoid awake " +
  "award aware badge badly baker basic batch beach beard beast begin being belly below bench berry birth black blade " +
  "blame blank blast blaze bleed blend bless blind block bloom blues blunt board boast bonus boost booth bound brain " +
  "brake brand brave bread break brick bride brief bring broad brook broom brown brush build bunch burst cabin cable " +
  "candy cargo carry catch cause chain chair chalk charm chart chase cheap check cheek cheer chess chest chief child " +
  "chill choir chose civic claim clash class clean clear clerk click cliff climb clock close cloth cloud coach coast " +
  "color couch cough count court cover crack craft crane crash crazy cream crime crisp cross crowd crown crush curve " +
  "cycle daily dairy dance dealt death debut decay delay dense depth diary dirty ditch dodge doubt dozen draft drain " +
  "drama drank dream dress dried drift drill drink drive drove dryer eager eagle early earth eight elbow elder empty " +
  "enemy enjoy enter entry equal error essay event every exact exist extra faint fairy faith false fancy fatal fault " +
  "favor feast fence fever fiber field fierce fifth fifty fight final first flame flash fleet flesh float flock flood " +
  "floor flour fluid flush focus force forge forth forty forum found frame fraud fresh front frost fruit fully funny " +
  "ghost giant given glass globe glory glove going grace grade grain grand grant grape grasp grass grave great green " +
  "greet grief grill grind gross group grove grown guard guess guest guide habit happy harsh haste hatch heart heavy " +
  "hedge hello hence hobby honey honor horse hotel house human humor hurry ideal image imply index inner input irony " +
  "issue ivory jeans jelly jewel joint jolly judge juice knife knock known label labor large laser later laugh layer " +
  "learn lease least leave legal lemon level light limit linen liver lobby local logic loose lorry lower loyal lucky " +
  "lunar lunch lyric magic major maker maple march marry match maybe mayor meant medal media mercy merit metal midst " +
  "might minor minus mixed model money month moral motor mount mouse mouth movie music naive nasty naval nerve never " +
  "newly night noble noise north notch novel nurse occur ocean offer often olive onion opera orbit order organ other " +
  "ought ounce outer owner oxide paint panel panic paper party pasta patch pause peace pearl penny phase phone photo " +
  "piano piece pilot pinch pitch pixel place plain plane plant plate plaza point porch pound power press price pride " +
  "prime print prize proof proud prove pulse punch pupil purse queen quick quiet quilt quite quota quote radar radio " +
  "raise rally ranch range rapid ratio reach react ready realm rebel refer reign relax relay renew reply rider ridge " +
  "rifle right rigid risky rival river roast robin robot rocky rough round route royal rugby ruler rural rusty salad " +
  "sauce scale scare scene scent scope score scout screw sense serve seven shade shaft shake shall shame shape share " +
  "sharp sheep sheet shelf shell shift shine shirt shock shoot shore short shout shown sight silly since sixty skill " +
  "skirt slate sleep slice slide slope small smart smell smile smoke snake solar solid solve sorry sound south space " +
  "spare spark speak speed spell spend spice spike spine spite split spoke sport spray stack staff stage stain stair " +
  "stake stamp stand stare start state steam steel steep steer stem stick stiff still sting stock stone stood store " +
  "storm story stove strap straw strip stuck study stuff style sugar suite sunny super surge swear sweat sweet swift " +
  "swing sword table taken taste teach tempo tenth thank theft theme there thick thief thing think third thorn threw " +
  "throw thumb tiger tight timer tired title toast today token tooth topic torch total touch tough tower trace track " +
  "trade trail train trait treat trend trial tribe trick troop truck truly trunk trust truth twice twist uncle under " +
  "union unite unity upper upset urban usage usual valid value vapor vault verse video villa virus visit vital vivid " +
  "vocal voice voter wagon waist watch water weigh weird whale wheat wheel where which while white whole widow width " +
  "windy witch woman world worry worse worst worth would wound woven wrist write wrong wrote yield young youth")
  .split(" ").filter((w) => w.length === WORD_LEN);

export function wordForRound(matchSeed, round) {
  const rng = makeRng(`${matchSeed}#wordle#round${round}`);
  return POOL[Math.floor(rng() * POOL.length)];
}

// Standard wordle marking: "g" right letter right spot, "y" right letter
// wrong spot (limited by how many of that letter remain unmatched), "x" no.
export function scoreGuess(guess, secret) {
  const marks = Array(WORD_LEN).fill("x");
  const left = {};
  for (let i = 0; i < WORD_LEN; i++) {
    if (guess[i] === secret[i]) marks[i] = "g";
    else left[secret[i]] = (left[secret[i]] || 0) + 1;
  }
  for (let i = 0; i < WORD_LEN; i++) {
    if (marks[i] === "g") continue;
    if (left[guess[i]]) {
      marks[i] = "y";
      left[guess[i]]--;
    }
  }
  return marks.join("");
}

export function encodeScore(guesses, seconds) {
  return guesses * 10000 + Math.min(TIME_CAP, Math.max(0, Math.round(seconds)));
}

export function decodeScore(total) {
  const t = Math.max(0, Number(total) || 0);
  return { guesses: Math.floor(t / 10000), seconds: t % 10000 };
}
