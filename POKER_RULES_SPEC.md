# Poker Rules Specification — No-Limit Texas Hold'em + Omaha (Cash Game)

> **Instructions for the AI coding assistant (Cursor):**
> This document is the source of truth for game rules. Audit the existing poker engine against every numbered rule below. For each rule: (1) find the code that implements it, (2) if it is missing or wrong, fix it, (3) add or update an automated test for it. Section 14 lists required test scenarios; all must pass. Do not change behaviour that this spec does not cover without flagging it. Where a rule is marked **[CONFIG]**, keep it configurable and use the stated default. All rule enforcement must happen on the server; the client is never trusted.

Scope: No-Limit betting, cash-game (ring) format, 2 to 9 (or 10) players per table, two variants: Texas Hold'em and Omaha (4 hole cards, high only).

---

## 1. Terminology

| Term | Meaning |
|---|---|
| Button (BTN) | Dealer marker. Determines blinds and order of action. |
| SB / BB | Small blind / big blind: forced bets posted before cards are dealt. |
| Street | A betting round: preflop, flop, turn, river. |
| Active player | Dealt into the hand and has not folded (may be all-in). |
| Can-act player | Active, not all-in, has chips behind. |
| Current bet | The highest total amount any player has put in **on this street**. |
| To call | Current bet minus the player's own bet on this street (capped at the player's stack). |
| Raise-to | The new total street bet a raiser commits to (not the increment). |
| Full raise | A raise whose increment is at least the minimum raise size. |
| Table stakes | A player can only wager chips that were on the table when the hand began. |

Always store amounts as integers in the smallest chip unit (e.g. cents). Never use floats.

---

## 2. Deck and dealing

2.1 One standard 52-card deck: ranks 2–9, T, J, Q, K, A; suits clubs, diamonds, hearts, spades. No jokers.

2.2 A fresh deck is shuffled for every hand with a cryptographically secure RNG and an unbiased shuffle (Fisher–Yates). The deck order is fixed before the first card is dealt and is never reshuffled mid-hand.

2.3 Hole cards are dealt one at a time, clockwise, starting with the first dealt-in seat left of the button (the small blind seat). Hold'em: 2 cards each. Omaha: 4 cards each.

2.4 Community cards: flop (3 cards), turn (1), river (1). **[CONFIG]** Burn one card before the flop, turn and river (default: on; has no effect on fairness but matches live play).

2.5 A card can never appear twice in a hand. Hole cards are sent only to their owner; other clients must never receive them before showdown.

2.6 Card capacity check: Omaha with 10 players uses 40 hole + 5 board + 3 burns = 48 cards (fits). Maximum seats must never require more than 52 cards.

---

## 3. Seats, button and blinds

3.1 A hand requires at least 2 players who are seated, not sitting out, and have chips. If fewer, no hand starts.

3.2 The first hand's button is assigned at random among eligible players (or by high-card draw).

3.3 Standard positions (3+ players): SB is the first eligible seat clockwise from the button; BB is the next one after SB.

3.4 **Heads-up (exactly 2 players):** the button posts the SB and the other player posts the BB. The button/SB acts **first preflop** and **last on every later street**. This is the most commonly broken rule; test it explicitly.

3.5 Button movement **[CONFIG, default: dead button rule]**:
- The BB always moves forward one eligible player each hand. Nobody ever posts the BB twice in a row and nobody skips the BB.
- The SB is the seat that was BB in the previous hand. If that player left or busted, there is no SB that hand ("dead small blind").
- The button is the seat that was SB in the previous hand. If that seat is now empty, the button sits on the empty seat ("dead button"); action order is still calculated from that seat.
- Simplified alternative ("moving button": button moves to the next eligible player, SB and BB follow) is acceptable only if selected in config; it must be applied consistently.

3.6 Transition to heads-up (3 → 2 players): the player due to be BB next posts the BB; the other player is button/SB. No player posts the BB twice in a row because of the transition.

3.7 Transition from heads-up to 3+ players: resume normal rotation; the new player follows rule 3.9.

3.8 Blinds are "live": they count toward the poster's bet on the preflop street.

3.9 New player entering **[CONFIG]**: a new player (or a player returning after missing blinds) either waits until the BB reaches their seat (default) or posts an amount equal to the BB immediately to be dealt in. A new player may not be dealt in while seated between the button and the blinds (must wait until the button passes).

3.10 Missed blinds **[CONFIG]**: a player who sat out through their blinds must, on return, either wait for the BB or post the BB (live) plus the SB (dead, goes straight into the pot and does not count toward their bet).

3.11 Short stack posting a blind: a player with fewer chips than the blind posts everything they have and is all-in. See 5.10 for how this affects betting.

3.12 **[CONFIG]** Antes, straddles and "run it twice" are optional and default to off.

---

## 4. Hand flow

1. Determine eligible players, move button, post blinds (and any dead/extra posts).
2. Shuffle, deal hole cards.
3. Preflop betting round.
4. Flop (3 cards), betting round.
5. Turn (1 card), betting round.
6. River (1 card), betting round.
7. Showdown, pot distribution, rake.
8. Hand cleanup: remove busted/leaving players, apply pending top-ups and seat changes, start next hand.

4.1 If at any moment only one active player remains (everyone else folded), the hand ends immediately: that player wins the whole pot, no more cards are dealt, and they are not required to show their cards.

4.2 If a betting round ends and fewer than two players can still act (the rest are all-in), no further betting rounds are run: the remaining board cards are dealt straight through to showdown. **[CONFIG]** Hole cards of all active players are turned face up at that point (default: on).

4.3 A lone player with chips remaining, when all opponents are all-in and the lone player has already matched, is **not** prompted to act on later streets.

---

## 5. Betting rules (No-Limit)

### 5.1 Order of action
- Preflop: first to act is the first can-act player clockwise from the BB ("under the gun"). Action ends with the BB (who has the "option").
- Flop, turn, river: first to act is the first can-act player clockwise from the button. The button (if still in) acts last.
- Heads-up exception: see 3.4.
- Folded and all-in players are skipped. Action always proceeds clockwise, one player at a time. Out-of-turn actions are rejected.

### 5.2 Legal actions
| Situation | Legal actions |
|---|---|
| No bet to face (to call = 0) | Check, Bet (or all-in) |
| Facing a bet, raising allowed | Fold, Call, Raise (or all-in) |
| Facing a bet, raising not reopened (see 5.7) | Fold, Call only |
| Stack ≤ to call | Fold, Call all-in (no raise) |

Fold when to call = 0 **[CONFIG]**: default is to reject the fold and offer check instead; never silently convert it.

### 5.3 Minimum bet
The minimum opening bet on any street is one big blind. A player with less than one BB may bet all-in for less.

### 5.4 Maximum bet
A player's entire stack (all-in). There is no cap on the number of raises.

### 5.5 Minimum raise
The minimum raise **increment** equals the size of the last **full** bet or raise on the current street. Preflop, the BB counts as the opening bet, so the first raise must be to at least 2 × BB.

    minRaiseTo = currentBet + lastFullRaiseSize
    lastFullRaiseSize starts each street as BB
    on a full bet/raise to X:  lastFullRaiseSize = X - previousCurrentBet;  currentBet = X

Examples (blinds 50/100):
- Preflop, UTG raises to 300 (increment 200). Next min raise is to 500.
- Flop, A bets 100, B raises to 400 (increment 300). Min re-raise is to 700.

### 5.6 All-in for less than a call
A player may always call all-in for less than the amount to call. They can only win from each opponent up to what they put in (see section 6).

### 5.7 All-in for less than a full raise (incomplete raise)
A player may go all-in for more than the current bet but less than `minRaiseTo`. This is a legal action, and:
- `currentBet` increases to the all-in amount.
- `lastFullRaiseSize` does **not** change.
- It does **not** reopen the betting for players who have already acted on this street and who would now face less than a full raise. Those players may only fold or call the extra.
- Players who have **not yet acted** since the last full raise may still raise normally (min raise-to = new currentBet + lastFullRaiseSize).
- Several incomplete all-in raises **accumulate**: if the total increase a player faces since their own last action is ≥ `lastFullRaiseSize`, betting is reopened for that player.

Recommended implementation: store, per player, `betLevelWhenLastActed` (the value of `currentBet` at their last voluntary action this street, or "none" if they haven't acted). A player may raise if and only if:

    hasNotActedThisStreet
    OR (currentBet - betLevelWhenLastActed) >= lastFullRaiseSize

Example (blinds 50/100, flop): A bets 100. B is all-in for 150 (incomplete raise of 50). C calls 150. Back to A: A faces only 50 more, less than a full raise of 100, so A may only call or fold. But if C had instead raised to 250 or more (C had not acted yet, so C is allowed; min raise-to is 150 + 100 = 250), A would face a full raise and could re-raise.

### 5.8 Opening bet all-in for less than one BB (postflop)
If a player opens all-in for less than one BB (e.g. 60 when BB is 100), following players may fold, call 60, or raise to at least 60 + 100 = 160. `lastFullRaiseSize` remains BB.

### 5.9 Big blind option and small blind completion
- If nobody raised preflop, the SB may fold, call the difference ("complete"), or raise. The BB may then check or raise. The preflop round does **not** end until the BB has had this option.
- Posting a blind does not count as "having acted". Blind posters always get an action unless they are all-in or the hand ended.
- If the BB is all-in from posting, there is no option.

### 5.10 Short all-in blinds
- If the BB posts short (e.g. 60 of 100), the current bet to call preflop is still the full BB (100), and the minimum raise is still to 2 × BB (200). Other players do not get to call just 60; any excess they cannot be matched for is returned via the side-pot / uncalled-bet logic.
- If the SB posts short, they are simply all-in for that amount.
- If only the SB and a short-stacked BB remain, the unmatched part of the SB's post is returned to the SB.

### 5.11 End of a betting round
A betting round ends when **all** of these hold:
- every can-act player has acted at least once on this street (the BB preflop included), and
- every can-act player's street bet equals `currentBet`, or
- only one active player remains (hand ends, 4.1), or
- no player can act (all active players all-in, or one can-act player left who has matched the current bet).

Special case: everyone checks → round ends when action returns to the first player.

### 5.12 Uncalled bets
When a round ends, any part of the highest bet that no other player (active **or folded**) matched is returned to the bettor before pots are built. It is not part of the pot and is not raked. Compute as: highest total contribution minus second-highest total contribution among all players dealt into the hand.

### 5.13 Chips between streets
At the end of each street, street bets are moved to the pot(s), and `currentBet`, per-player street bets, `lastFullRaiseSize` (reset to BB) and per-player acted flags are reset.

### 5.14 Input validation (server side)
Reject any action where: it is not that player's turn; amount is negative, fractional below the smallest unit, or above their stack; raise-to is below `minRaiseTo` and is not an all-in; bet is below BB and is not an all-in; "check" when facing a bet; "raise" when betting is not reopened; action arrives for a finished hand or street. A bet or raise of the player's whole stack is always treated as all-in. A "call" for more than the stack is converted to an all-in call.

---

## 6. Pots and side pots

6.1 Track each player's **total contribution** to the hand (all streets, including blinds, antes excluded if dead). Folded players' chips stay in the pot, but folded players can never win anything.

6.2 Side pots are needed whenever an all-in player has contributed less than another active player. A player can win, from each opponent, at most the amount they themselves contributed.

6.3 Algorithm (run after returning uncalled bets, at showdown or any time pots are displayed):

    levels = sorted distinct total contributions of ACTIVE (non-folded) players
    prev = 0
    for L in levels:
        amount   = sum over ALL dealt-in players (folded too) of
                   ( min(contribution, L) - min(contribution, prev) )
        eligible = active players with contribution >= L
        if amount > 0: pots.push({ amount, eligible })
        prev = L
    merge consecutive pots whose eligible sets are identical

6.4 Worked example. Blinds irrelevant; total contributions: A = 100 (all-in), B = 300 (all-in), C = 500, D = 500, E = 80 (folded).
- Main pot, level 100: 100 + 100 + 100 + 100 + 80 = 480, eligible A, B, C, D.
- Side pot 1, level 300: 0 + 200 + 200 + 200 + 0 = 600, eligible B, C, D.
- Side pot 2, level 500: 200 + 200 = 400, eligible C, D.
- Total 1,480 = sum of contributions. Always assert this.

6.5 Each pot is awarded independently to the best hand(s) among **its own eligible players**. A player can lose the side pot and still win the main pot, and vice versa.

6.6 If a side pot has only one eligible player (opponents folded), that player wins it without needing to beat anyone.

6.7 Dead money (dead SB posts, antes) goes into the main pot.

---

## 7. Hand rankings

Five-card hands, highest to lowest:

| # | Hand | Definition | Tie-break (compare in order) |
|---|---|---|---|
| 1 | Straight flush | 5 consecutive ranks, same suit (royal flush = A-high straight flush) | Highest card of the straight |
| 2 | Four of a kind | 4 cards of one rank | Quad rank, then kicker |
| 3 | Full house | 3 of one rank + 2 of another | Trips rank, then pair rank |
| 4 | Flush | 5 cards of one suit | Each card high to low (all 5) |
| 5 | Straight | 5 consecutive ranks | Highest card of the straight |
| 6 | Three of a kind | 3 cards of one rank | Trips rank, then 2 kickers high to low |
| 7 | Two pair | 2 pairs | High pair, low pair, kicker |
| 8 | One pair | 2 cards of one rank | Pair rank, then 3 kickers high to low |
| 9 | High card | None of the above | Each card high to low (all 5) |

7.1 The ace is high (above K) or low (below 2) in straights. A-2-3-4-5 (the "wheel") is the lowest straight; its high card is the **5**, so 2-3-4-5-6 beats it. Straights do not wrap around: Q-K-A-2-3 is **not** a straight.

7.2 Suits are never ranked and never break ties. Hands identical in rank across all five cards tie and split the pot.

7.3 Only the best five cards count. A sixth or seventh card never breaks a tie.

7.4 **Hold'em hand construction:** the best 5-card hand from any combination of the 2 hole cards and 5 board cards (21 combinations): both, one, or **zero** hole cards ("playing the board"). If all remaining players play the board, they split.

7.5 **Omaha hand construction:** the hand must use **exactly 2** of the 4 hole cards and **exactly 3** of the 5 board cards. Evaluate all C(4,2) × C(5,3) = 60 combinations and take the best. Never reuse the Hold'em evaluator on 9 cards.

7.6 Omaha traps that must be tested:
- Four cards of one suit on the board and one card of that suit in hand is **not** a flush (needs two suited hole cards).
- Four hole cards of one suit: only two of them count; still needs three of that suit on the board.
- A straight on the board cannot be "played"; the player needs two hole cards that make a straight with three board cards.
- Quads on the board: nobody has quads (only 3 board cards usable). Best is typically a full house using a pocket pair, or trips with two hole-card kickers.
- Three or four of a kind in the hole cards only counts as a pair (two hole cards used).
- Board pair + one matching hole card = trips, but a full house needs the second hole card to pair the board or the two hole cards to be a pair that fits.
- A full house on the board (e.g. K-K-K-7-7) does not give every player a full house.

---

## 8. Showdown

8.1 Showdown happens when the river betting round ends with two or more active players, or after an all-in runout (4.2).

8.2 Show order: the last player to bet or raise on the final betting round shows first. If there was no bet on the final round, the first active player clockwise from the button shows first. Then clockwise.

8.3 **[CONFIG]** A player whose hand cannot win any pot they are eligible for may muck without showing (default: auto-muck losing hands, with player preference to always show). A player must show to win a contested pot. In an all-in runout, all active hands are shown.

8.4 The server evaluates hands ("cards speak"): the best possible hand is always awarded automatically; players never declare.

8.5 Awarding pots: for each pot (main first, then side pots in order), find the best hand among eligible players and pay it. With ties, split equally.

8.6 Odd chips: if a pot does not divide evenly in the smallest chip unit, the leftover unit(s) go one each to the tied winners in clockwise order starting from the first seat left of the button.

8.7 Split is calculated per pot, never on the combined total.

8.8 The hand history must record: final board, shown hands, each pot's amount, winners, amounts, and rake.

---

## 9. Variant differences summary

| | Texas Hold'em | Omaha |
|---|---|---|
| Hole cards | 2 | 4 |
| Cards used | Best 5 of 7, any mix | Exactly 2 hole + exactly 3 board |
| Combinations | 21 | 60 |
| Blinds, button, order of action, betting, side pots, showdown | Identical | Identical |

Note: Omaha is most often played Pot-Limit. This spec uses No-Limit for both as chosen. If Pot-Limit is added later, only the maximum changes: `maxRaiseTo = currentBet + (totalPot + allStreetBets + toCall)`, where the pot includes the caller's own call; preflop, the SB counts as a full BB for some rooms' calculation **[CONFIG]**.

---

## 10. Cash game rules

10.1 Buy-in **[CONFIG]**: minimum (e.g. 40 BB) and maximum (e.g. 100 BB) per table. A buy-in outside the range is rejected.

10.2 Table stakes: only chips on the table at the start of a hand are in play. Chips cannot be added or removed during a hand. A player cannot be forced to fold for lack of chips; they go all-in.

10.3 Top-up / rebuy: allowed only between hands, up to the table maximum. A request made mid-hand is queued and applied after the hand (only up to the max based on the post-hand stack).

10.4 A player with zero chips after a hand is sat out and must rebuy **[CONFIG: within N seconds/hands]** or lose the seat.

10.5 No "going south" / rat-holing: a player may not remove part of their stack and stay seated. **[CONFIG]** A player who leaves and returns to the same table within a time window (e.g. 30–60 minutes) must buy in for at least the amount they left with.

10.6 Sitting out: takes effect from the next hand. A sitting-out player is dealt no cards and posts no blinds; missed blinds are recorded (3.10). **[CONFIG]** A player sitting out longer than a time/orbit limit is removed.

10.7 Leaving: a player may leave any time. If they leave mid-hand, their hand is folded (or checked/folded) when action reaches them; if they are all-in, the hand plays out and winnings are credited to them. Chips already bet stay in the pot.

10.8 Joining mid-hand: the player is seated but waits for the next hand (and rule 3.9).

10.9 Seat changes only between hands.

10.10 Rake **[CONFIG, default off]**: a percentage of each pot with a cap; "no flop, no drop" (no rake if the hand ends preflop); calculated on the pot excluding uncalled bets; rounded down to the smallest unit; taken proportionally from each pot or from the main pot first; chips conservation must include rake.

---

## 11. Timing, disconnects and concurrency

11.1 Each decision has a time limit **[CONFIG]**, optionally plus a time bank. On timeout: check if checking is legal, otherwise fold. Timed-out players are set to sit out from the next hand **[CONFIG]**.

11.2 Disconnected player: same as timeout when action reaches them. If already all-in, they stay in the hand and are eligible for their pots. On reconnect, the full current state is resent (own hole cards, board, pots, stacks, whose turn, time left).

11.3 Pre-selected actions ("check/fold", "call 200") are cancelled if the amount to call changes before the player's turn. "Call any" is the only pre-action that survives a bet change.

11.4 Every action must carry the hand id and an action sequence number; stale, duplicate or out-of-turn messages are rejected idempotently. Process actions for a table strictly one at a time (single-threaded per table or locked).

11.5 Server crash mid-hand **[CONFIG]**: either restore the hand from persisted state, or cancel the hand and return all contributions to the players.

---

## 12. Engine invariants (assert these in code and tests)

1. Chip conservation: sum of all stacks + all pots + street bets + rake is constant within a hand, and equals the pre-hand total of stacks.
2. No stack or pot is ever negative. All amounts are integers.
3. No card is dealt twice; cards dealt + remaining deck = 52.
4. Exactly one player is "to act" at any time during a betting round, and that player is active, not all-in and has chips.
5. Sum of all pots at showdown = sum of all contributions − returned uncalled bets.
6. A player never wins more from any opponent than that player contributed.
7. Folded players never appear in a pot's eligible list.
8. A betting round always terminates (no infinite loops when all players are all-in or one player remains).
9. The BB never falls on the same player in two consecutive hands (unless heads-up rotation rules require otherwise — in heads-up, players alternate).
10. Omaha evaluation always uses exactly 2 hole cards.

---

## 13. Edge-case checklist

**Blinds and button**
- [ ] Heads-up: button is SB, acts first preflop, last postflop.
- [ ] 3 → 2 players and 2 → 3 players transitions.
- [ ] SB player busts: next hand has dead button or correct rotation per 3.5.
- [ ] BB player busts: next hand has dead small blind.
- [ ] Player between button and blinds joins: not dealt in until button passes.
- [ ] Returning player owes missed blinds (BB live + SB dead).
- [ ] SB short all-in; BB short all-in; both blinds all-in; one blind all-in and everyone else folds.
- [ ] Only two players, both all-in from blinds: straight to runout.

**Betting**
- [ ] Limped pot: BB gets option to check or raise; round does not end early.
- [ ] SB completes, BB checks → flop.
- [ ] Everyone folds to BB: BB wins blinds, no cards shown, no flop, no rake.
- [ ] Min raise preflop is to 2 BB; min re-raise equals previous raise increment.
- [ ] Raise below minimum rejected unless all-in.
- [ ] Incomplete all-in raise does not reopen betting for players who already acted.
- [ ] Incomplete all-in raise does allow players who have not acted to raise; min raise-to = all-in amount + last full raise size.
- [ ] Two incomplete all-ins that together equal a full raise reopen betting.
- [ ] All-in call for less than the bet creates a side pot.
- [ ] Opening all-in for less than 1 BB postflop.
- [ ] Player facing a bet with stack exactly equal to the call: call all-in, no raise option.
- [ ] Player with stack between call and min raise: options are fold, call, or all-in (incomplete raise).
- [ ] Everyone checks every street to showdown.
- [ ] Bet, everyone folds: uncalled bet returned, bettor wins rest, no showdown.
- [ ] Bet called by an all-in for less, others fold: excess returned to bettor.
- [ ] One player with chips vs. all-in opponents: no further action prompts; board runs out.
- [ ] All players all-in preflop: flop, turn, river dealt with no betting.
- [ ] Player folds out of turn / acts twice / sends stale action: rejected.

**Pots**
- [ ] Three or more all-ins at different stack sizes: correct number of pots and eligibility.
- [ ] Folded player's chips counted in correct pots (capped at each level).
- [ ] All-in short stack wins main pot, bigger stack wins side pot.
- [ ] Short stack and big stack tie for the main pot; side pot goes to the big stack alone.
- [ ] Three-way tie with odd chips: leftover goes clockwise from left of button.
- [ ] Side pot whose only eligible player remains is awarded without comparison.
- [ ] Two all-in players with identical contributions: pots merged, not duplicated.

**Hand evaluation (both variants)**
- [ ] Wheel A-2-3-4-5 is a straight, loses to 2-3-4-5-6; Q-K-A-2-3 is not a straight.
- [ ] Steel wheel (A-5 straight flush) ranks below 6-high straight flush.
- [ ] Flush vs flush decided by highest differing card across all five.
- [ ] Full house vs full house: trips rank first, then pair.
- [ ] Two pair vs two pair: top pair, second pair, kicker.
- [ ] Kicker decides pair vs same pair; fifth card can decide.
- [ ] Identical five-card hands in different suits split.
- [ ] Hold'em: board plays (e.g. royal flush or straight on board) → all remaining split.
- [ ] Hold'em: 7 cards containing 3 pairs → best two pair + best kicker (kicker may come from the third pair).
- [ ] Hold'em: 7 cards with two sets of trips → full house (higher trips full of lower).
- [ ] Hold'em: 6 or 7 cards of one suit → best five of that suit.
- [ ] Hold'em: counterfeited kicker (both players' kickers lower than the board) → split.
- [ ] Omaha: every trap in 7.6.

**Cash game / session**
- [ ] Top-up request mid-hand applies only after the hand, capped at table max.
- [ ] Player busts: no cards next hand; seat handling per 10.4.
- [ ] Player leaves mid-hand while all-in: still wins their share.
- [ ] Player disconnects on their turn: timeout → check or fold.
- [ ] Table drops to one player: no hand starts; the game resumes when a second player is ready.
- [ ] Player sits out during a hand: finishes the current hand first.

---

## 14. Required test scenarios (with expected results)

Unless stated otherwise, blinds are 50/100 and every stack is 10,000.

**T1 — Heads-up order.** Players A (button) and B. Expected: A posts 50, B posts 100. Preflop A acts first. Flop: B acts first, A last.

**T2 — BB option.** 3 players. BTN calls 100, SB calls (adds 50), BB to act. Expected: BB may check or raise; if BB checks, flop is dealt with pot 300.

**T3 — Min raise.** UTG raises to 250 (increment 150). Next player tries to raise to 350 → rejected; raise to 400 → accepted. After 400, min re-raise is to 550.

**T4 — Incomplete raise, no reopen.** Flop, pot 300. A bets 100. B (stack 150) goes all-in 150. C calls 150. Expected: A's options are fold or call 50 only. Raise is rejected.

**T5 — Incomplete raise, unacted player may raise.** Same as T4 but C raises. Expected: min raise-to is 250; a raise to 250 is accepted and now A may fold, call, or re-raise (min to 350).

**T6 — Cumulative short all-ins reopen.** Flop. A bets 100. B all-in 160. C all-in 220. Action on A: increase faced = 120 ≥ 100. Expected: A may raise; min raise-to is 320.

**T7 — Three-way side pots.** Preflop all-in: A stack 1,000, B stack 3,000, C stack 5,000 (C covers). All call all-in. Expected: 2,000 returned to C as uncalled. Main pot 3,000 (A, B, C). Side pot 4,000 (B, C). If A has the best hand, B second: A wins 3,000, B wins 4,000, C ends with 2,000.

**T8 — Folded money in pots.** Use the example in 6.4. Expected pots 480 / 600 / 400 with eligibility as listed.

**T9 — Uncalled bet.** River, pot 1,000. A bets 2,000, B folds. Expected: A receives 2,000 back plus the 1,000 pot; A's cards are not shown; rake (if any) is on 1,000 only.

**T10 — Short BB.** BB has 60 and posts all-in. UTG wants to call. Expected: call amount is 100; min raise is to 200. If everyone else folds and only SB (50 posted) calls 100, then 40 is returned to SB; pot is 120 contested by SB and BB.

**T11 — Split with odd chip.** Smallest chip unit is 25, pot is 125, two winners. Expected: 50 each, and the remaining 25 goes to the winner closest clockwise from the button.

**T12 — Wheel.** Board 2♣ 3♦ 4♥ 9♠ K♠. A holds A♠ 5♦ (wheel), B holds 5♣ 6♣ (6-high straight). Expected: B wins.

**T13 — Board plays (Hold'em).** Board A♠ K♠ Q♠ J♠ T♠. Expected: all active players split regardless of hole cards.

**T14 — Kicker (Hold'em).** Board A♣ 8♦ 8♥ 4♠ 2♣. A holds A♦ K♣, B holds A♥ Q♦. Expected: A wins (aces and eights, K kicker).

**T15 — Counterfeit split (Hold'em).** Board A♣ A♦ K♥ K♠ Q♣. A holds 7♦ 2♣, B holds J♥ 3♦. Expected: split (both play A-A-K-K-Q).

**T16 — Omaha flush trap.** Board A♥ 9♥ 6♥ 3♥ K♣. A holds K♥ K♦ 8♣ 7♣ (only one heart → no flush; has three kings). B holds 5♥ 4♥ J♠ T♠ (flush A-9-6-5-4 using two hearts). Expected: B wins.

**T17 — Omaha quads on board.** Board 9♣ 9♦ 9♥ 9♠ 2♣. A holds A♠ A♦ 5♣ 6♣, B holds K♠ K♦ Q♠ J♠. Expected: A wins with 9-9-9-A-A (full house); nobody has quads.

**T18 — Omaha board straight.** Board 5♣ 6♦ 7♥ 8♠ 9♣. A holds A♠ A♦ K♣ K♦ (no straight possible → pair of aces). B holds T♦ J♣ 2♥ 2♠ (uses T-J with 7-8-9 → J-high straight). Expected: B wins.

**T19 — Omaha trips in hand.** A holds Q♠ Q♦ Q♥ 2♣ on board K♣ 8♦ 4♥ 3♠ 7♣. Expected: A has only one pair of queens (kicker structure Q-Q-K-8-7).

**T20 — All-in runout.** Preflop: A all-in 10,000, B calls, others fold. Expected: no betting prompts on flop/turn/river; five board cards dealt; hands shown; pot awarded.

**T21 — Dead button.** 4 players in seats 1–4; hand N: BTN seat 1, SB seat 2, BB seat 3. Seat 2 busts. Hand N+1 (dead button rule): BB seat 4, SB seat 3, button on empty seat 2 (dead); first to act preflop is seat 1.

**T22 — Chip conservation fuzz.** Run 100,000 random hands with random legal actions and random stacks (including very short stacks) for both variants. Expected: all invariants in section 12 hold in every hand, and no hand hangs.

**T23 — Evaluator cross-check.** For 100,000 random Hold'em 7-card sets and Omaha 4+5 sets, compare the evaluator against a brute-force reference that enumerates every legal 5-card combination. Expected: identical results.

---

## 15. Out of scope (confirm before implementing)

Tournaments (rising blinds, antes, eliminations, table balancing), Pot-Limit and Fixed-Limit betting, Omaha Hi-Lo, 5/6-card Omaha, straddles, run-it-twice, bomb pots, insurance, and jackpots.
