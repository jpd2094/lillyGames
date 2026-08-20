// Blackjack Duel game plugin.
//
// Same contract as every game (see js/games/registry.js), plus the two
// optional live hooks the platform passes to mountRound: reportProgress
// (publish my mid-round progress) and onRivalUpdate (watch theirs) — that's
// what powers the live rival ticker while both players are at the table.

import { HANDS_PER_DUEL, BANKROLL } from "./engine.js";
import { mountRound as mountRoundUi } from "./ui.js";

export default {
  id: "blackjack",
  name: "Blackjack Duel",
  tagline: "Same cards, same bankroll. Only the decisions differ.",
  rounds: 1, // deckForHand keys on seed+hand only — fold `round` in if this ever grows
  roundSeconds: 0, // untimed — the duel ends when the hands run out
  pitch: `1 duel · ${HANDS_PER_DUEL} hands`,
  rules: [
    `${HANDS_PER_DUEL} hands against the dealer, ${BANKROLL} chips to start, 10 a hand.`,
    "You both get the exact same cards — the dealer's too. Only your hit, stand, double and split calls differ.",
    "Dealer stands on 17. Blackjack pays 3:2. Split once, double any first two cards.",
    "Watch the ticker: it shows your rival's hand count and stack live. Higher stack takes the duel.",
  ],

  async prepare() {
    return {}; // cards need no assets
  },

  mountRound(container, { seed, round, totalRounds, assets, onDone, reportProgress, onRivalUpdate }) {
    return mountRoundUi(container, { seed, onDone, reportProgress, onRivalUpdate });
  },

  // Hand-by-hand ledger: both players' nets side by side with running stacks.
  renderResults(container, { match, me, rival }) {
    const myNets = netsOf(match, me), theirNets = netsOf(match, rival);
    const rows = [];
    let myStack = BANKROLL, theirStack = BANKROLL;
    for (let h = 0; h < Math.max(myNets.length, theirNets.length); h++) {
      const mine = myNets[h], theirs = theirNets[h];
      if (mine != null) myStack += mine;
      if (theirs != null) theirStack += theirs;
      rows.push(`
        <tr>
          <td>${h + 1}</td>
          <td class="${cls(mine)}">${fmt(mine)}</td><td>${mine == null ? "—" : myStack}</td>
          <td class="${cls(theirs)}">${fmt(theirs)}</td><td>${theirs == null ? "—" : theirStack}</td>
        </tr>`);
    }
    container.innerHTML = `
      <section class="result-round">
        <h3>Hand by hand</h3>
        <table class="bj-ledger">
          <thead><tr><th></th><th colspan="2" class="is-me-th">${esc(me)}</th><th colspan="2" class="is-rival-th">${esc(rival)}</th></tr>
          <tr><th>#</th><th>net</th><th>stack</th><th>net</th><th>stack</th></tr></thead>
          <tbody>${rows.join("")}</tbody>
        </table>
        ${myNets.length < HANDS_PER_DUEL || theirNets.length < HANDS_PER_DUEL
          ? `<p class="result-missed"><span>A short column means that player went bust before hand ${HANDS_PER_DUEL}.</span></p>` : ""}
      </section>`;
  },
};

function netsOf(match, player) {
  const r = match.results[player]?.rounds?.[0];
  return Array.isArray(r?.hands) ? r.hands.map((n) => Number(n) || 0) : [];
}

function fmt(n) {
  return n == null ? "—" : n > 0 ? `+${n}` : `${n}`;
}

function cls(n) {
  return n == null ? "" : n > 0 ? "is-plus" : n < 0 ? "is-minus" : "";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
