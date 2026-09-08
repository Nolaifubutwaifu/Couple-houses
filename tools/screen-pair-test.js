/* Two browsers, driven through the actual screens: real taps on real
   buttons, real typing into the code boxes, and nothing polled by the
   harness. The last suite asserted that the database would answer if asked,
   which it always would; what it never asked was whether the founder's
   screen bothers to ask. It did not, and nobody found out until a person
   sat looking at a code that never did anything. */
const { chromium } = require("/tmp/claude-0/-home-user-Couple-houses/a4be0025-710d-52b8-9ec5-b63856445aec/scratchpad/node_modules/playwright");

const ORIGIN = "http://127.0.0.1:8811/index.html";
const pass = [], fail = [];
const ok = (n, c, note) => { const l = n + (note ? " :: " + note : ""); (c ? pass : fail).push(l);
  console.log((c ? "  ok   " : "  FAIL ") + l); };
const sheetText = page => page.evaluate(() => document.querySelector("#ob-sheet").innerText);

async function person(browser, tag){
  const ctx = await browser.newContext({ ignoreHTTPSErrors:true });
  const page = await ctx.newPage();
  page.on("pageerror", e => console.log("  [" + tag + " pageerror]", e.message));
  page.on("console", m => { if(m.type() === "error") console.log("  [" + tag + " err]", m.text().slice(0,200)); });
  await page.addInitScript(() => {
    window.NEST_CONFIG = { url:location.origin, lib:"/_lib/supabase.js", probeMs:15000, pollMs:1500 };
  });
  await page.goto(ORIGIN + "?as=" + tag);
  await page.waitForFunction(() => typeof Onboard !== "undefined" && Onboard.step, null, { timeout:25000 });
  return { page, ctx };
}

/* everything below is what a thumb does, in order */
async function signUp(p, name, birthdate){
  await p.page.waitForSelector("#ob-sheet [data-p='guest']", { timeout:20000 });
  await p.page.click("#ob-sheet [data-p='guest']");
  await p.page.waitForSelector("#ob-name", { timeout:20000 });
  await p.page.fill("#ob-name", name);
  await p.page.fill("#ob-dob", birthdate);
  await p.page.click("#ob-next");
}

(async () => {
  const browser = await chromium.launch({
    executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args:["--proxy-server=" + (process.env.HTTPS_PROXY || ""),
          "--proxy-bypass-list=127.0.0.1;localhost", "--ignore-certificate-errors"],
  });
  const A = await person(browser, "s1"), B = await person(browser, "s2");
  ok("both browsers reached the sign in screen on the backend",
     await A.page.evaluate(() => !!Api.backend && Onboard.ways()[0] === "guest"),
     await A.page.evaluate(() => Backend.reason));

  await signUp(A, "Ada", "1994-04-02");
  await signUp(B, "Bo", "1993-08-19");
  ok("both got through sign in with two taps and a name",
     await A.page.evaluate(() => !!Backend.uid) && await B.page.evaluate(() => !!Backend.uid));

  /* A founds a nest and then does nothing at all: no share, no tap. This is
     the person reading the code down the phone. */
  await A.page.waitForSelector("#ob-invite", { timeout:20000 });
  await A.page.click("#ob-invite");
  await A.page.waitForFunction(() => Onboard.step === "invite", null, { timeout:25000 });
  const code = await A.page.evaluate(() => Onboard.ctx.invite.code);
  ok("A is on the invite screen with a code", /^[A-Z2-9]{6}$/.test(code || ""), code);

  /* B types it in, the way a person does */
  await B.page.waitForSelector("#ob-redeem", { timeout:20000 });
  await B.page.click("#ob-redeem");
  await B.page.waitForSelector("#ob-code .ob-box", { timeout:20000 });
  const boxes = await B.page.$$("#ob-code .ob-box");
  for(let i = 0; i < 6; i++){ await boxes[i].click(); await boxes[i].type(code[i]); }
  await B.page.waitForFunction(() => Onboard.step === "awaitConfirm", null, { timeout:25000 });
  ok("B is told to wait for A", /waiting for ada/i.test(await sheetText(B.page)),
     (await sheetText(B.page)).split("\n")[0]);

  /* THE BUG: A has touched nothing since founding. Does A's screen find out
     on its own? Nothing in this test asks the database on A's behalf. */
  const asked = await A.page.waitForFunction(
    () => Onboard.step === "confirm", null, { timeout:30000 }).then(() => true).catch(() => false);
  ok("A's screen offers the confirmation without A doing anything", asked,
     asked ? "" : "still on step " + await A.page.evaluate(() => Onboard.step));
  if(asked) ok("and it names the person asking to join", /bo wants to join/i.test(await sheetText(A.page)),
     (await sheetText(A.page)).split("\n")[0]);

  /* A taps yes, and B finds out on its own too */
  if(asked){
    const t0 = Date.now();
    await A.page.click("#ob-yes");
    const bIn = await B.page.waitForFunction(
      () => Onboard.step === "ceremony" || Onboard.step === "nameNest" || !document.body.classList.contains("onboarding"),
      null, { timeout:90000, polling:250 }).then(() => true).catch(() => false);
    console.log("       (B learned in " + (Date.now() - t0) + "ms)");
    ok("B's screen moves on without B doing anything", bIn,
       bIn ? "" : JSON.stringify(await B.page.evaluate(async () => {
         const me = await Api.call("GET", "/nests/mine").catch(e => ({ err:e.message }));
         return { step:Onboard.step, pollRunning:!!Onboard._poll,
                  nest:me.nest && me.nest.status, membership:me.membership && me.membership.status,
                  err:me.err };
       })));
    const paired = await A.page.evaluate(async () => {
      const me = await Api.call("GET", "/nests/mine");
      return me.nest && me.nest.status === "active" && me.members.filter(m => m.status === "active").length;
    });
    ok("the nest holds both of them", paired === 2, String(paired));
  }

  await browser.close();
  console.log("\nPASS " + pass.length + "  FAIL " + fail.length);
  fail.forEach(f => console.log("  FAIL " + f));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error("harness error:", e.stack); process.exit(2); });
