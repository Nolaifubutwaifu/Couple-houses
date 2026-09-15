/* Where Playwright and its browser come from. The suites used to name a path
   inside one particular sandbox, so on any other machine none of them could
   start. NEST_PLAYWRIGHT and NEST_CHROMIUM still win when set; otherwise the
   package from npm install and the browser it downloaded are used. */
"use strict";
const { chromium } = require(process.env.NEST_PLAYWRIGHT || "playwright");
const launchOpts = extra => Object.assign(
  process.env.NEST_CHROMIUM ? { executablePath:process.env.NEST_CHROMIUM } : {}, extra || {});
module.exports = { chromium, launchOpts };
