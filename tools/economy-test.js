/* Money and the street, against the live database. Every earning, every
   purchase and every cap is decided there now, so this drives the real
   functions through the real client and then tries the ways a player might
   cheat: writing the wallet into the document, writing the row directly,
   and spending coins the database never paid.

   Creates guest accounts on the project named in src/backend.js. Needs
   tools/serve.js on 8811 (tools/run-all.js starts it). */
const { chromium, launchOpts } = require("./pw");

const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 26;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : ""); (c ? pass : fail).push(l);
  console.log((c ? "  ok   " : "  FAIL ") + l); };
const wait = ms => new Promise(r => setTimeout(r, ms));

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
  const call = (m, p, b) => page.evaluate(([m, p, b]) => Api.call(m, p, b)
    .then(r => ({ ok:true, r })).catch(e => ({ ok:false, code:e.code, reason:e.reason })), [m, p, b]);
  return { page, call, eval:(fn, a) => page.evaluate(fn, a) };
}
async function person(browser, tag, name, birthdate){
  const p = await guest(browser, tag);
  await p.call("POST", "/auth/session", { provider:"guest" });
  if(birthdate) await p.call("POST", "/users/me", { display_name:name, birthdate });
  return p;
}

(async () => {
  const browser = await chromium.launch({ ...launchOpts(),
    args:["--proxy-server=" + (process.env.HTTPS_PROXY || ""), "--proxy-bypass-list=127.0.0.1;localhost",
          "--ignore-certificate-errors"] });

  /* ---- the age check is the database's ---- */
  const kid = await person(browser, "e0", null, null);
  let r = await kid.call("POST", "/users/me", { display_name:"Kid", birthdate:"2016-01-01" });
  ok("under sixteen is refused", !r.ok && r.code === "under_age", JSON.stringify(r));
  r = await kid.call("POST", "/users/me", { display_name:"Kid", birthdate:"1990-01-01" });
  ok("and changing the year afterwards does not undo it", !r.ok && r.code === "under_age", JSON.stringify(r));

  /* ---- a pair ---- */
  const A = await person(browser, "e1", "Ada", "1994-04-02");
  const B = await person(browser, "e2", "Bo", "1993-08-19");
  r = await A.call("POST", "/nests", {});
  const nest = r.r.nest.id, code = r.r.invite.code;
  await B.call("POST", "/invites/" + code + "/claim", {});
  r = await A.call("POST", "/invites/" + code + "/confirm", { accept:true });
  ok("the pair is live", r.ok, JSON.stringify(r).slice(0, 80));
  await A.call("GET", "/nests/mine"); await B.call("GET", "/nests/mine");
  const day = await A.eval(() => today());
  const base = "/nests/" + nest;

  /* ---- the first ritual pays once, on the second answer ---- */
  r = await A.call("POST", base + "/ritual/answer", { day, answer:1 });
  ok("one answer pays nothing", r.ok && r.r.paid === false && r.r.both === false, JSON.stringify(r).slice(0, 120));
  r = await B.call("POST", base + "/ritual/answer", { day, answer:2 });
  ok("the second answer pays the first ritual", r.ok && r.r.paid === true && r.r.reward === 40, JSON.stringify(r).slice(0, 120));
  const inv = r.ok ? r.r.game.house.inventory.map(i => i.instanceId).sort() : [];
  ok("and delivers the three starter items", JSON.stringify(inv) === '["start_armchair","start_photos","start_plant"]', JSON.stringify(inv));
  ok("the wallet is 300", r.ok && r.r.game.wallet.coins === 300, r.ok && r.r.game.wallet.coins);
  r = await A.call("POST", base + "/ritual/answer", { day, answer:3 });
  ok("answering again pays nothing", r.ok && r.r.paid === false && r.r.game.wallet.coins === 300);
  r = await A.call("POST", base + "/ritual/answer", { day:"2001-01-01", answer:0 });
  ok("a day that is not today is refused", !r.ok && r.code === "bad_day", JSON.stringify(r));

  /* ---- spending ---- */
  r = await A.call("POST", base + "/shop/buy", { item:"plant", instance:"plant_econ1" });
  ok("a plant costs 190", r.ok && r.r.coins === 110, JSON.stringify(r).slice(0, 100));
  r = await A.call("POST", base + "/shop/buy", { item:"sofa", instance:"sofa_econ1" });
  ok("a sofa is refused at 110 coins", !r.ok && r.code === "not_enough_coins", JSON.stringify(r));
  r = await A.call("POST", base + "/shop/buy", { item:"plant", instance:"plant_econ1" });
  ok("the same instance cannot be bought twice", !r.ok, JSON.stringify(r));
  r = await A.call("POST", base + "/shop/buy", { item:"bed", instance:"bed_econ1" });
  ok("a bed is refused while the bedroom is locked", !r.ok && (r.code === "room_locked" || r.code === "not_enough_coins"), JSON.stringify(r));
  r = await A.call("POST", base + "/rooms/unlock", { room:"kitchen" });
  ok("the kitchen is refused at 110 coins", !r.ok && r.code === "not_enough_coins", JSON.stringify(r));

  /* ---- the daily caps ---- */
  const m1 = await A.call("POST", base + "/memory/finish", { day, moves:10 });
  const m2 = await B.call("POST", base + "/memory/finish", { day, moves:20 });
  const m3 = await A.call("POST", base + "/memory/finish", { day, moves:6 });
  ok("memory pays 30 at par and 8 at the floor", m1.ok && m1.r.reward === 30 && m2.ok && m2.r.reward === 8,
     JSON.stringify([m1.r && m1.r.reward, m2.r && m2.r.reward]));
  ok("and a third round in a day pays nothing", m3.ok && m3.r.paid === false && m3.r.game.wallet.coins === 148,
     JSON.stringify(m3).slice(0, 120));

  await A.eval(async ([id, day]) => {
    App.ensureGame(id);
    const q = { q:"?", o:["a","b","c","d"] };
    App.game.duel = { day, answerer:"a", phase:"done", settled:true, qs:[q,q,q,q,q,q],
                      answers:[0,1,2,3,0,1], guesses:[0,1,2,0,0,0] };
    await Store.save(App.game);
  }, [nest, day]);
  r = await A.call("POST", base + "/duel/finish", { day });
  ok("the duel pays nine a match, counted by the database", r.ok && r.r.matches === 4 && r.r.reward === 36,
     JSON.stringify(r).slice(0, 120));
  r = await B.call("POST", base + "/duel/finish", { day });
  ok("and pays once a day", r.ok && r.r.paid === false && r.r.game.wallet.coins === 184, JSON.stringify(r).slice(0, 120));

  /* ---- cheating ---- */
  await A.eval(async id => { App.ensureGame(id); App.game.wallet.coins = 99999; await Store.save(App.game); }, nest);
  await wait(1500);
  r = await A.call("POST", base + "/shop/buy", { item:"ring", instance:"ring_cheat1" });
  ok("coins written into the document buy nothing", !r.ok && r.code === "not_enough_coins", JSON.stringify(r));
  const direct = await A.eval(async id => {
    const res = await Backend.sb.from("nests").update({ coins:99999 }).eq("id", id).select("coins");
    return { error:res.error && res.error.message, rows:res.data };
  }, nest);
  const stored = await A.eval(async id => (await Backend.sb.from("nests").select("coins").eq("id", id).single()).data, nest);
  ok("writing the row directly changes nothing", stored && stored.coins === 184, JSON.stringify({ direct, stored }));
  const doc = await B.eval(async id => { await Backend.flush(); await Backend.pull(); return Api.db.game[id].wallet.coins; }, nest);
  ok("and the partner's wallet still reads the truth", doc === 184, "B reads " + doc);

  /* ---- the street ---- */
  r = await A.call("POST", base + "/publish", { tagline:"visit www.example.com" });
  ok("a link is refused at publish", !r.ok && r.code === "rejected" && /Links/.test(r.reason || ""), JSON.stringify(r));
  r = await A.call("POST", base + "/publish", { tagline:"Two people, one plant." });
  ok("a clean line publishes", r.ok && r.r.tagline === "Two people, one plant.", JSON.stringify(r));

  const C = await person(browser, "e3", "Cy", "1990-02-02");
  r = await C.call("GET", "/street");
  const onStreet = r.ok && r.r.homes.some(h => h.id === nest);
  ok("a stranger sees the home on the street", onStreet, r.ok ? r.r.homes.length + " homes" : JSON.stringify(r));
  r = await C.call("POST", "/street/" + nest + "/like", {});
  ok("a stranger's heart counts once", r.ok && r.r.liked === true && r.r.likes === 1, JSON.stringify(r));
  r = await A.call("POST", "/street/" + nest + "/like", {});
  ok("a couple cannot heart their own home", !r.ok && r.code === "own_home", JSON.stringify(r));

  await browser.close();
  done(0);
})().catch(e => { console.error("harness error:", e.stack); done(2); });

function done(code){
  const short = pass.length + fail.length < EXPECTED;
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
              (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
  fail.forEach(f => console.log("  FAIL " + f));
  process.exit(code || (fail.length || short ? 1 : 0));
}
