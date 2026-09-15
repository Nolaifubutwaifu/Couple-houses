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
| Today's question | once a day | one question, the same one on both phones. You answer your own row, their answer stays hidden until yours is in, then both are revealed together. 30 coins plus 3 a day of streak capped at 60, and a bond. This is the only thing that grows the streak. |
| Trivia duel | once a day | one answers 6 questions about themselves on their phone, the other guesses them on theirs. 9 coins a match, no sweep bonus. The round lives in the shared document and each of you only ever sees your own half of it, so it cannot be played alone |
| Memory match | twice a day | solo pairs, played with the actual props. 30 coins at par, floor of 8 |

**The caps are the point.** With no limits the whole catalogue could be bought
in about forty minutes of repeating the duel, and a home you can finish in an
afternoon records nothing. The ceiling is now 204 coins on a perfect day, and
there is no way to exceed it.

Six rooms unlock at 700, 1,400, 2,200, 3,200 and 4,300 coins, and the dome
physically grows to fit whatever has been built. Charm summed over placed props
is the public score, and the mementos (photo wall, heart statue, framed vows,
the ring) are where it really moves, so the street ranks time and effort rather
than tidiness.

**The curve.** The catalogue is 50 props and 6 rooms, 49,740 coins in total. An
engaged couple doing the ritual daily, one duel and two memory rounds earns
about 29,000 coins in six months, which is every room and roughly 35 of the 50
props. The 15 left over are the point: if everyone can afford everything, every
house on the street is identical and the showcase means nothing. Real variety
wants a catalogue two or three times this size, which is content production and
the honest long pole.

## Section 16 as code

A checklist read once is a checklist nobody follows, so the asset review runs in
the app. Open it with `#dev` on the URL, then tap **QA** on the dome. It is off
by default because it is for us, not for a couple looking at their living room.
For every prop in the catalogue it checks:

- every colour resolves to a master palette entry
- at most one accent colour
- triangle count inside the budget for its asset class
- reads as a silhouette at 64 pixels, and reads at all eight sampled yaws
- a distinct silhouette from every other prop, compared by shape at a common
  scale with proportion preserved, since a flat rug and a tall wardrobe are both
  solid rectangles once a crop is stretched to a square
- silhouette distinct from every other prop, compared by shape rather than size

All 50 props pass at eight yaws, with no silhouette collisions. Two are flagged
as thin for their class rather than failing:
the warm lamp at 144 triangles and the wardrobe at 1594. That is a finding about
the bible's floors, not about the props. The triangle ranges in section 6 assume
two bevel segments everywhere; parts under 85mm here use a single segment, which
is invisible at any real zoom and cuts the catalogue by about a third, to
73,000 triangles measured over all 50 props. A fully furnished six room home renders at about 96,000 against the section 6
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
so the invite is the conversion event. The solo state earns nothing and owns
nothing, but it is no longer empty: a founder waiting on their own can look
through the whole workshop and sketch out where things go, which is something
to send the person they are trying to persuade and something to come back to.

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
- A solo user earns nothing, buys nothing and places nothing. That is
  structural, since the main app is only reachable through a completed pairing,
  and there is a second guard in `earn`, `spend` and the placement handlers so a
  future screen cannot route around it.
- What a solo founder can do is plan. The workshop is readable with no button
  on it to press, and the first room can be sketched out as positions rather
  than purchases. The sketch is drawn into the dome as outlines, it survives a
  reload, and when the partner arrives they are told whose it is and given one
  tap to throw it out.
- The waiting state allows exactly two changes to the nest itself, the base
  material and the terrain, neither of which touches the interior.
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
- **Email codes.** With no backend, nothing can send mail from a page, so the
  six digit code is shown on screen, clearly marked. With one, the code goes to
  a real inbox and the on screen note disappears. Expiry and the thirty second
  resend are real either way.
- **Push.** The primer is real and calls the browser's permission prompt.
  Nudges fall back to an in app notice when permission is not granted. There is
  no device token and no server.
- **Deferred deep links.** `?j=CODE` is read, stored, and read back after
  authentication, which delivers a linked user straight to confirm with no
  manual code entry. What is missing is the app store round trip.
- **Realtime.** With no backend, a BroadcastChannel between tabs and a storage
  event fallback. With one, a Supabase broadcast channel per nest and a poll
  that carries the transitions which must not be missed.
- **The database constraint.** Enforced in the store layer with no backend. In
  Postgres it is three partial unique indexes, which is where it belongs.

**The funnel.** Every event in the spec's list fires, exactly as named, and
nothing else can: firing an event not on the list logs a warning instead. Tap
the **%** control on the dome for the funnel, the paired activation rate and the
invite latency.

**Endpoints.** `src/api.js` implements the spec's routes against the local store
behind one `Api.call(method, path, body)`. Calls carry real latency so every
screen has to have something to show while it waits, and nothing blocks longer
than about 220ms.

## The backend

Two phones cannot pair through `localStorage`, so there is a real database
behind this now: Postgres on Supabase, with the schema in `docs/backend.sql`.

`src/backend.js` implements the same `Api.call(method, path, body)` surface
against it. Nothing above it changed, because the endpoints were written to be
a transport in the first place. It is not a rewrite, it is the other half of a
seam that already existed.

**It turns itself on or stays out of the way.** At boot it probes the database
once. If that fails, for any reason at all, the local store runs exactly as it
did before and nothing else in the app notices. A blocked sandbox, an offline
phone, a paused project and no configuration at all are the same case, and the
same fallback covers all four. `window.NEST_CONFIG = { url:"" }` forces it off,
which is what the published artifact build does.

**It switches itself on when there is a way in.** The probe reads the
project's own auth settings, and a database nobody can sign in to is worse
than no database, because the failure lands on a person at the sign in screen
instead of quietly at boot. So the sign in screen offers what the project
actually has enabled, and if that list is empty the local store runs. Enabling
a provider is all it takes; no deploy follows it.

**Guest accounts, which is what the live site runs on.** "Start a nest" makes
a real Supabase account with no email attached. It pairs, it earns, it owns a
nest, survives a reload, and can be given an email later without losing any of
that. What it cannot survive is a cleared browser, which is the whole of the
trade. `tools/guest-pair-test.js` drives the path a couple actually takes: two
browsers, two guests, nothing typed but two names and two birthdays, through
founding, sharing, claiming, confirming, and both of them furnishing one house
while watching the other's changes arrive.

**What lives where.** Identity and email codes are Supabase Auth. The nest, the
memberships, the invites and the reports are tables. The game itself is one
`jsonb` document on the nest row, so both people read and write the same thing
and a `rev` counter makes a stale write visible.

**Rules are in the database, not in the client.** This is the part that
mattered most, and testing found two holes that the local prototype could not
have had, because there every write went through a route:

- With an insert policy of "you may only add yourself", anyone holding a nest
  id could add themselves to somebody else's nest as an active partner.
- With an update policy of "you may change your own membership", anyone who had
  claimed a code could promote themselves past the founder's confirmation,
  which is the single rule the whole product rests on.

Both are closed by having no insert or update policy on memberships or invites
at all. Joining is `claim_invite` then `confirm_invite`, both of which are
`security definer` functions, and there is no other way in. `tools/pairing-test.js`
asserts a signed in stranger can read no nest, no membership, no invite, no
report and no profile but their own, and can neither write to a nest nor join
one.

**What email still needs**, all settings on the Supabase project rather than
code, which is why `emailReady` in `src/backend.js` is false and email is not
offered:

1. **`{{ .Token }}` in the email templates.** The stock Magic Link and Confirm
   Signup templates send a link, not a six digit code, and this product asks
   for a code. Both templates need the token in them.
2. **Custom SMTP.** The built in mailer only delivers to the project's own
   team and is rate limited to a couple of messages an hour. Adding a second
   address to the organisation is enough to test with; strangers need real
   SMTP.
3. **Password sign in off.** The product has no passwords. Leaving the
   password grant enabled is a login path nothing in the app uses, and it is
   the only reason the project's advisor list mentions leaked password
   protection at all.

**Four bugs the screens hid from the endpoints.** Every suite above drove
`Api.call` directly, which asks whether the database would answer if asked. It
always would. What none of them asked was whether the screens bother to ask,
and they did not: a founder holding a code sat there while their partner
waited, because that screen only listened for a realtime message that, on the
claiming side, had no channel to go out on. `tools/screen-pair-test.js` drives
real taps on real buttons and polls nothing itself, which is the only shape of
test that could have caught it. It then found three more:

- the partner never learned they had been let in, because `afterPair` killed
  its own poll on its first line and could throw before it navigated, leaving
  the screen with nothing left running to try again
- being let in took thirty seconds, because `/nests/mine` was six sequential
  round trips and the screen fired it every two and a half seconds without
  waiting for the last one. It is now one round trip, `nest_snapshot`, and a
  tick that is still in flight does not start another. Seven seconds through a
  deliberately slow test rig, and a poll interval on a real connection
- the poll accepted any revision that merely differed from the one it held,
  so a fetch that left before a local save and arrived after it wrote the
  older document over the newer one. In the product that is your partner's
  furniture disappearing seconds after they place it. Strictly newer now, and
  a poll that overlaps a write stands aside

**One house, and the revisions that make it one.** Two clients each counting
their own revisions is not a scheme, it is two documents wearing the same
name: both start at nothing, both call their first save revision one, and
from then on neither ever looks newer than the other, so the two rooms drift
apart and nothing brings them back. That is what "we are in the same room and
I cannot see your sofa" actually was. The database issues the revision now,
and a save that is not based on the current one is refused rather than
allowed to land on top. A refused save is rebased: `mergeGame` in
`src/app.js` takes what this device started from, what it has now, and what is
really stored, and moves each field by the amount this device moved it, so
coins add up, furniture is added and removed by identity rather than replaced
wholesale, and a room either of them paid for stays unlocked. Nothing
overwrites a field it did not change.

**One pair of hands at a time.** Two people dragging furniture around the same
room at once is not collaboration, it is a fight the loser does not know they
are in. The build screen is a turn: taking it claims a short hold in the
database, the other person sees "Ada is arranging the room" and watches the
dome update as it happens, and the hold expires by itself so a partner who
puts their phone down does not lock the other out of their own house.

**What is still not right.** The game document is client authoritative: a
determined player can write themselves any number of hearts. That is fine for
a prototype where the only thing to win is your own house, and it is the next
thing to move server side if the street ever ranks on anything earned.

**Two devices, checked rather than assumed.** `node tools/pairing-test.js`
drives two isolated browsers through founding, claiming, confirming, naming,
spending, publishing, reporting, leaving and deleting against the live
database: 51 assertions, including that each person sees the other's spending
without touching the screen, that a frozen nest is readable by both and
writable by neither, and that deleting one account takes that name off the nest
and leaves the house standing. `node tools/guest-pair-test.js` adds the 13 that
matter most, since they are the ones a real couple performs. `node
tools/local-test.js` runs the same flow with the backend switched off, so the
fallback is a tested path rather than a hope.

All of them need a server on 8811 serving this directory, and `node
tools/serve.js` is it. It serves the files, caches the Supabase client library
at `/_lib/supabase.js`, and forwards `/auth`, `/rest`, `/realtime`, `/storage`,
`/functions` and `/pg` to the project named in `src/backend.js`, websocket
included. That is why the database suites set `url: location.origin`: the page
makes no cross origin request and opens no TLS connection of its own, so the
same four suites run on a laptop, in CI, and inside a sandbox whose egress goes
through a proxy. Point it somewhere else with `NEST_SUPABASE_URL`. It holds no
key: whatever the page sends is what goes upstream.

`node tools/parity-test.js` needs nothing at all. It reads both route tables
and every `Api.call` in the app and fails if the two transports have drifted,
which they had: `GET /invites/{code}` was in `src/api.js` and not in
`src/backend.js`, so the invite link named the person who sent it on the local
store and quietly named nobody on the database. The four client suites
(`handoff`, `entry`, `two-phones`, `solo`) run entirely on the local store, so
they hold with no network at all.

**Running them on your own machine.** The suites used to name a Playwright
path inside one sandbox, so nowhere else could start them. They now resolve
Playwright from `node_modules` through `tools/pw.js`:

```bash
npm install
npx playwright install chromium
npm test                         # every suite, starting tools/serve.js if needed
node tools/run-all.js local solo # just the ones whose names match
```

`NEST_PLAYWRIGHT` and `NEST_CHROMIUM` still override both. `tools/merge-test.js`
needs no browser and no server: it loads `src/app.js` into a bare context and
checks the three way merge directly, which is where item duplication lived.

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

**Storage.** Nothing outside `Store` touches persistence, and it is four
methods wide:

```js
const Store = { load(), save(state), listShowcase(state), likeHouse(state, id) };
```

Underneath it, every request is one call:

```js
Api.call(method, path, body)   // and Api.backend decides where it lands
```

That seam is the reason the database went in without a screen moving. State
carries a `schemaVersion` and migrates forward. Every read and write is
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
- `src/backend.js` — the same endpoints against Postgres, and the probe that
  decides which of the two is running
- `src/analytics.js` — the funnel, and the only event names that exist
- `src/onboarding.js` — the cold open through to the notification primer
- `src/games.js` — the three games and the balance table
- `src/app.js` — the app once two people are in it
- `vendor/three.min.js` — pinned r149, so this runs with no network
- `docs/backend.sql` — the whole database in one runnable file
- `tools/artifact_build.mjs` — inlines the sources and points three.js at a CDN
  for publishing as a hosted page. `node tools/artifact_build.mjs`
- `tools/run-all.js` — every suite, two at a time, with one summary
- `tools/room-sync-test.js` — both people already in the room, which is the
  case the others all missed
- `tools/screen-pair-test.js` — real taps on real buttons, the harness polls
  nothing, which is what catches a screen that never asks
- `tools/guest-pair-test.js` — the path a couple takes, two guests and no
  test accounts at all
- `tools/pairing-test.js` — two browsers, one database, every rule and every
  thing a stranger must not be able to reach
- `tools/local-test.js` — the same flow with no backend at all
- `tools/handoff-test.js` — the handover from onboarding to the app: the
  tutorial borrows the next tap and gives it back, the first ritual asks the
  day's question, and a save carrying repeated ids is repaired on load
- `tools/entry-test.js` — the way in: the age gate decides before it writes and
  keeps nothing it blocks, the block screen is not a brick, and an invite link
  says who sent it
- `tools/two-phones-test.js` — the ritual and the duel across two phones: you
  cannot play your partner's half of either, and their half reaches their
  screen without anybody reloading
- `tools/solo-test.js` — what a founder can do alone, and the more important
  half, everything they still cannot

## Delivery targets for the real build

Unity with URP, models in Blender, everything baked and atlased, FBX with Y up
in metres and origins at floor contact, LOD0 only, under 100k triangles a lot.
This prototype exists to settle the look and the feel before any of that is
committed to.
