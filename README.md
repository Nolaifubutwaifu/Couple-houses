# NEST

A shared home for two people, built as a diorama under a glass dome. A couple
pairs their phones, plays a small daily game together, earns coins, and spends
them building and decorating one house. They can publish it to the street, where
other couples leave hearts. The dome's weather follows how consistently the two
of them show up.

**Live:** https://couple-houses.vercel.app

## How it is built

| Part | What it is |
| --- | --- |
| Client | Plain HTML, CSS and JavaScript with three.js (vendored r149). No build step. |
| Hosting | Vercel, deployed from the default branch on every merge. `vercel.json` gives clean URLs and headers. |
| Database and sign in | Supabase project `nest` (Sydney). Guest accounts, Postgres with row level security, and definer functions for every write that matters. |
| Push | The `push` edge function (`supabase/functions/push`) plus hourly `pg_cron`. |
| Monitoring | `client_errors` and `client_events` tables, and Vercel Web Analytics once enabled. |

If the database cannot be reached, the client falls back to a local store in the
browser. That mode exists for the offline test suites and for development; with
it, two tabs of one browser can pair, but two phones cannot.

### Source map

- `index.html`: shell, interface styles, script order
- `site-config.js`: operator, contact address, dates, ad and CAPTCHA keys, shared by the app and the public pages
- `src/palette.js`, `src/props.js`, `src/diorama.js`: the art. One bevelled primitive, 65 props, the dome, camera, lighting and motion
- `src/bible.js`: the art rules as code (palette, one accent, triangle budgets, distinct silhouettes). Open the app with `#dev` and tap **QA**
- `src/api.js`: the data model and every endpoint against the local store
- `src/backend.js`: the same endpoints against Supabase, plus the sync loop (revisions, three way merge, adopting the server's copy)
- `src/app.js`: the app once two people are in it: screens, economy calls, the street, settings, push
- `src/games.js`: today's question, trivia duel, memory match, and the `BALANCE` table
- `src/onboarding.js`: cold open, sign in, pairing, ceremony, first ritual, first placement
- `src/monitor.js`, `src/analytics.js`: error reporting and the funnel events
- `src/sound.js`: synthesised sound effects (no audio files)
- `src/ads.js`, `src/captcha.js`: advertising and CAPTCHA, both off until configured
- `sw.js`, `manifest.webmanifest`, `icons/`: installable web app and notifications
- `privacy.html`, `terms.html`, `support.html`, `delete-account.html`, `community.html`, `child-safety.html`: the public pages app stores ask for

## The rules that live in the database

The client shows a change the moment it is made; the database decides whether it
stands. Clients cannot write coins, rooms, ownership, memberships or their own age
check directly; column grants and row policies stop it, and `save_game` rewrites
every server owned field of the shared document before storing it.

| Action | Function | Rule |
| --- | --- | --- |
| Today's question | `answer_ritual` | Pays when the second partner answers. First ever: 40 coins and three starter items. After that 30 plus 3 per streak day, capped at +60. Once per day. |
| Trivia duel | `finish_duel` | 9 coins per match, counted from the stored round. Once per day. |
| Memory match | `finish_memory` | 30 at par (10 moves), down 3 per extra move, floor 8. Twice per day. |
| Buy | `buy_item` | Price from `catalogue_items`, room must be unlocked, coins must cover it. |
| Unlock a room | `unlock_room` | Kitchen 700, bedroom 1,400, garden 2,200, study 3,200, porch 4,300. |
| Publish | `publish_home` | Moderation filter, charm added up from the server's price list. |
| Hearts | `toggle_like` | Once per person, never on your own home. Three reports hide a home from everyone. |
| Age | `set_profile` | Under 16 is refused, and the refusal cannot be retried with another date. |

A day is the couple's local calendar day, accepted only if it is today somewhere on Earth.

## Running it locally

```bash
npm install
npx playwright install chromium
npm run serve        # http://127.0.0.1:8811, forwards Supabase calls through its own origin
```

Open `http://127.0.0.1:8811/`. Add `?as=2` to a second tab to be a second person in
the same browser. Add `#dev` for the asset review and the funnel.

## Tests

```bash
npm test                          # every suite, starting tools/serve.js if needed
node tools/run-all.js economy     # only suites whose name matches
```

| Suite | Needs the database | What it proves |
| --- | --- | --- |
| `parity-test` | no | both transports answer every path a screen calls |
| `merge-test` | no | the three way merge keeps both phones' changes and never duplicates items |
| `catalogue-test` | no | the server price list matches the client catalogue |
| `local-test`, `handoff-test`, `entry-test`, `two-phones-test`, `solo-test` | no | the whole flow on the local store |
| `guest-pair-test`, `screen-pair-test`, `room-sync-test`, `pairing-test` | yes | two real guest accounts pair, sync one house, and cannot reach anything that is not theirs |
| `economy-test` | yes | earning caps, prices, refusals, cheating attempts, age check, the street |

The database suites create guest accounts on the live project. CI
(`.github/workflows/test.yml`) runs only the offline suites.

## Changing the database

`docs/backend.sql` is the original schema. `docs/migrations/` holds everything
applied since, in order (001 to 007). Apply new migrations to the `nest` project
before, or together with, the client that needs them.

The price list is generated from the client catalogue:

```bash
node tools/catalogue-sql.js > docs/migrations/002_catalogue.sql
```

then apply that file. `catalogue-test` fails until the two agree.

## Notifications

Settings, or the primer at the end of onboarding, asks for permission and
subscribes the browser. The `push` function tells a partner when you answer
today's question, finish your half of the duel, or change the room (at most once
every 30 minutes). At 7pm local time, anyone whose nest has not done today's
question gets one reminder. On iPhone and iPad, web push only works once NEST
has been added to the Home Screen.

## Monitoring

- **Errors:** Supabase dashboard, table `client_errors` (last 90 days)
- **Funnel and usage:** table `client_events`
- **Traffic:** Vercel dashboard, Analytics tab (switch Web Analytics on once)

## Before submitting to an app store

1. In `site-config.js`, replace the placeholder `contact` address with a real
   inbox, and confirm the operator name.
2. Add the moderation word list to the `moderation_terms` table.
3. Optional but recommended: a Cloudflare Turnstile site key in `site-config.js`
   and the matching secret in Supabase Auth, Attack Protection.
4. Optional: Sign in with Apple and Google in Supabase Auth, so accounts survive a
   cleared browser. The client offers whatever the project has enabled.

## Design notes

- `docs/joint-data-policy.md`: why a nest freezes rather than transferring or
  being deleted when one person leaves.
- The camera tilt is free between 8 and 80 degrees, yaw is free, roll is locked.
  Tapping **home** returns to the composed 32 degree shot.
