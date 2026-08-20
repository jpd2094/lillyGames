// Wordle Duel engine tests. Run: node tests/wordle-engine.test.mjs
import { readFileSync } from "node:fs";
import {
  POOL, WORD_LEN, MAX_GUESSES, wordForRound, scoreGuess, encodeScore, decodeScore,
} from "../js/games/wordle/engine.js";

let failures = 0;
const check = (name, cond) => { if (!cond) { failures++; console.error(`FAIL: ${name}`); } else console.log(`ok: ${name}`); };

const dict = new Set(
  readFileSync(new URL("../data/dictionary.txt", import.meta.url), "utf8").split("\n").filter(Boolean)
);

check("pool is decently sized", POOL.length >= 400);
check("all pool words are 5 letters", POOL.every((w) => w.length === WORD_LEN));
const missing = POOL.filter((w) => !dict.has(w));
check(`every pool word is in the dictionary${missing.length ? " (missing: " + missing.join(", ") + ")" : ""}`, missing.length === 0);
check("no duplicate pool words", new Set(POOL).size === POOL.length);

check("secret deterministic per seed+round", wordForRound("s", 1) === wordForRound("s", 1));
check("different rounds differ", wordForRound("s", 1) !== wordForRound("s", 2) || wordForRound("s", 2) !== wordForRound("s", 3));
check("secret comes from the pool", POOL.includes(wordForRound("abc", 3)));

// Marking, including the tricky duplicate-letter cases
check("all green on exact match", scoreGuess("crane", "crane") === "ggggg");
check("all gray on disjoint letters", scoreGuess("crane", "oduls") === "xxxxx"); // wait: none shared
check("simple yellow", scoreGuess("cigar", "acorn")[1] === "x" && scoreGuess("cigar", "acorn").includes("y"));
// secret "geese", guess "eagle": e(0) yellow (secret has e's beyond matches),
// a gray, g yellow, l gray, e(4) GREEN
check("duplicate letters: eagle vs geese", scoreGuess("eagle", "geese") === "yxyxg");
// secret "abbey", guess "babes": b yellow, a yellow, b green, e green, s gray
check("duplicate letters: babes vs abbey", scoreGuess("babes", "abbey") === "yyggx");
// secret "crane", guess "eeeee": only position 4 green, rest gray (one e in secret)
check("repeated guess letter limited by secret count", scoreGuess("eeeee", "crane") === "xxxxg");

// Score encoding: guesses dominate, time breaks ties
check("encode/decode roundtrip", JSON.stringify(decodeScore(encodeScore(4, 83))) === JSON.stringify({ guesses: 4, seconds: 83 }));
check("fewer guesses always beats faster time", encodeScore(3, 9999) < encodeScore(4, 1));
check("equal guesses: time decides", encodeScore(4, 30) < encodeScore(4, 31));
check("time capped so it can't spill into guesses", encodeScore(4, 999999) < encodeScore(5, 0));

process.exit(failures ? 1 : 0);
