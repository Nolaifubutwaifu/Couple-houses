/* The handover from onboarding to the app, which is where the build loop was
   being broken. Three things are under test and all three sit on the path
   every new couple takes:

     - the first ritual asks the day's question rather than rolling its own,
       so the two phones are comparing answers to the same question
     - the tutorial borrows the next tap and gives it straight back, so the
       app can place things again for the rest of the session
     - a save already carrying repeated instanceIds is repaired on load

   Local store only, no database, one tab. That is deliberate: these are
   client rules and they have to hold with nothing else running.

   Needs a static server on 8811 and playwright resolvable. Set
   NEST_PLAYWRIGHT and NEST_CHROMIUM to point at them elsewhere. */
const { chromium } = require(process.env.NEST_PLAYWRIGHT ||
  "/tmp/claude-0/-home-user-Couple-houses/a4be0025-710d-52b8-9ec5-b63856445aec/scratchpad/node_modules/playwright");
const CHROME = process.env.NEST_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 10;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : "");
  (c ? pass : fail).push(l); console.log((c ? "  ok   " : "  FAIL ") + l); };
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const ctx = await browser.newContext({ viewport:{ width:420, height:900 } });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [pageerror]", e.message));
  await page.addInitScript(() => { window.NEST_CONFIG = { url:"" }; });
  await page.goto(ORIGIN);
  await page.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  await page.evaluate(() => Api.readyP);
  await wait(1200);

  /* A paired nest without driving the whole invite flow, which pairing-test
     already covers. The store is re-read before every request, so the rows
     written here are written back rather than left in memory. */
  const me = await page.evaluate(async () => {
    await Api.call("POST", "/auth/session", { provider:"apple", subject:"handoff" });
    await Api.call("POST", "/users/me", { display_name:"Max", birthdate:"1990-04-02" });
    const n = await Api.call("POST", "/nests", {});
    const db = Api.db;
    db.users.usr_jo = { id:"usr_jo", display_name:"Jo", age_verified:true, created_at:Date.now() };
    db.memberships.mem_jo = { id:"mem_jo", nest_id:n.nest.id, user_id:"usr_jo",
      role:"partner", status:"active", joined_at:Date.now() };
    db.nests[n.nest.id].status = "active";
    db.nests[n.nest.id].name = "Our nest";
    localStorage.setItem("nest.db.v1", JSON.stringify(db));
    const me = await Api.call("GET", "/nests/mine");
    App.ensureGame(me.nest.id);
    App.game.ceremony_pending = false;
    App.saveGame();
    return me;
  });

  /* ---- the first ritual ---- */
  await page.evaluate(me => {
    document.body.classList.add("onboarding");
    document.querySelector("#onboard").hidden = false;
    Onboard.go("firstRitual", me);
  }, me);
  await wait(400);
  const q = await page.evaluate(() => ({
    onScreen:document.querySelector("#ob-sheet .ob-h").textContent, today:ritualToday().q }));
  ok("the first ritual asks the day's question rather than rolling its own",
     q.onScreen === q.today, JSON.stringify(q));

  await page.evaluate(() => document.querySelector("#ob-sheet .opt").click());
  await page.evaluate(() => Api.Realtime.deliver({ type:"ritual.answered",
    payload:{ nest_id:App.game.nest_id, i:1 }, at:Date.now(), from:"usr_jo" }));
  await wait(500);
  ok("it settles once both answers are in", await page.evaluate(() => !!document.querySelector("#ob-place")));

  /* ---- the tutorial placement ---- */
  await page.evaluate(() => document.querySelector("#ob-place").click());
  await wait(1200);
  ok("the tutorial is holding the starter item", await page.evaluate(() => !!Diorama.held));
  ok("and it borrowed the tap rather than taking it", await page.evaluate(() =>
    Diorama.placeModes.length === 1 && typeof Diorama.onPlace === "function"));

  await page.evaluate(() => Diorama.placeHandler()({ room:"living", x:2, y:5, f:{ w:1, h:1 } }));
  await wait(2400);
  ok("and gave it back on the way out", await page.evaluate(() => Diorama.placeModes.length === 0),
     await page.evaluate(() => "modes " + Diorama.placeModes.length));

  await page.evaluate(async () => { Onboard.finish(); await App.enter(await Api.call("GET", "/nests/mine")); });
  await wait(900);

  /* ---- and now the app's own placement, which is what used to be gone ---- */
  const out = await page.evaluate(async () => {
    go("build");
    await new Promise(r => setTimeout(r, 700));
    App.game.house.inventory = [{ instanceId:"inv_armchair", itemId:"armchair" }];
    App.saveGame();
    await Build.take();
    render();
    await new Promise(r => setTimeout(r, 500));
    document.querySelector("#sheet .strip .tile").click();       // pick it up
    await new Promise(r => setTimeout(r, 300));
    Diorama.placeHandler()({ room:"living", x:6, y:2, f:{ w:2, h:2 } });
    await new Promise(r => setTimeout(r, 400));
    const ids = App.game.house.placed.map(p => p.instanceId);
    return { placed:App.game.house.placed.map(p => p.itemId + ":" + p.instanceId),
             dupes:ids.length !== new Set(ids).size,
             push:/One last thing/.test(document.body.textContent),
             onboard:!document.querySelector("#onboard").hidden };
  });
  ok("the item you selected is the item that lands",
     out.placed.some(p => p === "armchair:inv_armchair"), JSON.stringify(out.placed));
  ok("no second copy of the starter plant",
     out.placed.filter(p => p.startsWith("plant:")).length === 1, JSON.stringify(out.placed));
  ok("every placed thing keeps an id of its own", !out.dupes, JSON.stringify(out.placed));
  ok("and the notification sheet does not reopen over the build screen",
     !out.push && !out.onboard, JSON.stringify({ push:out.push, onboard:out.onboard }));

  /* ---- saves already in the wild ---- */
  const repaired = await page.evaluate(() => {
    const id = App.game.nest_id;
    Api.db.game[id].house.placed = [1, 2, 3].map((n, i) =>
      ({ instanceId:"start_plant", itemId:"plant", room:"living", x:i + 1, y:1, rot:0 }));
    App.ensureGame(id);
    const ids = App.game.house.placed.map(p => p.instanceId);
    return { n:ids.length, unique:new Set(ids).size };
  });
  ok("a damaged save is repaired on load without losing anything",
     repaired.n === 3 && repaired.unique === 3, JSON.stringify(repaired));

  await browser.close();
  done(0);
})().catch(e => { console.error("harness error:", e.stack); done(2); });

/* Same rule as the other suites: a run that fell over halfway has no failing
   assertions because it never reached them, so the count is stated here. */
function done(code){
  const short = pass.length + fail.length < EXPECTED;
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
    (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
  fail.forEach(l => console.log("  FAIL " + l));
  process.exit(fail.length || short ? (code || 1) : 0);
}
