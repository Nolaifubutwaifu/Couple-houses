/* Two isolated browser contexts, one real database. This is the test the
   local store could never pass: nothing here is shared between the two
   people except the row they both point at.

   Everyone here signs in the way the product does, as a guest, so the run
   makes its own three people and needs nothing seeded and nothing cleaned up
   between runs. That matters more than it sounds: this suite ends by deleting
   an account, so while it borrowed fixed test logins it could only be run
   once before somebody had to go and rebuild them by hand, which is a fine
   way to end up not re-running a suite that has started failing.

   It needs somewhere to serve the app from, with a way through to the
   database. Any static server on 8811 will do when the browser can reach
   Supabase directly. */
const { chromium, launchOpts } = require("./pw");

const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 49;
const pass = [], fail = [], skip = [];
const ok = (name, cond, note) => { const line = name + (note ? " :: " + note : ""); (cond ? pass : fail).push(line); console.log((cond ? "  ok   " : "  FAIL ") + line); };

async function person(browser, _unused, tag){
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true });
  const page = await ctx.newPage();
  page.on("console", m => { if(m.type() === "error" || m.type() === "warning") console.log("  [" + tag + " " + m.type() + "]", m.text().slice(0,300)); });
  page.on("pageerror", e => console.log("  [" + tag + " pageerror]", e.message));
  page.on("requestfailed", q => console.log("  [" + tag + " netfail]", q.url().slice(0,90), q.failure() && q.failure().errorText));
  await page.addInitScript(() => {
    // the sandbox browser cannot open its own tunnel, so the outbound leg
    // runs in the test server. Same database, same code, one hop shifted.
    window.NEST_CONFIG = { url:location.origin, lib:"/_lib/supabase.js",
      probeMs:35000, pollMs:1500, providers:["guest"] };
  });
  await page.goto(ORIGIN + "?as=" + tag);
  await page.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  const live = await page.evaluate(() => Api.readyP.then(() => !!Api.backend));
  if(!live) throw new Error(tag + ": backend did not come up: " +
    await page.evaluate(() => Backend.reason));
  const signed = await page.evaluate(() => Api.call("POST", "/auth/session", { provider:"guest" })
    .then(() => null).catch(e => e.code || e.message));
  if(signed) throw new Error(tag + ": sign in failed: " + signed);
  const call = (m, p, b) => page.evaluate(([m, p, b]) => Api.call(m, p, b)
    .then(r => ({ ok:true, r })).catch(e => ({ ok:false, code:e.code, status:e.status, msg:e.message })), [m, p, b]);
  return { page, call, ctx,
    eval:(fn, arg) => page.evaluate(fn, arg),
    raw:(fn, arg) => page.evaluate(fn, arg) };
}

(async () => {
  const browser = await chromium.launch({
    ...launchOpts(),
    args:["--proxy-server=" + (process.env.HTTPS_PROXY || ""),
          "--proxy-bypass-list=127.0.0.1;localhost",
          "--ignore-certificate-errors"],
  });
  const A = await person(browser, null, "1");
  const B = await person(browser, null, "2");
  ok("both tabs booted against the backend", true);

  /* 1. details */
  let r = await A.call("POST", "/users/me", { display_name:"Ada", birthdate:"1994-04-02" });
  ok("A saves details", r.ok && r.r.user.display_name === "Ada" && r.r.user.age_verified, JSON.stringify(r).slice(0, 120));
  r = await B.call("POST", "/users/me", { display_name:"Bo", birthdate:"1993-08-19" });
  ok("B saves details", r.ok && r.r.user.age_verified);

  /* 2. under age is refused by the same code path */
  const kid = new Date(); kid.setFullYear(kid.getFullYear() - 12);
  r = await B.call("POST", "/users/me", { display_name:"Bo", birthdate:kid.toISOString().slice(0, 10) });
  ok("under 16 is blocked", !r.ok && r.code === "under_age", JSON.stringify(r));
  await B.call("POST", "/users/me", { display_name:"Bo", birthdate:"1993-08-19" });

  /* 3. A founds a nest and gets a code */
  r = await A.call("POST", "/nests", {});
  ok("A founds a nest", r.ok && r.r.nest.status === "pending" && /^[A-Z2-9]{6}$/.test(r.r.invite.code), JSON.stringify(r).slice(0, 160));
  const code = r.ok ? r.r.invite.code : null;
  const nestId = r.ok ? r.r.nest.id : null;

  /* 4. coming back to the fork does not stack empty nests */
  const again = await A.call("POST", "/nests", {});
  ok("a second POST /nests reuses the pending nest", again.ok && again.r.nest.id === nestId);
  const code2 = again.ok ? again.r.invite.code : null;
  ok("regenerating revokes the old code", code2 !== code);

  /* 5. the dead code is dead */
  r = await B.call("POST", "/invites/" + code + "/claim", {});
  ok("the revoked code is refused", !r.ok && r.code === "code_used", JSON.stringify(r));

  /* 6. B claims the live one */
  r = await B.call("POST", "/invites/" + code2 + "/claim", {});
  ok("B claims the code", r.ok && r.r.nest.founder_name === "Ada" && r.r.membership.status === "invited", JSON.stringify(r).slice(0, 160));

  /* 7. A sees a pending partner without any shared browser state */
  r = await A.call("GET", "/nests/mine");
  ok("A sees B waiting", r.ok && r.r.pending_partner && r.r.pending_partner.display_name === "Bo", JSON.stringify(r.r && r.r.pending_partner));

  /* 8. B cannot see anyone else's nest and cannot claim twice */
  r = await B.call("POST", "/invites/" + code2 + "/claim", {});
  ok("B cannot claim while already queued", !r.ok && r.code === "already_in_nest", JSON.stringify(r));

  /* 8b. and cannot promote themselves past the confirmation, which is the
     one rule the whole product rests on */
  const selfPromote = await B.eval(async id => {
    const u = (await Backend.sb.auth.getUser()).data.user.id;
    const r = await Backend.sb.from("memberships").update({ status:"active" })
      .eq("nest_id", id).eq("user_id", u).select();
    return { rows:(r.data || []).length, err:r.error && r.error.message };
  }, nestId);
  ok("B cannot confirm themselves", selfPromote.rows === 0, JSON.stringify(selfPromote));
  r = await B.call("GET", "/nests/mine");
  ok("B is still only invited", r.ok && r.r.membership.status === "invited", JSON.stringify(r.r && r.r.membership));

  /* 9. A confirms, both go active */
  r = await A.call("POST", "/invites/" + code2 + "/confirm", { accept:true });
  ok("A confirms the pair", r.ok && r.r.nest.status === "active", JSON.stringify(r).slice(0, 140));
  r = await B.call("GET", "/nests/mine");
  ok("B is now active in the same nest", r.ok && r.r.nest.id === nestId &&
     r.r.membership.status === "active" && r.r.members.length === 2, JSON.stringify(r.r && r.r.membership));
  ok("B can read A's name", r.ok && r.r.members.some(m => m.user && m.user.display_name === "Ada"));

  /* 10. naming, with the filter on it */
  r = await A.call("POST", "/nests/" + nestId + "/name", { name:"visit nest.com" });
  ok("a link in the name is refused", !r.ok && r.status === 422, JSON.stringify(r));
  r = await A.call("POST", "/nests/" + nestId + "/name", { name:"The Long Room" });
  ok("A names the nest", r.ok && r.r.nest.name === "The Long Room");
  r = await A.call("POST", "/nests/" + nestId + "/settings", { base_material:"timber", terrain_type:"sand" });
  ok("A sets the base", r.ok && r.r.nest.base_material === "timber");

  /* 11. the game document is shared. A spends, B sees it. */
  await A.eval(async id => {
    App.ensureGame(id);
    App.game.wallet.coins = 999;
    App.game.house.placed.push({ instanceId:"t1", itemId:"plant", room:"living", x:2, y:2, rot:0 });
    await Store.save(App.game);
  }, nestId);
  await B.page.waitForFunction(id => {
    const g = Api.db.game[id];
    return g && g.wallet.coins === 999;
  }, nestId, { timeout:20000, polling:300 }).catch(() => {});
  r = await B.call("GET", "/nests/mine");
  const bGame = await B.eval(id => { const g = Api.db.game[id]; return g && { coins:g.wallet.coins, placed:g.house.placed.length }; }, nestId);
  ok("B reads the same game document", bGame && bGame.coins === 999 && bGame.placed === 1, JSON.stringify(bGame));

  /* 12. B writes, A picks it up from the poll with no page action at all */
  await B.eval(async id => {
    App.ensureGame(id);
    App.game.wallet.coins = 1234;
    await Store.save(App.game);
  }, nestId);
  const sawIt = await A.page.waitForFunction(id => {
    const g = Api.db.game[id];
    return g && g.wallet.coins === 1234;
  }, nestId, { timeout:15000 }).then(() => true).catch(() => false);
  ok("A's poll picks up B's spending", sawIt);

  /* 13. publishing runs the filter on the tagline */
  r = await B.call("POST", "/nests/" + nestId + "/publish", { tagline:"reach us at bo@nest.test" });
  ok("an email in the tagline is refused", !r.ok && r.status === 422, JSON.stringify(r));
  r = await B.call("POST", "/nests/" + nestId + "/publish", { tagline:"Two years and one loud kettle." });
  ok("B publishes to the street", r.ok && r.r.tagline === "Two years and one loud kettle.");

  /* 14. reporting and blocking */
  r = await B.call("POST", "/nests/seed-6/report", { reason:"Something is wrong here" });
  ok("B reports a house", r.ok && r.r.report.target === "seed-6" && r.r.contact);
  r = await B.call("GET", "/moderation");
  ok("the reported house is hidden from B", r.ok && r.r.blocked.indexOf("seed-6") >= 0, JSON.stringify(r.r));
  r = await B.call("POST", "/nests/seed-2/block", {});
  ok("B blocks a second house", r.ok && r.r.blocked === true);
  r = await A.call("GET", "/moderation");
  ok("A's blocks are A's own", r.ok && r.r.blocked.length === 0, JSON.stringify(r.r));

  /* 15. A leaves. The nest freezes for both. */
  r = await A.call("POST", "/nests/" + nestId + "/leave", {});
  ok("A leaves", r.ok && r.r.nest.frozen === true && r.r.nest.status === "archived", JSON.stringify(r).slice(0, 140));
  r = await B.call("GET", "/nests/mine");
  ok("B has no live nest either", r.ok && r.r.nest === null, JSON.stringify(r.r && r.r.nest));

  /* 16. and neither of them can write to it again */
  r = await B.call("POST", "/nests/" + nestId + "/name", { name:"Mine now" });
  ok("a frozen nest cannot be renamed", !r.ok, JSON.stringify(r));

  /* 17. both can still look at it, with both names on it */
  for(const [who, p] of [["A", A], ["B", B]]){
    r = await p.call("GET", "/nests/archived");
    const n = r.ok && r.r.nests[0];
    ok(who + " can still see the frozen nest", !!n && n.id === nestId, JSON.stringify(r.r).slice(0, 120));
    ok(who + " sees both names on it", !!n && n.members.filter(m => m.name).length === 2, n && JSON.stringify(n.members));
    const g = await p.eval(id => { const g = Api.db.game[id]; return g && g.wallet.coins; }, nestId);
    ok(who + " can still see what they built", g === 1234, String(g));
  }

  /* 17b. the freeze is the database's rule, not the screen's */
  const rawRename = await B.eval(async id => {
    const r = await Backend.sb.from("nests").update({ name:"Mine now" }).eq("id", id).select();
    return { err:r.error && r.error.message, rows:(r.data || []).length };
  }, nestId);
  ok("the database refuses the write too", rawRename.rows === 0, JSON.stringify(rawRename));

  /* 17c. a stranger with a valid login sees none of it */
  const E = await person(browser, null, "3");
  const seen = await E.eval(async id => {
    const nest = await Backend.sb.from("nests").select("*").eq("id", id);
    const mem = await Backend.sb.from("memberships").select("*").eq("nest_id", id);
    const inv = await Backend.sb.from("invites").select("*");
    const who = await Backend.sb.from("profiles").select("*");
    const rep = await Backend.sb.from("reports").select("*");
    return { nests:(nest.data || []).length, members:(mem.data || []).length,
             invites:(inv.data || []).length, profiles:(who.data || []).length,
             reports:(rep.data || []).length };
  }, nestId);
  ok("a stranger reads no nest", seen.nests === 0, JSON.stringify(seen));
  ok("a stranger reads no memberships", seen.members === 0);
  ok("a stranger reads no invites", seen.invites === 0);
  ok("a stranger reads only their own profile", seen.profiles === 1);
  ok("a stranger reads no reports", seen.reports === 0);
  const wrote = await E.eval(async id => {
    const r = await Backend.sb.from("nests").update({ name:"Eve was here" }).eq("id", id).select();
    const m = await Backend.sb.from("memberships")
      .insert({ nest_id:id, user_id:(await Backend.sb.auth.getUser()).data.user.id, role:"partner", status:"active" });
    return { rows:(r.data || []).length, joined:!m.error };
  }, nestId);
  ok("a stranger cannot write to a nest", wrote.rows === 0, JSON.stringify(wrote));
  ok("a stranger cannot join a nest", wrote.joined === false, JSON.stringify(wrote));

  /* 18. and both are free to start again */
  r = await A.call("POST", "/nests", {});
  ok("A can found a new nest", r.ok && r.r.nest.id !== nestId, JSON.stringify(r).slice(0, 120));

  /* 19. deletion erases the person and leaves the record */
  r = await B.call("POST", "/users/me/delete", {});
  ok("B deletes their account", r.ok && r.r.deleted);
  r = await B.call("GET", "/nests/mine");
  ok("B is signed out afterwards", r.ok && r.r.user === null, JSON.stringify(r.r));
  r = await A.call("GET", "/nests/archived");
  const arch = r.ok && r.r.nests.find(n => n.id === nestId);
  ok("the frozen nest survives B's deletion", !!arch, JSON.stringify(r.r).slice(0, 120));
  ok("B's name is gone from it", !!arch && arch.members.filter(m => m.name).length === 1,
     arch && JSON.stringify(arch.members));

  await browser.close();
  report(0);
})().catch(e => { console.error("harness error:", e.stack); report(2); });

/* A run that fell over halfway has no failing assertions, because it never
   reached them. Exiting zero on that is how a suite reports 37 of its 49
   checks and still calls itself green. */
function report(code){
  const short = pass.length + fail.length < EXPECTED;
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length +
              (skip.length ? "  SKIP " + skip.length : "") +
              (short ? "  (INCOMPLETE, expected " + EXPECTED + ")" : ""));
  fail.forEach(f => console.log("  FAIL " + f));
  skip.forEach(f => console.log("  SKIP " + f));
  process.exit(code || (fail.length || short ? 1 : 0));
}
