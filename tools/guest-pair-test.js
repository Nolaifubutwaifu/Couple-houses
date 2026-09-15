/* The real thing, end to end, with nothing typed but two names and two
   birthdays. Two isolated browsers, two guest accounts, one database. This
   is exactly the path a couple takes, so it uses no test accounts, no
   passwords and no seeded rows: everything here is made by the app. */
const { chromium, launchOpts } = require("./pw");

const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 13;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : ""); (c ? pass : fail).push(l);
  console.log((c ? "  ok   " : "  FAIL ") + l); };

async function guest(browser, tag){
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [" + tag + " pageerror]", e.message));
  await page.addInitScript(() => {
    window.NEST_CONFIG = { url:location.origin, lib:"/_lib/supabase.js", probeMs:35000, pollMs:1500 };
  });
  await page.goto(ORIGIN + "?as=" + tag);
  await page.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  await page.evaluate(() => Api.readyP);
  return { page, ctx,
    call:(m, p, b) => page.evaluate(([m, p, b]) => Api.call(m, p, b)
      .then(r => ({ ok:true, r })).catch(e => ({ ok:false, code:e.code, status:e.status, msg:e.message })), [m, p, b]),
    eval:(fn, a) => page.evaluate(fn, a) };
}

(async () => {
  const browser = await chromium.launch({
    ...launchOpts(),
    args:["--proxy-server=" + (process.env.HTTPS_PROXY || ""),
          "--proxy-bypass-list=127.0.0.1;localhost", "--ignore-certificate-errors"],
  });
  const A = await guest(browser, "g1"), B = await guest(browser, "g2");

  /* 1. the screen offers what the project actually has on */
  const ways = await A.eval(() => ({ backend:!!Api.backend, ways:Onboard.ways(), reason:Backend.reason }));
  ok("the backend is live and offers the guest path", ways.backend &&
     JSON.stringify(ways.ways) === JSON.stringify(["guest"]), JSON.stringify(ways));

  /* 2. two people, nothing typed */
  let r = await A.call("POST", "/auth/session", { provider:"guest" });
  ok("A starts with one tap", r.ok && r.r.is_new === true, JSON.stringify(r).slice(0, 90));
  r = await B.call("POST", "/auth/session", { provider:"guest" });
  ok("B starts with one tap", r.ok && r.r.is_new === true);
  const idA = await A.eval(() => Backend.uid), idB = await B.eval(() => Backend.uid);
  ok("they are two different people", idA && idB && idA !== idB, idA + " vs " + idB);

  await A.call("POST", "/users/me", { display_name:"Ada", birthdate:"1994-04-02" });
  await B.call("POST", "/users/me", { display_name:"Bo", birthdate:"1993-08-19" });

  /* 3. found, share, claim, confirm */
  r = await A.call("POST", "/nests", {});
  ok("A founds a nest and gets a code", r.ok && /^[A-Z2-9]{6}$/.test(r.r.invite.code), JSON.stringify(r).slice(0, 90));
  const code = r.ok ? r.r.invite.code : null, nestId = r.ok ? r.r.nest.id : null;

  r = await B.call("POST", "/invites/" + code + "/claim", {});
  ok("B enters the code on the other device", r.ok && r.r.nest.founder_name === "Ada", JSON.stringify(r).slice(0, 110));

  /* the founder's screen finds out on its own, which is the poll doing the
     job a websocket would if this sandbox allowed one */
  const noticed = await A.page.waitForFunction(async () => {
    const me = await Api.call("GET", "/nests/mine");
    return !!(me.pending_partner && me.pending_partner.display_name === "Bo");
  }, null, { timeout:20000 }).then(() => true).catch(() => false);
  ok("A's device notices B waiting", noticed);

  r = await A.call("POST", "/invites/" + code + "/confirm", { accept:true });
  ok("A confirms and the nest goes live", r.ok && r.r.nest.status === "active");
  r = await B.call("GET", "/nests/mine");
  ok("B is in the same nest, with A's name on it", r.ok && r.r.nest.id === nestId &&
     r.r.membership.status === "active" && r.r.members.some(m => m.user && m.user.display_name === "Ada"),
     JSON.stringify(r.r && r.r.membership));

  /* 4. one house, two people. Coins are the database's now, so the only way
     to spend them is to buy something, and the only way to have something is
     to have bought it. */
  await A.call("POST", "/nests/" + nestId + "/name", { name:"Ours" });
  r = await A.call("POST", "/nests/" + nestId + "/shop/buy", { item:"plant", instance:"plant_pair1" });
  ok("A buys a plant with the starting coins", r.ok && r.r.coins === 70, JSON.stringify(r).slice(0, 120));
  await A.eval(async id => {
    App.ensureGame(id);
    App.game.house.inventory = App.game.house.inventory.filter(i => i.instanceId !== "plant_pair1");
    App.game.house.placed.push({ instanceId:"plant_pair1", itemId:"plant", room:"living", x:3, y:3, rot:0 });
    await Store.save(App.game);
  }, nestId);
  const sawPlant = await B.page.waitForFunction(id => {
    const g = Api.db.game[id];
    return g && g.house.placed.some(p => p.instanceId === "plant_pair1") && g.wallet.coins === 70;
  }, nestId, { timeout:20000 }).then(() => true).catch(() => false);
  ok("B's device sees the plant A placed, and the coins it cost", sawPlant);

  await B.eval(async id => {
    App.ensureGame(id);
    const p = App.game.house.placed.find(x => x.instanceId === "plant_pair1");
    if(p){ p.x = 6; p.y = 1; }
    await Store.save(App.game);
  }, nestId);
  const sawMove = await A.page.waitForFunction(id => {
    const g = Api.db.game[id];
    const p = g && g.house.placed.find(x => x.instanceId === "plant_pair1");
    return !!p && p.x === 6 && p.y === 1;
  }, nestId, { timeout:20000 }).then(() => true).catch(() => false);
  ok("A's device sees B move it", sawMove);

  /* 5. and a guest survives a reload, which is the whole point of it being
     a real account rather than a session variable */
  await B.page.reload();
  await B.page.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  await B.page.evaluate(() => Api.readyP);
  r = await B.call("GET", "/nests/mine");
  ok("B comes back after a reload still in the nest", r.ok && r.r.nest && r.r.nest.id === nestId &&
     r.r.nest.name === "Ours", JSON.stringify(r.r && r.r.nest && r.r.nest.name));

  await browser.close();
  done(0);
})().catch(e => { console.error("harness error:", e.stack); done(2); });

/* A run that fell over halfway has no failing assertions, because it never
   reached them, so exiting zero on that reports a truncated suite as green.
   The expected count is stated here for the same reason. */
function done(code){
  const short = pass.length + fail.length < EXPECTED;
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
              (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
  fail.forEach(f => console.log("  FAIL " + f));
  process.exit(code || (fail.length || short ? 1 : 0));
}
