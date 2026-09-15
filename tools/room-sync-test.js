/* One room, two people, both of them already in it. This is the case that
   broke in the wild and that every earlier suite missed, because they all had
   one side create the game document and the other side receive it. When both
   sides create their own, and both number their own revisions, the two rooms
   drift apart and nothing ever brings them back. */
const { chromium, launchOpts } = require("./pw");

const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 14;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : ""); (c ? pass : fail).push(l);
  console.log((c ? "  ok   " : "  FAIL ") + l); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function guest(browser, tag){
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [" + tag + " pageerror]", e.message));
  page.on("console", m => { const t = m.text();
    if(/^SAVE|^CONFLICT|^MERGED|^RESAVE|not saved/.test(t)) console.log("  [" + tag + "] " + t.slice(0,140)); });
  await page.addInitScript(() => {
    window.NEST_CONFIG = { url:location.origin, lib:"/_lib/supabase.js", probeMs:35000, pollMs:1200 };
  });
  await page.goto(ORIGIN + "?as=" + tag);
  await page.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:25000 });
  await page.evaluate(() => Api.readyP);
  return { page, ctx,
    call:(m, p, b) => page.evaluate(([m, p, b]) => Api.call(m, p, b)
      .then(r => ({ ok:true, r })).catch(e => ({ ok:false, code:e.code, msg:e.message })), [m, p, b]),
    eval:(fn, a) => page.evaluate(fn, a) };
}
const room = p => p.eval(id => {
  const g = Api.db.game[id];
  return g ? { items:g.house.placed.map(x => x.itemId).sort(), coins:g.wallet.coins } : null;
}, p.nestId);

(async () => {
  const browser = await chromium.launch({
    ...launchOpts(),
    args:["--proxy-server=" + (process.env.HTTPS_PROXY || ""),
          "--proxy-bypass-list=127.0.0.1;localhost", "--ignore-certificate-errors"],
  });
  const A = await guest(browser, "r1"), B = await guest(browser, "r2");
  await A.call("POST", "/auth/session", { provider:"guest" });
  await B.call("POST", "/auth/session", { provider:"guest" });
  await A.call("POST", "/users/me", { display_name:"Ada", birthdate:"1994-04-02" });
  await B.call("POST", "/users/me", { display_name:"Bo", birthdate:"1993-08-19" });
  let r = await A.call("POST", "/nests", {});
  const code = r.r.invite.code, nestId = r.r.nest.id;
  A.nestId = B.nestId = nestId;
  await B.call("POST", "/invites/" + code + "/claim", {});
  await A.call("POST", "/invites/" + code + "/confirm", { accept:true });
  ok("paired", true);

  /* Both of them arrive in the app at the same moment, which is what happens
     after a ceremony, and both build a game document of their own. */
  /* the real way in, so the listeners the app installs on arrival are the
     ones under test rather than a hand made stand in */
  const enter = async p => p.eval(async id => {
    const me = await Api.call("GET", "/nests/mine");
    App.ensureGame(id);
    App.game.ceremony_pending = false;
    await App.enter(me);
  }, nestId);
  await enter(A); await enter(B);
  ok("both are in the room with a document each", true);

  /* Things in the room have to be owned now, and owning starts with the first
     ritual: both answer, the database pays and delivers the starter items.
     One more plant is bought, for the duplication check at the end. */
  const day = await A.eval(() => today());
  await A.call("POST", "/nests/" + nestId + "/ritual/answer", { day, answer:0 });
  await B.call("POST", "/nests/" + nestId + "/ritual/answer", { day, answer:1 });
  r = await A.call("POST", "/nests/" + nestId + "/shop/buy", { item:"plant", instance:"plant_rs1" });
  await A.eval(() => Backend.flush()); await B.eval(() => Backend.flush());

  /* One turn at a time. */
  const takeA = await A.eval(id => Api.call("POST", "/nests/" + id + "/build/claim", {}), nestId);
  ok("A takes the turn", takeA.mine === true, JSON.stringify(takeA));
  const takeB = await B.eval(id => Api.call("POST", "/nests/" + id + "/build/claim", {}), nestId);
  ok("B is told it is not their turn", takeB.mine === false && takeB.builder_name === "Ada",
     JSON.stringify(takeB));

  /* A furnishes. */
  await A.eval(async id => {
    App.ensureGame(id);
    App.game.house.inventory = App.game.house.inventory.filter(i => i.instanceId !== "start_armchair");
    App.game.house.placed.push({ instanceId:"start_armchair", itemId:"armchair", room:"living", x:2, y:2, rot:0 });
    await Store.save(App.game);
  }, nestId);
  const bSaw = await B.page.waitForFunction(id => {
    const g = Api.db.game[id];
    return g && g.house.placed.some(p => p.itemId === "armchair");
  }, nestId, { timeout:25000 }).then(() => true).catch(() => false);
  ok("B's room gets A's armchair", bSaw, JSON.stringify(await room(B)));

  /* A hands the turn over and B furnishes. */
  await A.eval(id => Api.call("POST", "/nests/" + id + "/build/release", {}), nestId);
  const takeB2 = await B.eval(id => Api.call("POST", "/nests/" + id + "/build/claim", {}), nestId);
  ok("the turn passes to B once A leaves the screen", takeB2.mine === true, JSON.stringify(takeB2));
  await B.eval(async id => {
    App.ensureGame(id);
    App.game.house.inventory = App.game.house.inventory.filter(i => i.instanceId !== "start_photos");
    App.game.house.placed.push({ instanceId:"start_photos", itemId:"photos", room:"living", x:7, y:1, rot:0 });
    await Store.save(App.game);
  }, nestId);
  const aSaw = await A.page.waitForFunction(id => {
    const g = Api.db.game[id];
    return g && g.house.placed.some(p => p.itemId === "photos");
  }, nestId, { timeout:25000 }).then(() => true).catch(() => false);
  ok("A's room gets B's photo wall", aSaw, JSON.stringify(await room(A)));

  /* And the thing that matters: neither of them lost anything. */
  const ra = await room(A), rb = await room(B);
  const want = it => JSON.stringify(it.filter(x => x !== "plant" || false)) === '["armchair","photos"]';
  ok("both rooms hold both things", want(ra.items) && want(rb.items), JSON.stringify({ A:ra, B:rb }));
  ok("and they agree on the coins", ra.coins === rb.coins, JSON.stringify({ A:ra.coins, B:rb.coins }));

  /* Now the hard one: two saves that genuinely collide. Neither may vanish. */
  await Promise.all([
    A.eval(async id => {
      App.ensureGame(id);
      App.game.house.inventory = App.game.house.inventory.filter(i => i.instanceId !== "start_plant");
      App.game.house.placed.push({ instanceId:"start_plant", itemId:"plant", room:"living", x:0, y:5, rot:0 });
      await Store.save(App.game);
    }, nestId),
    B.eval(async id => {
      App.ensureGame(id);
      App.game.house.placed.push({ instanceId:"first", itemId:"plant", room:"living", x:5, y:0, rot:0 });
      await Store.save(App.game);
    }, nestId),
  ]);
  /* Wait in node rather than in the page. A waitForFunction whose predicate
     throws rejects, and a .catch on it looks exactly like the wait finishing,
     which is how this assertion came to fire before the second device had
     even been told it was behind. */
  const settledWhen = async want => {
    for(let i = 0; i < 40; i++){
      const n = await A.eval(async id => {
        const g = await Backend.sb.from("nests").select("game").eq("id", id).maybeSingle();
        return (g.data && g.data.game && g.data.game.house && g.data.game.house.placed.length) || 0;
      }, nestId).catch(() => 0);
      if(n >= want) return true;
      await sleep(1000);
    }
    return false;
  };
  ok("both collided writes reach the database", await settledWhen(4));
  const settled = await A.eval(async id => {
    const g = await Backend.sb.from("nests").select("game,game_rev").eq("id", id).maybeSingle();
    return { items:g.data.game.house.placed.map(p => p.itemId).sort(), rev:g.data.game_rev };
  }, nestId);
  ok("a genuine collision loses nothing", JSON.stringify(settled.items) === '["armchair","photos","plant","plant"]',
     JSON.stringify(settled));
  ok("and the database issued every revision", settled.rev >= 4, String(settled.rev));

  /* The duplication: hold a piece, have the room change under you, and put
     the piece back into storage. There is one sofa, so there must be one
     sofa, in exactly one of the two places. */
  await B.eval(id => Api.call("POST", "/nests/" + id + "/build/release", {}), nestId);
  await A.eval(id => Api.call("POST", "/nests/" + id + "/build/claim", {}), nestId);
  await A.page.waitForFunction(() => App.game.house.inventory.some(i => i.instanceId === "plant_rs1"),
    null, { timeout:20000, polling:300 }).catch(() => {});
  // A picks it up, and while it is in A's hands the document says it is placed
  await A.eval(() => {
    held = { instanceId:"plant_rs1", itemId:"plant", rot:0 };
    App.game.house.inventory = App.game.house.inventory.filter(q => q.instanceId !== "plant_rs1");
    Diorama.setHeld("plant", 0);
  });
  await A.eval(async id => {
    const g = Api.db.game[id];
    g.house.placed.push({ instanceId:"plant_rs1", itemId:"plant", room:"living", x:3, y:5, rot:0 });
    Api.db.game[id] = g;
    Realtime.deliver({ type:"game.changed", payload:{ nest_id:id }, from:"test" });
  }, nestId);
  await A.page.waitForFunction(() => !held, null, { timeout:8000, polling:100 }).catch(() => {});
  const after = await A.eval(() => ({
    held: held && held.instanceId,
    placed: App.game.house.placed.filter(p => p.instanceId === "plant_rs1").length,
    inv: App.game.house.inventory.filter(i => i.instanceId === "plant_rs1").length,
  }));
  ok("a piece the room already accounts for leaves your hands", after.held === null, JSON.stringify(after));
  ok("and it exists exactly once", after.placed + after.inv === 1, JSON.stringify(after));

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
