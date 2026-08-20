// One Blackjack Duel: 10 hands against the dealer, duplicate cards for both
// rivals, live ticker showing the rival's progress.
//
// mountRound(container, opts) -> destroy()
//   opts: { seed, onDone, reportProgress?, onRivalUpdate? }
//   onDone({ score, hands: [netChips, ...] })
//
// The duel checkpoints itself to localStorage after every hand. The decks
// are deterministic (that's the duplicate-blackjack requirement), so a
// refresh that restarted the duel would replay cards the player has already
// seen — a free peek. Resuming from the checkpoint closes that hole and
// survives phone browsers evicting the tab mid-duel; a hand that was in
// progress at refresh time is settled as an automatic stand, so reloading
// can never turn card knowledge into better decisions.

import {
  deckForHand, handTotal, isBlackjack, dealerPlay, settle, rank, suit,
  HANDS_PER_DUEL, BANKROLL, BASE_BET,
} from "./engine.js";

const SUITS = ["♠", "♥", "♦", "♣"]; // ♠ ♥ ♦ ♣
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function cardFace(c) {
  const red = suit(c) === 1 || suit(c) === 2;
  return `<span class="card${red ? " is-red" : ""}">${RANKS[rank(c)]}<i>${SUITS[suit(c)]}</i></span>`;
}

function cardBack() {
  return `<span class="card is-back"></span>`;
}

// Ten-value ranks (10/J/Q/K) count as equal for splitting.
function cardValue(c) {
  return Math.min(rank(c) + 1, 10);
}

export function mountRound(container, opts) {
  const { seed, onDone, reportProgress, onRivalUpdate } = opts;

  let chips = BANKROLL;
  let handNo = 0; // 1-based once a hand starts
  const nets = []; // per-hand net chips, the duel record
  let ended = false;

  // ── Checkpointing ──────────────────────────────────────────────────────
  const saveKey = `lilly.bj.${seed}`;

  function checkpoint(inHand) {
    try { localStorage.setItem(saveKey, JSON.stringify({ handNo, chips, nets, inHand })); } catch {}
  }

  function readCheckpoint() {
    try { return JSON.parse(localStorage.getItem(saveKey)); } catch { return null; }
  }

  // Settle a hand the player never finished (refresh mid-hand) as an
  // automatic stand on the first two cards — deterministic, no decisions.
  function autoStand(hand) {
    const deckThen = deckForHand(seed, hand);
    const player = [deckThen[0], deckThen[1]];
    let dealer = [deckThen[51], deckThen[50]];
    const bet = Math.min(BASE_BET, chips);
    const bj = isBlackjack(player), dbj = isBlackjack(dealer);
    if (!bj && !dbj) dealer = dealerPlay(deckThen);
    let net = settle(player, dealer, bet, { blackjack: bj, dealerBlackjack: dbj });
    if (net > 0 && bj) net = Math.floor(net);
    chips += net;
    nets.push(net);
  }

  // Per-hand state
  let deck, playerNext, hands, activeIdx, dealerCards, holeShown, handOver;

  container.innerHTML = `
    <div class="round bj">
      <div class="round-top">
        <span class="round-chip" data-handno>Hand 1<i>/${HANDS_PER_DUEL}</i></span>
        <span class="round-score" data-chips>${chips}</span>
      </div>
      <div class="bj-rival" data-rival hidden></div>
      <div class="bj-table">
        <div class="bj-row"><span class="bj-label">Dealer <b data-dealer-total></b></span><div class="bj-cards" data-dealer></div></div>
        <div data-player-hands></div>
      </div>
      <p class="bj-banner" data-banner hidden></p>
      <div class="bj-actions" data-actions>
        <button class="btn" data-act="hit">Hit</button>
        <button class="btn" data-act="stand">Stand</button>
        <button class="btn" data-act="double">Double</button>
        <button class="btn" data-act="split">Split</button>
      </div>
      <button class="btn btn-primary bj-next" data-next hidden></button>
    </div>`;

  const el = (s) => container.querySelector(s);
  const handNoEl = el("[data-handno]"), chipsEl = el("[data-chips]");
  const dealerEl = el("[data-dealer]"), dealerTotalEl = el("[data-dealer-total]");
  const playerEl = el("[data-player-hands]");
  const bannerEl = el("[data-banner]"), actionsEl = el("[data-actions]");
  const nextBtn = el("[data-next]"), rivalEl = el("[data-rival]");

  // ── Live rival ticker ──────────────────────────────────────────────────
  onRivalUpdate?.((rivalResult) => {
    if (ended) return;
    let text = null;
    const finished = rivalResult?.rounds?.filter(Boolean)?.length;
    if (finished) text = `Rival finished: ${Number(rivalResult.total) || 0} chips`;
    else if (rivalResult?.progress) {
      const p = rivalResult.progress;
      // Progress with an old timestamp is a duel they walked away from, not
      // live play — say so instead of implying they're at the table now.
      const stale = Number(p.at) && Date.now() - Number(p.at) > 10 * 60_000;
      text = `${stale ? "Rival paused at" : "Rival:"} hand ${Number(p.played) || 0}/${HANDS_PER_DUEL} · ${Number(p.chips) || 0} chips`;
    }
    rivalEl.hidden = !text;
    if (text) rivalEl.textContent = text;
  });

  // ── Hand lifecycle ─────────────────────────────────────────────────────
  function committed() {
    return hands.reduce((sum, h) => sum + h.bet, 0);
  }

  function deal() {
    handNo++;
    deck = deckForHand(seed, handNo);
    playerNext = 0;
    const bet = Math.min(BASE_BET, chips);
    hands = [{ cards: [deck[playerNext++], deck[playerNext++]], bet, doubled: false, done: false, fromSplit: false }];
    activeIdx = 0;
    dealerCards = [deck[51], deck[50]]; // hole, up
    holeShown = false;
    handOver = false;
    handNoEl.innerHTML = `Hand ${handNo}<i>/${HANDS_PER_DUEL}</i>`;
    bannerEl.hidden = true;
    nextBtn.hidden = true;

    checkpoint(true);

    // Dealer peek: a dealer blackjack ends the hand immediately, as does a
    // player blackjack (paid 3:2 straight away).
    if (isBlackjack(dealerCards) || isBlackjack(hands[0].cards)) {
      hands[0].done = true;
      return settleHand();
    }
    render();
  }

  function activeHand() {
    return hands[activeIdx];
  }

  function advance() {
    while (activeIdx < hands.length && hands[activeIdx].done) activeIdx++;
    if (activeIdx >= hands.length) return settleHand();
    const h = activeHand();
    // A split hand plays with one card until it becomes active
    if (h.cards.length === 1) {
      h.cards.push(deck[playerNext++]);
      if (h.splitAces) h.done = true; // split aces get exactly one card
      else if (handTotal(h.cards).total === 21) h.done = true;
      if (h.done) return advance();
    }
    render();
  }

  function act(action) {
    if (handOver || ended) return;
    const h = activeHand();
    if (action === "hit") {
      h.cards.push(deck[playerNext++]);
      const t = handTotal(h.cards).total;
      if (t >= 21) h.done = true;
    } else if (action === "stand") {
      h.done = true;
    } else if (action === "double" && canDouble(h)) {
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(deck[playerNext++]);
      h.done = true;
    } else if (action === "split" && canSplit(h)) {
      const [c1, c2] = h.cards;
      const splitAces = rank(c1) === 0;
      hands = [
        { cards: [c1], bet: h.bet, doubled: false, done: false, fromSplit: true, splitAces },
        { cards: [c2], bet: h.bet, doubled: false, done: false, fromSplit: true, splitAces },
      ];
      activeIdx = 0;
    } else {
      return;
    }
    advance();
  }

  function canDouble(h) {
    return h.cards.length === 2 && !h.doubled && committed() + h.bet <= chips;
  }

  function canSplit(h) {
    return hands.length === 1 && h.cards.length === 2 &&
      cardValue(h.cards[0]) === cardValue(h.cards[1]) &&
      committed() + h.bet <= chips;
  }

  function settleHand() {
    handOver = true;
    holeShown = true;
    // Dealer only draws when a player hand still needs beating — busts and
    // settled naturals don't (a natural is paid 3:2 on the spot; drawing out
    // the dealer against it would show a hand that seems to beat you).
    const anyLive = hands.some((h) =>
      handTotal(h.cards).total <= 21 && !(!h.fromSplit && isBlackjack(h.cards)));
    const dealerBJ = isBlackjack(dealerCards);
    if (anyLive && !dealerBJ) dealerCards = dealerPlay(deck);

    let net = 0;
    for (const h of hands) {
      const bj = !h.fromSplit && isBlackjack(h.cards);
      const raw = settle(h.cards, dealerCards, h.bet, { blackjack: bj, dealerBlackjack: dealerBJ });
      net += raw > 0 && bj ? Math.floor(raw) : raw; // whole chips on odd all-in 3:2
    }
    chips += net;
    nets.push(net);
    checkpoint(false);
    chipsEl.textContent = chips;
    reportProgress?.({ played: handNo, chips, at: Date.now() });

    const duelOver = handNo >= HANDS_PER_DUEL || chips <= 0;
    bannerEl.hidden = false;
    bannerEl.className = "bj-banner " + (net > 0 ? "is-win" : net < 0 ? "is-loss" : "");
    bannerEl.textContent = net > 0 ? `+${net} chips` : net < 0 ? `${net} chips` : "Push";
    nextBtn.hidden = false;
    nextBtn.textContent = duelOver ? "See the damage" : "Next hand";
    render();
  }

  function finishDuel() {
    if (ended) return;
    ended = true;
    try { localStorage.removeItem(saveKey); } catch {}
    onDone({ score: Math.max(0, chips), hands: nets });
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function render() {
    dealerEl.innerHTML = (holeShown ? cardFace(dealerCards[0]) : cardBack()) +
      dealerCards.slice(1).map(cardFace).join("");
    dealerTotalEl.textContent = holeShown ? handTotal(dealerCards).total :
      handTotal([dealerCards[1]]).total;

    playerEl.innerHTML = hands.map((h, i) => {
      const t = handTotal(h.cards);
      const active = !handOver && i === activeIdx && !h.done;
      const state = t.total > 21 ? " · bust" : h.doubled ? " · doubled" : "";
      return `
        <div class="bj-row${active ? " is-active" : ""}">
          <span class="bj-label">You <b>${t.total}${t.soft ? "s" : ""}</b><small>${h.bet} bet${state}</small></span>
          <div class="bj-cards">${h.cards.map(cardFace).join("")}</div>
        </div>`;
    }).join("");

    const h = handOver ? null : activeHand();
    actionsEl.hidden = handOver;
    if (h) {
      actionsEl.querySelector('[data-act="double"]').disabled = !canDouble(h);
      actionsEl.querySelector('[data-act="split"]').disabled = !canSplit(h);
    }
  }

  actionsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    if (btn && !btn.disabled) act(btn.dataset.act);
  });
  nextBtn.addEventListener("click", () => {
    if (!handOver) return; // never let this button skip a live hand
    if (handNo >= HANDS_PER_DUEL || chips <= 0) finishDuel();
    else deal();
  });

  // Resume a checkpointed duel, or start fresh.
  const saved = readCheckpoint();
  if (saved && Number.isInteger(saved.handNo) && saved.handNo >= 1 &&
      Number.isFinite(saved.chips) && Array.isArray(saved.nets)) {
    chips = saved.chips;
    nets.push(...saved.nets.map((n) => Number(n) || 0));
    handNo = saved.handNo;
    if (saved.inHand) { autoStand(handNo); checkpoint(false); }
    reportProgress?.({ played: handNo, chips, at: Date.now() });
    if (handNo >= HANDS_PER_DUEL || chips <= 0) finishDuel();
    else { handNo = nets.length; deal(); } // deal() advances to the next hand
  } else {
    reportProgress?.({ played: 0, chips, at: Date.now() });
    deal();
  }

  return function destroy() {
    ended = true;
  };
}
