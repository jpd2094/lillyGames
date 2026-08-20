// Blackjack Duel engine: deterministic dealing, hand math, dealer play,
// settlement. Everything here is pure — no DOM, no storage.
//
// Duplicate dealing: every hand gets its own seeded 52-card deck. The
// player's cards come off the TOP of the deck (index 0 upward) and the
// dealer's off the BOTTOM (index 51 downward), so a player's hit/double/
// split choices never shift which cards the dealer draws — and both rivals
// see the exact same player-stream and dealer-stream for every hand. All
// variance between the two players comes from their decisions.

import { makeRng } from "../wordgrid/engine.js";

export const HANDS_PER_DUEL = 10;
export const BANKROLL = 100;
export const BASE_BET = 10;

// Cards are 0..51: rank = c % 13 (0=A, 1=2 … 9=10, 10=J, 11=Q, 12=K),
// suit = floor(c / 13) (0=♠ 1=♥ 2=♦ 3=♣).
export function rank(card) { return card % 13; }
export function suit(card) { return Math.floor(card / 13); }

export function deckForHand(matchSeed, handNo) {
  const rng = makeRng(`${matchSeed}#blackjack#hand${handNo}`);
  const deck = [...Array(52).keys()];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Best blackjack total: aces count 11 while that doesn't bust.
// soft = an ace is currently counted as 11.
export function handTotal(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    const r = rank(c);
    if (r === 0) { aces++; total += 11; }
    else total += Math.min(r + 1, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

export function isBlackjack(cards) {
  return cards.length === 2 && handTotal(cards).total === 21;
}

// Dealer draws from the bottom of the deck (51 downward): hole card, up
// card, then hits until 17+. Stands on all 17s, soft included.
export function dealerPlay(deck) {
  const cards = [deck[51], deck[50]];
  let next = 49;
  while (handTotal(cards).total < 17) cards.push(deck[next--]);
  return cards;
}

// Net chips for one finished player hand against the dealer's final hand.
// flags: { blackjack, dealerBlackjack } — a two-card 21 only counts as
// blackjack on an unsplit first hand, so the caller decides the flags.
export function settle(playerCards, dealerCards, bet, flags = {}) {
  const p = handTotal(playerCards).total;
  if (flags.blackjack && flags.dealerBlackjack) return 0;
  if (flags.blackjack) return bet * 1.5;
  if (flags.dealerBlackjack) return -bet;
  if (p > 21) return -bet;
  const d = handTotal(dealerCards).total;
  if (d > 21 || p > d) return bet;
  if (p < d) return -bet;
  return 0;
}
