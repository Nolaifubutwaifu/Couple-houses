/* The other half of the same question: with no backend reachable, does the
   local store still run the whole flow exactly as it did before? Two tabs,
   one browser, no network. */
const { chromium } = require("/tmp/claude-0/-home-user-Couple-houses/a4be0025-710d-52b8-9ec5-b63856445aec/scratchpad/node_modules/playwright");
const ORIGIN = "http://127.0.0.1:8811/index.html";
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : ""); (c ? pass : fail).push(l);
  console.log((c ? "  ok   " : "  FAIL ") + l); };

async function tab(ctx, who, config){
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [" + who + " pageerror]", e.message));
  await page.addInitScript(c => { window.NEST_CONFIG = c; }, config || { url:"" });
  await page.goto(ORIGIN);
  await page.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  await page.evaluate(() => Api.readyP);
  return { page,
    call:(m, p, b) => page.evaluate(([m, p, b]) => Api.call(m, p, b)
      .then(r => ({ ok:true, r })).catch(e => ({ ok:false, code:e.code, status:e.status, msg:e.message })), [m, p, b]),
    eval:(fn, a) => page.evaluate(fn, a) };
}

(async () => {
  const browser = await chromium.launch({ executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  // one context, two tabs: the local store is shared and the session is not,
  // which is exactly the shape the local model was written for
  const ctx = await browser.newContext();
  const A = await tab(ctx, "A"), B = await tab(ctx, "B");
  ok("the backend stays off with no url", await A.eval(() => Api.backend === null && Backend.reason === "not configured"),
     await A.eval(() => Backend.reason));

  /* The live site's actual state until anonymous sign in is switched on: the
     database is reachable and has no way into it, which must fall back rather
     than strand somebody at a sign in screen that cannot work. */
  const probe = await tab(ctx, "probe", { url:"http://127.0.0.1:8811", lib:"/_lib/supabase.js", probeMs:15000 });
  const state = await probe.eval(() => ({ backend:Api.backend, reason:Backend.reason, ways:Onboard.ways() }));
  ok("a reachable database with no way in falls back", state.backend === null &&
     /no sign in method/.test(state.reason), JSON.stringify(state));
  ok("and the screen offers the local providers instead",
     JSON.stringify(state.ways) === JSON.stringify(["apple", "google", "email"]), JSON.stringify(state.ways));
  await probe.page.close();

  let r = await A.call("POST", "/auth/session", { provider:"apple", subject:"ada" });
  ok("A signs in locally", r.ok && r.r.is_new === true, JSON.stringify(r).slice(0, 100));
  await A.call("POST", "/users/me", { display_name:"Ada", birthdate:"1994-04-02" });
  await B.call("POST", "/auth/session", { provider:"apple", subject:"bo" });
  await B.call("POST", "/users/me", { display_name:"Bo", birthdate:"1993-08-19" });

  r = await A.call("POST", "/nests", {});
  ok("A founds a nest", r.ok && /^[A-Z2-9]{6}$/.test(r.r.invite.code), JSON.stringify(r).slice(0, 100));
  const code = r.r.invite.code, nestId = r.r.nest.id;
  r = await B.call("POST", "/invites/" + code + "/claim", {});
  ok("B claims it", r.ok && r.r.nest.founder_name === "Ada", JSON.stringify(r).slice(0, 100));
  r = await A.call("POST", "/invites/" + code + "/confirm", { accept:true });
  ok("A confirms", r.ok && r.r.nest.status === "active");
  r = await B.call("GET", "/nests/mine");
  ok("B is active in the nest", r.ok && r.r.nest.id === nestId && r.r.members.length === 2);
  r = await A.call("POST", "/nests/" + nestId + "/name", { name:"The Long Room" });
  ok("naming still works", r.ok && r.r.nest.name === "The Long Room");
  r = await A.call("POST", "/nests/" + nestId + "/name", { name:"see nest.com" });
  ok("the filter still runs", !r.ok && r.status === 422);
  r = await A.call("POST", "/nests/" + nestId + "/leave", {});
  ok("A leaves", r.ok && r.r.nest.status === "archived");
  r = await A.call("GET", "/nests/archived");
  ok("the frozen nest is still readable", r.ok && r.r.nests.length === 1 && r.r.nests[0].members.length === 2,
     JSON.stringify(r.r).slice(0, 120));
  r = await A.call("POST", "/users/me/delete", {});
  ok("deletion still works", r.ok && r.r.deleted);

  /* and the renderer is untouched by any of this */
  const bible = await A.eval(() => { const r = runBibleChecks(); return { p:r.passed, t:r.total }; });
  ok("all " + bible.t + " assets still pass section 16", bible.p === bible.t, JSON.stringify(bible));

  await browser.close();
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length);
  fail.forEach(f => console.log("  FAIL " + f));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error("harness error:", e.stack); process.exit(2); });
