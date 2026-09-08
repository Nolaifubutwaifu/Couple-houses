# NEST

A shared home for two people, built as a diorama under a glass dome.

Couples play small games to earn hearts, spend them building and decorating the
home inside the dome, then publish it to a street where every home is ranked by
charm. The weather inside the dome follows how consistently the two of them show
up for each other, which is the thing nothing else in this space does.

Open `index.html` in any browser. No build step, no install, no network needed.

## What this is

A working prototype of the art bible, not a mock. Every rule in that document
that can be enforced in code is enforced in code, and the parts that cannot be
enforced are visible on screen so they can be judged.

- **Held, not entered.** Orthographic camera, tilted 32 degrees, no roll. Drag
  the dome to turn it, flick it to spin, pinch or scroll to zoom. You are always
  looking at a small object from outside, and now you can pick it up.
- **Four layers.** Ceramic plinth carrying the couple's names, a mounded terrain
  disc, the home the player built with walls at half height, and a glass dome
  with a fresnel rim holding the weather.
- **Soft everywhere.** One matte toon material across the whole product, a four
  step light ramp rather than cel outlines, zero metallic, and soft contact
  shadows only. Every visible edge is bevelled because there is exactly one
  primitive, `bevelBox`, and it cannot produce a raw corner.
- **One world.** All 16 master palette colours are declared once in
  `src/palette.js`. Asking for a colour that is not in that table throws.

## The signature

The dome expresses consistency through light and weather, never through a number
stuck on the home.

| State | When | What changes |
| --- | --- | --- |
| New | first days | pale morning sky, clear glass, fresh ground |
| Steady | 3 day streak | warm midday, motes drifting, flowers coming in |
| Strong | 10 day streak | golden late afternoon, light shafts, dense growth |
| Resting | nothing for 3 days | cool overcast, soft haze, muted but still healthy |

Resting is deliberately pretty. It is desaturated and hazy, never grey or
wilted, and the copy reads "a quiet week", because nobody opens an app that
tells them off. Seasonal overrides (blossom, clear, autumn, snow) sit on top and
follow the real calendar month.

## Earning

| Game | Cap | How it pays |
| --- | --- | --- |
| Today's question | once a day | one question, both partners answer, then both answers are revealed. 30 coins plus 3 a day of streak capped at 60, and a bond. This is the only thing that grows the streak. |
| Trivia duel | once a day | one answers 6 questions about themselves, passes the phone, the other guesses. 12 coins a match, 20 for a sweep |
| Memory match | twice a day | solo pairs, played with the actual props. 30 coins at par, floor of 8 |

**The caps are the point.** With no limits the whole catalogue could be bought
in about forty minutes of repeating the duel, and a home you can finish in an
afternoon records nothing. The ceiling is now 242 coins on a perfect day, and
there is no way to exceed it.

Six rooms unlock at 700, 1,400, 2,200, 3,200 and 4,300 coins, and the dome
physically grows to fit whatever has been built. Charm summed over placed props
is the public score, and the mementos (photo wall, heart statue, framed vows,
the ring) are where it really moves, so the street ranks time and effort rather
than tidiness.

**The curve.** The catalogue is 49 props and 6 rooms, 49,480 coins in total. An
engaged couple doing the ritual daily, one duel and two memory rounds earns
about 36,000 coins in six months, which is every room and roughly 41 of the 49
props. The 8 left over are the point: if everyone can afford everything, every
house on the street is identical and the showcase means nothing. Real variety
wants a catalogue two or three times this size, which is content production and
the honest long pole.

## Section 16 as code

A checklist read once is a checklist nobody follows, so the asset review runs in
the app. Tap **QA** on the dome. For every prop in the catalogue it checks:

- every colour resolves to a master palette entry
- at most one accent colour
- triangle count inside the budget for its asset class
- reads as a silhouette at 64 pixels, and reads at all eight sampled yaws
- a distinct silhouette from every other prop, compared by shape at a common
  scale with proportion preserved, since a flat rug and a tall wardrobe are both
  solid rectangles once a crop is stretched to a square
- silhouette distinct from every other prop, compared by shape rather than size

All 49 props pass at eight yaws, with no silhouette collisions. Two are flagged
as thin for their class rather than failing:
the warm lamp at 144 triangles and the wardrobe at 1594. That is a finding about
the bible's floors, not about the props. The triangle ranges in section 6 assume
two bevel segments everywhere; parts under 85mm here use a single segment, which
is invisible at any real zoom and cuts the catalogue from roughly 90,000
triangles to 43,000. A fully furnished six room home renders at about 96,000 against the section 6
budget of 100,000, which is tight enough to be a finding in itself: at this
catalogue size the budget and the room count are in tension, and the real build
will want instancing or another pass at the bevel segments.

## Where the prototype knowingly diverges

Honest list, so nobody mistakes a shortcut for a decision.

- **Yaw is free, against section 4.** The bible says yaw "snaps in 90 degree
  increments only" and that there is "no free camera", so that every screenshot
  a player takes is composed. That was overridden deliberately: the dome now
  follows your finger, a flick carries momentum, and it rests wherever you let
  go. Tilt stays locked at 32 degrees and roll is still impossible, so the two
  rules doing the most work survive. The arrows remain and are more useful than
  before, taking you to the next quarter turn from any resting angle, which is
  still the fastest way to a framed shot. The consequence was handled rather
  than ignored: the asset review now samples eight yaws instead of four,
  because props are seen from in between. All 32 still pass. As it turns out
  the three quarter angles read better than the four stops did.

- **Post processing is faked.** Bloom, vignette and the warm grade are CSS
  overlay layers, because a real `EffectComposer` is not in the UMD build. In
  Unity these are proper passes.
- **Lighting is realtime, not baked.** Three lights and no shadow casting, which
  approximates the baked look cheaply. Section 8 wants lightmaps.
- **No avatars.** Section 12 makes them optional for MVP and they were left out
  so the effort went into props and motion.
- **The street is local.** Six seeded neighbours ship with the app. Real couples
  need the backend.

## Open questions from section 17, answered here

- **Walls fade** as the camera swings behind them, on an opacity lerp keyed to
  yaw. Fading needs no extra geometry and no hinge animation.
- **The dome is optically neutral.** Distortion is prettier and costs a render
  target; not worth it at this stage.

## Onboarding, authentication and pairing

Built to the onboarding spec. The flow exists to get two people into one nest,
so the invite is the conversion event and the solo state is deliberately inert.

**Try the pairing for real.** Open the page, go through to the invite code, then
open a second browser tab on the same page with `?j=YOURCODE` on the end. The
second tab is a second person: tabs share the store but not the session, so they
authenticate separately, claim, confirm each other, and watch the same ceremony.
That is the actual two person handshake, not a mock of it.

**The flow.** Cold open onto a live demo nest with no interface for 1.2 seconds,
three intro beats over camera moves (300ms in, 2.6s hold, 250ms out, skippable
in one tap and never replayed), auth, name and birthday, the pair fork, the
invite or the code, mutual confirm, the ceremony, the first ritual, the first
placement, then the notification primer. Cold install to the share sheet
measures about 20 seconds against the spec's 45.

**What is enforced rather than merely drawn**

- Codes are six characters from the spec's alphabet, no I L O 0 or 1, single
  use, locked to the first claimant, seven day expiry, and regenerating revokes
  the previous one.
- Joining is never done by code alone. Both people confirm.
- A nest can never hold three active members. The check re-reads the committed
  store, so a second tab racing the same code loses.
- Under sixteen cannot create or join, and the block has no retry loop back to
  the date field, because a retry loop just teaches the workaround.
- A solo user earns nothing and places nothing. That is structural, since the
  main app is only reachable through a completed pairing, and there is a second
  guard in `earn`, `spend` and the placement handlers so a future screen cannot
  route around it.
- The waiting state allows exactly two changes, the base material and the
  terrain, neither of which touches the interior.
- Nudges fire at 24 hours, 72 hours and 7 days, stop at three, and only ever
  reach the founder. Nothing is ever sent to the person who has not opted in.
- The ceremony flag goes up at pairing and only comes down when the sequence has
  played all the way through, so a client that was offline or died halfway gets
  the whole thing next launch and never half of it.

**What cannot exist in a page, and what stands in for it**

Honest list, because these are the parts a real build has to do properly.

- **Apple and Google sign in.** No OAuth can run here. A stand in sheet asks for
  an account handle and the same handle restores the same identity, which is
  what makes the reinstall case testable. The `POST /auth/session` shape is the
  real one.
- **Email codes.** Nothing can send mail from a page, so the six digit code the
  backend generated is shown on screen, clearly marked. Expiry and the thirty
  second resend are real.
- **Push.** The primer is real and calls the browser's permission prompt.
  Nudges fall back to an in app notice when permission is not granted. There is
  no device token and no server.
- **Deferred deep links.** `?j=CODE` is read, stored, and read back after
  authentication, which delivers a linked user straight to confirm with no
  manual code entry. What is missing is the app store round trip.
- **Realtime.** A BroadcastChannel between tabs, with a storage event fallback.
  A real build needs a socket per nest.
- **The database constraint.** Enforced in the store layer here. In production
  the two active membership rule belongs in the schema, not in application code.

**The funnel.** Every event in the spec's list fires, exactly as named, and
nothing else can: firing an event not on the list logs a warning instead. Tap
the **%** control on the dome for the funnel, the paired activation rate and the
invite latency.

**Endpoints.** `src/api.js` implements the spec's routes against the local store
behind one `Api.call(method, path, body)`. Calls carry real latency so every
screen has to have something to show while it waits, and nothing blocks longer
than about 220ms.

## Leaving, deletion and moderation

The decisions are recorded in `docs/joint-data-policy.md`. The short version:

**A nest freezes rather than transferring or dying.** When either partner
leaves or deletes their account, the home becomes read only for both. Nothing
is removed, neither can change it again, both can still look at it, and both
are free to start again. It is the only arrangement where neither person can
act unilaterally against the other.

**Personal data goes, joint output stays.** Deleting erases the leaver's name,
birthday, identity and their own answers, and removes their name from the nest.
The furniture and the streak remain, because the other person made those too.
The test for which side a field falls on is whether one person could have
produced it alone.

**Account deletion is in the app**, under the settings control on the dome,
which is what Guideline 5.1.1(v) has required since 2022. It is immediate,
irreversible and confirmed by typing the word rather than tapping a button.

**The street has the five things Guideline 1.2 asks for.** A filter that runs
at publish time and rejects slurs, links, emails and phone numbers with a
reason; a report action with named reasons that hides the home from you
straight away; a reversible block; and a published contact on the street
itself. The fifth, acting within a day, is a commitment rather than code, and
the report queue a moderator would work is there.

## The two seams

**Storage.** Nothing outside `LocalStore` touches `localStorage`. Swapping in a
real backend means one object with the same four methods:

```js
const Store = { load(), save(state), listShowcase(state), likeHouse(state, id) };
```

State carries a `schemaVersion` and migrates forward. Every read and write is
wrapped, so the app still boots in a private window or with site data blocked.

**The renderer.** `src/diorama.js` owns everything about how a home looks and
moves. The rest of the app hands it a house and a dome state and never touches a
mesh. Balance numbers all sit in one `BALANCE` object in `src/games.js`.

## Files

- `index.html` — shell and interface, section 13
- `src/palette.js` — the master palette, dome states, seasons
- `src/props.js` — `bevelBox` and all 32 prop builders
- `src/diorama.js` — the four layers, camera, lighting, motion, offscreen renders
- `src/bible.js` — the section 16 checks
- `src/api.js` — the data model, the endpoints, invite codes, realtime
- `src/analytics.js` — the funnel, and the only event names that exist
- `src/onboarding.js` — the cold open through to the notification primer
- `src/games.js` — the three games and the balance table
- `src/app.js` — the app once two people are in it
- `vendor/three.min.js` — pinned r149, so this runs with no network
- `tools/artifact_build.mjs` — inlines the sources and points three.js at a CDN
  for publishing as a hosted page. `node tools/artifact_build.mjs`

## Delivery targets for the real build

Unity with URP, models in Blender, everything baked and atlased, FBX with Y up
in metres and origins at floor contact, LOD0 only, under 100k triangles a lot.
This prototype exists to settle the look and the feel before any of that is
committed to.
