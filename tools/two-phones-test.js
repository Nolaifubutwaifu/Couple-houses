/* The two games that need two phones, and the sync underneath them.

   The ritual used to render both partners' rows on whichever device opened
   it, and the duel used to run start to finish on one, with a "pass the
   phone" screen in the middle that nothing enforced. Either one could be
   swept alone. Both rounds live in the shared document now, and the tests
   that matter are the ones proving you cannot play your partner's half, and
   that their half reaches their screen without anybody reloading.

   Two tabs in one context: the local store is shared and the session is not,
   which is the shape the local model was written for.

   Needs a static server on 8811 and playwright resolvable. Set
   NEST_PLAYWRIGHT and NEST_CHROMIUM to point at them elsewhere. */
const { chromium } = require(process.env.NEST_PLAYWRIGHT ||
  "/tmp/claude-0/-home-user-Couple-houses/a4be0025-710d-52b8-9ec5-b63856445aec/scratchpad/node_modules/playwright");
const CHROME = process.env.NEST_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 15;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : "");
  (c ? pass : fail).push(l); console.log((c ? "  ok   " : "  FAIL ") + l); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function tab(ctx, who){
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  [" + who + " pageerror]", e.message));
  await p.addInitScript(() => { window.NEST_CONFIG = { url:"" }; });
  await p.goto(ORIGIN);
  await p.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  await p.evaluate(() => Api.readyP);
  return p;
}
const sheet = p => p.evaluate(() => document.querySelector("#sheet").textContent.replace(/\s+/g, " ").trim());
/* Wait for the question to actually be on screen before tapping it, rather
   than sleeping and hoping: a dropped tap here reads as a broken duel. */
const answerOne = async (p, n) => {
  await p.waitForFunction(n => {
    const label = document.querySelector("#sheet .spread .dim");
    return !!label && label.textContent.trim().indexOf(n + " of") === 0 &&
           !!document.querySelector("#sheet .opt");
  }, n, { timeout:10000 });
  await p.evaluate(() => document.querySelector("#sheet .opt").click());
};

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const ctx = await browser.newContext({ viewport:{ width:420, height:900 } });
  const A = await tab(ctx, "A");
  await wait(1500);

  const code = await A.evaluate(async () => {
    await Api.call("POST", "/auth/session", { provider:"apple", subject:"duel-a" + Date.now() });
    await Api.call("POST", "/users/me", { display_name:"Max", birthdate:"1990-04-02" });
    return (await Api.call("POST", "/nests", {})).invite.code;
  });
  const B = await tab(ctx, "B");
  await B.evaluate(async code => {
    await Api.call("POST", "/auth/session", { provider:"google", subject:"duel-b" + Date.now() });
    await Api.call("POST", "/users/me", { display_name:"Jo", birthdate:"1991-06-06" });
    await Api.call("POST", "/invites/" + code + "/claim", { code });
  }, code);
  await wait(500);                    // the claim has to be committed before it is confirmed
  await A.evaluate(code => Api.call("POST", "/invites/" + code + "/confirm", { accept:true })
    .catch(e => ({ err:e.code })), code);
  await wait(700);
  for(const p of [A, B]){
    await p.evaluate(async () => {
      const me = await Api.call("GET", "/nests/mine");
      App.ensureGame(me.nest.id);
      App.game.ceremony_pending = false;
      App.saveGame();
      Onboard.finish();
      await App.enter(await Api.call("GET", "/nests/mine"));
    });
    await wait(700);
  }
  const roles = await Promise.all([A, B].map(p => p.evaluate(() => App.me.membership.role)));
  ok("A founded the nest and B joined it", roles[0] === "founder" && roles[1] === "partner",
     JSON.stringify(roles));

  for(const p of [A, B]) await p.evaluate(() => go("play", { game:"duel" }));
  await wait(700);
  const opening = { a:await sheet(A), b:await sheet(B) };
  ok("both phones agree on who answers first",
     /Max goes first/.test(opening.a) && /Max goes first/.test(opening.b));
  ok("and the guesser is told the questions land on the other phone",
     /on their own phone|guess them on yours/.test(opening.b), opening.b.slice(0, 140));

  await A.evaluate(() => document.querySelector("#begin").click());
  await wait(500);
  for(let i = 1; i <= 6; i++) await answerOne(A, i);
  await wait(1200);

  ok("with the answers in, the answerer is told to wait",
     /is guessing/.test(await sheet(A)), (await sheet(A)).slice(0, 120));
  ok("and the questions have moved to the other phone",
     /What did Max say/.test(await sheet(B)), (await sheet(B)).slice(0, 120));
  ok("the answerer cannot guess their own answers",
     await A.evaluate(() => document.querySelectorAll("#sheet .opt").length === 0));

  for(let i = 1; i <= 6; i++) await answerOne(B, i);
  await wait(1200);
  const ending = { a:await sheet(A), b:await sheet(B) };
  ok("both phones land on the same result", /of 6/.test(ending.a) && /of 6/.test(ending.b),
     JSON.stringify({ a:ending.a.slice(0, 60), b:ending.b.slice(0, 60) }));
  ok("the result rows name who answered", /Max said/.test(ending.a), ending.a.slice(0, 140));

  const paid = await Promise.all([A, B].map(p => p.evaluate(() =>
    ({ duels:App.game.stats.duelsPlayed, daily:App.game.daily.duel }))));
  ok("and the round is paid once, not once per device",
     paid[0].duels === 1 && paid[1].duels === 1 && paid[0].daily === 1, JSON.stringify(paid));

  /* ---- the daily ritual, same two phones ---- */
  for(const p of [A, B]) await p.evaluate(() => go("play", { game:"ritual" }));
  await wait(700);
  const rows = p => p.evaluate(() =>
    [...document.querySelectorAll("#sheet .answered, #sheet .waiting")]
      .map(r => r.textContent.replace(/\s+/g, " ").trim()));
  const answerable = p => p.evaluate(() => document.querySelectorAll("#sheet .waiting button").length);
  ok("the ritual asks the day's question on both phones", await A.evaluate(() =>
       document.querySelector("#sheet .h").textContent === ritualToday().q));
  ok("and each of you has exactly one row to answer",
     await answerable(A) === 1 && await answerable(B) === 1);

  await A.evaluate(() => document.querySelector("#sheet .waiting button").click());
  await wait(400);
  await A.evaluate(() => document.querySelector("#sheet .opt").click());
  await wait(1500);
  const bRows = await rows(B);
  ok("the partner's screen catches up without a reload",
     bRows.some(r => /answered/.test(r)), JSON.stringify(bRows));
  ok("but it does not say what they answered", await B.evaluate(() => {
       const opts = ritualToday().o;
       const shown = [...document.querySelectorAll("#sheet .answered")].map(r => r.textContent);
       return !shown.some(t => opts.some(o => t.indexOf(o) >= 0));
     }), JSON.stringify(bRows));
  ok("and the payoff is not given away early",
     !/same thing|different answers/i.test(await sheet(B)));

  await B.evaluate(() => document.querySelector("#sheet .waiting button").click());
  await wait(400);
  await B.evaluate(() => document.querySelector("#sheet .opt").click());
  await wait(1500);
  ok("once both are in, both phones show the answers and the payoff",
     /same thing|different answers/i.test(await sheet(A)) &&
     /same thing|different answers/i.test(await sheet(B)),
     JSON.stringify({ a:(await sheet(A)).slice(-60), b:(await sheet(B)).slice(-60) }));

  await browser.close();
  done(0);
})().catch(e => { console.error("harness error:", e.stack); done(2); });

function done(code){
  const short = pass.length + fail.length < EXPECTED;
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
    (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
  fail.forEach(l => console.log("  FAIL " + l));
  process.exit(fail.length || short ? (code || 1) : 0);
}
