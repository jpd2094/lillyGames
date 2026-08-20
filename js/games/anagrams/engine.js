// Anagrams engine: deterministic rack generation and letter accounting.
// Everything here is pure — no DOM, no storage — so it can be unit-tested
// and reused (the solver imports the same letter-count helpers).
//
// A rack is the 8 letters of a real 8-letter word, shuffled. The pool is
// baked into code (like wordgrid's DICE) rather than derived from the
// dictionary file, so a dictionary edit can never hand two players
// different racks for the same round mid-match. Words were picked by
// sub-word yield: every rack here can make 300+ dictionary words, and the
// full 8-letter anagram (11 pts) always exists. No two racks share a
// letter multiset.

import { makeRng } from "../wordgrid/engine.js";

export const RACK_SIZE = 8;

const POOL = [
  "abridges", "acridest", "adopters", "agrestic", "ailerons", "ailments", "alerting", "aligners", "almoners", "alunites",
  "amnestic", "amniotes", "amortise", "ancestor", "ancestry", "aneroids", "anethols", "angriest", "apostles", "apricots",
  "apterous", "arbelest", "arenites", "articled", "articles", "artiness", "ascribed", "asperity", "aspheric", "assentor",
  "asterism", "asteroid", "asthenic", "ateliers", "atropins", "atropism", "balmiest", "baluster", "bandores", "banister",
  "barguest", "barkiest", "barmiest", "baronets", "bartends", "batchers", "bearings", "bedrails", "blastier", "blathers",
  "bloaters", "bornites", "brandies", "breadths", "broadest", "brocades", "bromates", "burstone", "cabestro", "calipers",
  "calories", "canister", "capelins", "capsomer", "capstone", "captures", "carlines", "carmines", "carotins", "cavilers",
  "centares", "centaurs", "centrals", "ceramist", "champers", "chanters", "chaplets", "chapters", "chariest", "charlies",
  "chimeras", "cholates", "choleras", "citadels", "claimers", "clampers", "clearest", "clematis", "coarsest", "cointers",
  "crankest", "crispate", "darioles", "daunters", "dealings", "decimals", "decrials", "delators", "depaints", "deraigns",
  "desalter", "detrains", "dialyser", "diaspore", "diastole", "dilaters", "dilators", "dioptase", "diopters", "dipteral",
  "dipteran", "dismaler", "displace", "dragline", "dragnets", "durables", "earldoms", "earlship", "earplugs", "easterly",
  "eductors", "elapsing", "elastins", "elations", "emirates", "endocast", "endosarc", "enthrals", "entrails", "epiblast",
  "epigrams", "escargot", "espartos", "estragon", "estrange", "eternals", "ethicals", "fagoters", "fainters", "fleapits",
  "floaters", "forecast", "foremast", "forepast", "frailest", "garments", "gelatins", "genitors", "gestural", "gladiest",
  "glariest", "gloaters", "grapiest", "gremials", "hairnets", "halteres", "haplites", "hardiest", "hardnose", "helipads",
  "hematins", "heparins", "hoariest", "horniest", "hydrates", "idocrase", "idolater", "impalers", "impanels", "impleads",
  "imposter", "inflates", "instable", "instroke", "interlap", "intreats", "intrudes", "islander", "keratins", "lactones",
  "ladrones", "lamberts", "laminose", "lamister", "lankiest", "larkiest", "leopards", "leporids", "levators", "librated",
  "literals", "loamiest", "loathers", "locaters", "madrones", "magister", "magnetos", "mangiest", "manropes", "marlines",
  "mastered", "masterly", "matchers", "medalist", "mediants", "melodias", "menstrua", "meropias", "minarets", "misgrade",
  "misheard", "misrated", "mistaker", "monstera", "moraines", "moralise", "moralist", "mortised", "muriates", "negroids",
  "neutrals", "notables", "notaries", "notepads", "oleaster", "opalines", "operands", "operants", "operates", "orbitals",
  "organise", "organist", "oriental", "outdares", "outearns", "outhears", "outleaps", "outraces", "outrages", "overacts",
  "overpast", "painters", "palestra", "palmiest", "panelist", "panthers", "parecism", "parietes", "parodist", "parslied",
  "partiers", "partlets", "pasterns", "pastries", "pastured", "pastures", "pederast", "pelorias", "peracids", "pergolas",
  "perigons", "persalts", "personal", "petrales", "petrosal", "petunias", "peytrals", "phaetons", "phorates", "pilaster",
  "pistoled", "planters", "pleaders", "poachers", "pointers", "poitrels", "polecats", "polentas", "portages", "portends",
  "postrace", "postured", "potables", "potheads", "potlines", "poulters", "pounders", "praetors", "pralines", "precasts",
  "preheats", "prevails", "primates", "prisoned", "privates", "probates", "prolines", "prosiest", "prostate", "pulsated",
  "rachides", "rampoles", "ranpikes", "raphides", "rapidest", "ravelins", "readiest", "realised", "realists", "redbaits",
  "redcoats", "reflates", "refutals", "residual", "restamps", "retinols", "rhapsode", "rinsable", "romances", "rosulate",
  "roundest", "roupiest", "routines", "ruinates", "saboteur", "samphire", "sandpile", "saponite", "scarphed", "scenario",
  "sceptral", "scleroma", "scorepad", "seafront", "sedating", "semibald", "sepaloid", "septical", "sharpest", "shortage",
  "skiplane", "slipware", "smearing", "sparlike", "spearing", "specular", "spirulae", "spoliate", "sprained", "starched",
  "staumrel", "steapsin", "sternway", "stolider", "strangle", "strobile", "sublated", "superhot", "suricate", "taborins",
  "tacklers", "tadpoles", "talipeds", "tangelos", "tapholes", "tawdries", "temperas", "templars", "tempuras", "teraohms",
  "terminal", "tertials", "thermals", "thespian", "thoraces", "tinwares", "tonsilar", "trachles", "traduces", "trashmen",
  "trawleys", "trefoils", "trepangs", "triphase", "trophies", "twangers", "typebars", "unripest", "upraised", "upsoared",
  "uralites", "urbanest", "valorise", "ventails", "vitamers", "warstled", "wartimes", "watchers", "waterish", "wiretaps",
];

export function rackForRound(matchSeed, round) {
  const rng = makeRng(`${matchSeed}#anagrams#round${round}`);
  const letters = POOL[Math.floor(rng() * POOL.length)].split("");
  for (let i = letters.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [letters[i], letters[j]] = [letters[j], letters[i]];
  }
  return letters;
}

export function letterCounts(word) {
  const counts = {};
  for (const ch of word) counts[ch] = (counts[ch] || 0) + 1;
  return counts;
}

// Can `word` be spelled from the rack, using each rack letter at most once?
export function canBuild(word, rackCounts) {
  const used = {};
  for (const ch of word) {
    used[ch] = (used[ch] || 0) + 1;
    if (used[ch] > (rackCounts[ch] || 0)) return false;
  }
  return true;
}
