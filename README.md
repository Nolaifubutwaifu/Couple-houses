# Couple Houses

A prototype for couples. You play small games together to earn hearts, spend
them building and decorating a shared house, then publish that house to a
public street where it stands as a visible record of the relationship.

Open `index.html` in any browser. No build step, no dependencies, no network
calls. It works on a phone, and it works offline.

## What is in it

**Three ways to earn**

| Game | How it pays |
| --- | --- |
| Daily check in | Both partners tap in once a day. 25 ♥ plus 5 ♥ a day of streak, capped at 100 ♥. Miss a day and the streak resets. |
| Trivia duel | One partner answers 6 questions about themselves, hands the phone over, the other guesses. 15 ♥ a match, 30 ♥ bonus for a clean sweep. |
| Memory match | Solo 4x4 pairs. 60 ♥ at par, down to a floor of 10 ♥ as the moves add up. |

**The house.** A top down grid, one room to start. Buy furniture, tap a piece
to pick it up, tap a tile to put it down, rotate the wide pieces. Kitchen,
bedroom and garden unlock at 500, 900 and 1400 ♥.

**Charm.** Every piece carries a charm value, and the sum is the house's public
score. Mementos (photo wall, heart statue, framed vows) are the expensive,
high charm pieces, so the score reads as time and effort put in rather than
tidiness. Charm is what the street ranks on.

**The street.** Six seeded neighbours ship with the app so the showcase is
populated on day one. Publish your house and it joins the ranking. You can
leave a heart on any of them.

## The two seams

Everything likely to change later is deliberately isolated.

**Storage.** Nothing outside `LocalStore` touches `localStorage`. Swapping in a
real backend means writing one object with the same four methods and pointing
`Store` at it:

```js
const Store = { load(), save(state), listShowcase(state), likeHouse(state, id) };
```

State carries a `schemaVersion` and there is a `migrate()` hook for shape
changes. Every read and write is wrapped, so the app still boots in a private
window or with site data blocked.

**The renderer.** The house is drawn by one function, `renderHouse(container,
house, roomId, opts)`, reading only from `state.house`. The animated Sims style
version replaces that function and the CSS behind it and touches nothing else.
Placement rules live separately in `canPlace()` and `footprint()`, so they
survive the swap.

Balance numbers all sit in one `BALANCE` object at the top of the script, meant
to be retuned once you have actually played it.

## Files

- `index.html` — the whole app. Sections in order: CONFIG, DATA, STORE, STATE,
  HOUSE, GAMES, SCREENS, BOOT.
- `tools/artifact_build.mjs` — strips the document wrapper off `index.html` for
  publishing as a Claude Artifact. `node tools/artifact_build.mjs`.

## Known limits of this pass

The street is local. Your partner on another phone has their own separate save,
and the seeded neighbours are fiction. Real accounts, shared couple state and a
genuinely public showcase all arrive with the backend swap described above.
