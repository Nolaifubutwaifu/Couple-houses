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

- **Held, not entered.** Orthographic camera, tilted 32 degrees, yaw snapping in
  90 degree steps, three fixed zoom stops, no roll and no free camera. You are
  always looking at a small object from outside.
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

| Game | How it pays |
| --- | --- |
| Daily check in | both partners tap in once a day. 25 hearts plus 5 a day of streak, capped at 100 |
| Trivia duel | one answers 6 questions about themselves, passes the phone, the other guesses. 15 a match, 30 for a sweep |
| Memory match | solo pairs, played with the actual props. 60 hearts at par, floor of 10 |

Rooms unlock at 500, 900 and 1400 hearts, and the dome physically grows to fit
whatever has been built. Charm summed over placed props is the public score, and
the mementos (photo wall, heart statue, framed vows) are where it really moves,
so the street ranks time and effort rather than tidiness.

## Section 16 as code

A checklist read once is a checklist nobody follows, so the asset review runs in
the app. Tap **QA** on the dome. For every prop in the catalogue it checks:

- every colour resolves to a master palette entry
- at most one accent colour
- triangle count inside the budget for its asset class
- reads as a silhouette at 64 pixels, and reads at all four camera yaws
- silhouette distinct from every other prop, compared by shape rather than size

All 32 props pass. Two are flagged as thin for their class rather than failing:
the warm lamp at 144 triangles and the wardrobe at 1594. That is a finding about
the bible's floors, not about the props. The triangle ranges in section 6 assume
two bevel segments everywhere; parts under 85mm here use a single segment, which
is invisible at any real zoom and cuts the catalogue from roughly 90,000
triangles to 43,000. A full four room lot renders at about 53,000 against the
100,000 budget, which leaves real headroom for the Unity build.

## Where the prototype knowingly diverges

Honest list, so nobody mistakes a shortcut for a decision.

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
- `src/games.js` — the three games and the balance table
- `src/app.js` — storage, state, screens
- `vendor/three.min.js` — pinned r149, so this runs with no network
- `tools/artifact_build.mjs` — inlines the sources and points three.js at a CDN
  for publishing as a hosted page. `node tools/artifact_build.mjs`

## Delivery targets for the real build

Unity with URP, models in Blender, everything baked and atlased, FBX with Y up
in metres and origins at floor contact, LOD0 only, under 100k triangles a lot.
This prototype exists to settle the look and the feel before any of that is
committed to.
