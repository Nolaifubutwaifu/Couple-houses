/* The way in, driven through the real screens rather than the API. Three
   things that were traps rather than bugs:

     - an under sixteen answer must be decided before anything is written, and
       must leave no name and no date of birth behind
     - the screen it lands on must not be a permanent brick: a real support
       address, and a way to sign out so the device is usable again
     - a link with an invite code in it must say who sent it

   Local store only, no database, one context so the two people share a store.

   Needs a static server on 8811 and playwright resolvable. Set
   NEST_PLAYWRIGHT and NEST_CHROMIUM to point at them elsewhere. */
const { chromium } = require(process.env.NEST_PLAYWRIGHT ||
  "/tmp/claude-0/-home-user-Couple-houses/a4be0025-710d-52b8-9ec5-b63856445aec/scratchpad/node_modules/playwright");
const CHROME = process.env.NEST_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ORIGIN = "http://127.0.0.1:8811/index.html";
const EXPECTED = 8;
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : "");
  (c ? pass : fail).push(l); console.log((c ? "  ok   " : "  FAIL ") + l); };
const wait = ms => new Promise(r => setTimeout(r, ms));

async function open(ctx, url){
  const p = await ctx.newPage();
  p.on("pageerror", e => console.log("  [pageerror]", e.message));
  await p.addInitScript(() => { window.NEST_CONFIG = { url:"" }; });
  await p.goto(url);
  await p.waitForFunction(() => typeof Api !== "undefined" && !!Api.readyP, null, { timeout:20000 });
  await p.evaluate(() => Api.readyP);
  return p;
}

(async () => {
  const browser = await chromium.launch({ executablePath:CHROME });
  const ctx = await browser.newContext({ viewport:{ width:420, height:900 } });
  const page = await open(ctx, ORIGIN);
  await wait(2500);

  await page.evaluate(() => { const s = document.querySelector("#obskip"); if(s) s.click(); });
  await wait(700);
  ok("the intro can be skipped and the auth screen arrives",
     await page.evaluate(() => /Begin|waiting for you/.test(document.querySelector("#ob-sheet").textContent)));

  await page.evaluate(() => document.querySelector("#ob-sheet [data-p]").click());
  await wait(500);
  await page.evaluate(() => {
    const i = document.querySelector("#ob-sheet input");
    if(i) i.value = "max" + Date.now();
    const go = document.querySelector("#ob-sheet .btn.go");
    if(go) go.click();
  });
  await wait(900);
  ok("and it asks who you are", await page.evaluate(() => !!document.querySelector("#ob-dob")),
     await page.evaluate(() => Onboard.step));

  /* ---- the age gate ---- */
  await page.evaluate(() => {
    document.querySelector("#ob-name").value = "Kid";
    document.querySelector("#ob-dob").value = "2014-01-01";
    document.querySelector("#ob-next").click();
  });
  await wait(1400);
  const blocked = await page.evaluate(async () => {
    const me = await Api.call("GET", "/nests/mine");
    return { step:Onboard.step, name:me.user.display_name, dob:me.user.birthdate,
             flag:me.user.age_blocked, signOut:!!document.querySelector("#ob-signout"),
             mail:!!document.querySelector("#ob-sheet a[href^='mailto:']") };
  });
  ok("an under sixteen answer lands on the block screen", blocked.step === "blocked", JSON.stringify(blocked));
  ok("and neither the name nor the date of birth is kept",
     blocked.name === null && blocked.dob === null && blocked.flag === true, JSON.stringify(blocked));
  ok("the screen has a real support address and a way off the device",
     blocked.mail && blocked.signOut);

  await page.evaluate(() => document.querySelector("#ob-signout").click());
  await wait(1000);
  ok("signing out returns to the start",
     await page.evaluate(() => Onboard.step === "auth" || Onboard.step === "cold"),
     await page.evaluate(() => Onboard.step));
  ok("and the browser is not stuck on the block for good",
     !(await page.evaluate(async () => (await Api.call("GET", "/nests/mine")).user)));

  /* ---- an invite link names the person on the other end ---- */
  const code = await page.evaluate(async () => {
    await Api.call("POST", "/auth/session", { provider:"apple", subject:"inviter" + Date.now() });
    await Api.call("POST", "/users/me", { display_name:"Frankie", birthdate:"1990-01-01" });
    return (await Api.call("POST", "/nests", {})).invite.code;
  });
  // the same context, so the invited partner is reading the same local store
  const invited = await open(ctx, ORIGIN + "?j=" + code);
  await wait(2600);
  const seen = await invited.evaluate(() => ({ name:Onboard.inviterName,
    heading:(document.querySelector("#ob-sheet .ob-h") || {}).textContent }));
  ok("an invite link says who invited you",
     /Frankie/.test(seen.heading || "") || seen.name === "Frankie", JSON.stringify(seen));

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
