/* NEST :: the facts that appear on every public page and inside the app.
   One place, so the contact address and the operator name cannot say two
   different things in two places. Change them here before submitting to an
   app store. */
window.NEST_SITE = {
  product:  "NEST",
  operator: "Taiga Projects",
  // PLACEHOLDER: replace with the inbox that will actually be read
  contact:  "support@example.com",
  country:  "Australia",
  governingLaw: "Queensland, Australia",
  minAge:   16,
  effective: "15 September 2026",
  appUrl:   "https://couple-houses.vercel.app",
};

/* Fill in any element that asks for one of the values above, so the pages
   can be plain HTML with a data attribute where a fact goes. */
(function(){
  function fill(){
    var s = window.NEST_SITE;
    document.querySelectorAll("[data-site]").forEach(function(el){
      var key = el.getAttribute("data-site"), v = s[key];
      if(v === undefined) return;
      if(el.tagName === "A" && key === "contact"){ el.href = "mailto:" + v; }
      el.textContent = v;
    });
    document.querySelectorAll("[data-mailto]").forEach(function(el){
      el.href = "mailto:" + s.contact + "?subject=" + encodeURIComponent(el.getAttribute("data-mailto"));
    });
  }
  if(typeof document === "undefined") return;
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", fill); else fill();
})();
