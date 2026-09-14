/* What a founder can do while they are waiting on their own, and what they
   still cannot. A solo founder used to get a demo nest to turn and a button
   to invite somebody, which is nothing to show the person they are trying to
   persuade. They can now look through the whole workshop and sketch out where
   things go. The half of this test that matters most is the other half: that
   none of it earns a coin, buys anything, or puts a real thing in the room,
   because the nest being the two of them is the product.

   Needs a static server on 8811 and playwright resolvable. Set
   NEST_PLAYWRIGHT and NEST_CHROMIUM to point at them elsewhere. */
const { chromium } = require(process.env.NEST_PLAYWRIGHT ||
  "/tmp/claude-0/-home-user-Couple-houses/a4be0025-710d-52b8-9ec5-b63856445aec/scratchpad/node_modules/playwright");
const CHROME = process.env.NEST_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 12;
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
const ob = p => p.evaluate(() => document.querySelector("#ob-sheet").textContent.replace(/\s+/g, " ").trim());

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const ctx = await browser.newContext({ viewport:{ width:420, height:900 } });
  const A = await tab(ctx, "A");
  await wait(1500);

  await A.evaluate(async () => {
    await Api.call("POST", "/auth/session", { provider:"apple", subject:"solo" + Date.now() });
    await Api.call("POST", "/users/me", { display_name:"Max", birthdate:"1990-04-02" });
    await Api.call("POST", "/nests", {});
    Onboard.go("waiting", await Api.call("GET", "/nests/mine"));
  });
  await wait(1200);
  ok("the waiting screen offers both", /Plan the first room/.test(await ob(A)) &&
     /See the workshop/.test(await ob(A)));

  /* ---- the workshop, read only ---- */
  await A.evaluate(() => document.querySelector("#ob-shop").click());
  await wait(1200);
  const shop = await A.evaluate(() => ({ tiles:document.querySelectorAll("#ob-sheet .tile").length,
                                         buys:document.querySelectorAll("#ob-sheet .tile button").length }));
  ok("a founder on their own can see the whole catalogue", shop.tiles >= CATALOGUE_SIZE(),
     JSON.stringify(shop));
  ok("and there is nothing on it to press", shop.buys === 0, "buttons: " + shop.buys);
  await A.evaluate(() => document.querySelector("#ob-cat-back").click());
  await wait(900);

  /* ---- the plan ---- */
  await A.evaluate(() => document.querySelector("#ob-plan").click());
  await wait(1600);
  ok("the plan screen opens", /Plan the first room/.test(await ob(A)));
  const before = await A.evaluate(() => App.game.wallet.coins);

  await A.evaluate(() => {
    const t = [...document.querySelectorAll("#pl-strip .tile")];
    (t.find(x => /Sofa/.test(x.textContent)) || t[0]).click();
  });
  await wait(600);
  ok("picking something up holds it over the room", await A.evaluate(() => !!Diorama.held));
  await A.evaluate(() => Diorama.placeHandler()({ room:"living", x:2, y:2, f:{ w:4, h:2 } }));
  await wait(800);
  await A.evaluate(() => {
    const t = [...document.querySelectorAll("#pl-strip .tile")];
    (t.find(x => /Coffee Table/.test(x.textContent)) || t[1]).click();
  });
  await wait(600);
  await A.evaluate(() => Diorama.placeHandler()({ room:"living", x:2, y:5, f:{ w:2, h:1 } }));
  await wait(1000);

  const after = await A.evaluate(() => ({ coins:App.game.wallet.coins, plan:App.game.plan.length,
    ghosts:Diorama.planGroup ? Diorama.planGroup.children.length : 0,
    inventory:App.game.house.inventory.length, placed:App.game.house.placed.length }));
  ok("two spots are planned, and drawn in the room", after.plan === 2 && after.ghosts === 2,
     JSON.stringify(after));
  ok("nothing was bought", after.coins === before, "coins " + before + " to " + after.coins);
  ok("nothing real was placed and nothing was delivered",
     after.inventory === 0 && after.placed === 0, JSON.stringify(after));

  await A.reload();
  await A.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP);
  await A.evaluate(() => Api.readyP);
  await wait(2500);
  ok("the plan survives a reload, and is drawn again", await A.evaluate(() =>
    Diorama.planGroup && Diorama.planGroup.children.length === 2));

  /* ---- and what the partner finds when they arrive ---- */
  const code = await A.evaluate(async () => (await Api.call("GET", "/nests/mine")).invite.code);
  const B = await tab(ctx, "B");
  await B.evaluate(async code => {
    await Api.call("POST", "/auth/session", { provider:"google", subject:"solo-b" + Date.now() });
    await Api.call("POST", "/users/me", { display_name:"Jo", birthdate:"1991-06-06" });
    await Api.call("POST", "/invites/" + code + "/claim", { code });
  }, code);
  await wait(500);                    // the claim has to be committed before it is confirmed
  await A.evaluate(code => Api.call("POST", "/invites/" + code + "/confirm", { accept:true })
    .catch(e => ({ err:e.code })), code);
  await wait(800);
  await B.evaluate(async () => {
    const me = await Api.call("GET", "/nests/mine");
    App.ensureGame(me.nest.id);
    App.game.ceremony_pending = false;
    App.saveGame();
    Onboard.finish();
    await App.enter(await Api.call("GET", "/nests/mine"));
    go("build");
  });
  await wait(1500);
  const seen = await B.evaluate(() => ({
    sheet:document.querySelector("#sheet").textContent.replace(/\s+/g, " ").trim(),
    ghosts:Diorama.planGroup ? Diorama.planGroup.children.length : 0 }));
  ok("the partner walks into the planned room", seen.ghosts === 2, "ghosts: " + seen.ghosts);
  ok("is told what it is and how to be rid of it",
     /plan from while you waited/i.test(seen.sheet) && /Clear the plan/.test(seen.sheet),
     seen.sheet.slice(0, 160));
  await B.evaluate(() => document.querySelector("#plan-clear").click());
  await wait(900);
  ok("and clearing it empties the room", await B.evaluate(() =>
    App.game.plan.length === 0 && Diorama.planGroup.children.length === 0));

  await browser.close();
  done(0);
})().catch(e => { console.error("harness error:", e.stack); done(2); });

/* the catalogue is allowed to grow, so the check is that all of it is there */
function CATALOGUE_SIZE(){ return 40; }

function done(code){
  const short = pass.length + fail.length < EXPECTED;
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
    (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
  fail.forEach(l => console.log("  FAIL " + l));
  process.exit(fail.length || short ? (code || 1) : 0);
}
