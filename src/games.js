/* NEST :: the three ways to earn. Logic carried over from the first build,
   dressed to the bible. Balance numbers all live in one object. */
"use strict";

const BALANCE = {
  startingHearts: 320,
  checkInBase: 25, streakBonus: 5, streakBonusCap: 100,
  duelQuestions: 6, duelPerMatch: 15, duelSweepBonus: 30,
  memoryPairs: 6, memoryMax: 60, memoryMin: 10, memoryParMoves: 8, memoryStepPenalty: 5,
};

const QUESTIONS = [
  { q:"Friday night, {A} gets to pick. What happens?", o:["Couch and takeaway","Dinner out","Friends over","Early night"] },
  { q:"{A}'s ideal holiday is...", o:["Beach and nothing","A big city","Hiking somewhere cold","Road trip"] },
  { q:"What does {A} do first thing in the morning?", o:["Check the phone","Coffee","Snooze again","Straight to the shower"] },
  { q:"{A}'s comfort food?", o:["Pizza","Noodles","Chocolate","Toast, honestly"] },
  { q:"Which chore does {A} secretly hate most?", o:["Dishes","Laundry","Bins","Vacuuming"] },
  { q:"How does {A} say sorry?", o:["Words","Food","A hug","Doing the chore"] },
  { q:"{A}'s dream first home?", o:["Beach shack","City apartment","Farmhouse","Tiny cabin"] },
  { q:"What is {A} most likely to overspend on?", o:["Food","Clothes","Gadgets","Trips"] },
  { q:"How early does {A} arrive to things?", o:["Way early","Right on time","Five late","Twenty late"] },
  { q:"{A} in an argument tends to...", o:["Talk it out now","Go quiet","Make a joke","Need a walk"] },
  { q:"Pick {A}'s weekend energy.", o:["Plans all day","One nice thing","Nothing at all","Depends on you"] },
  { q:"{A}'s go to karaoke choice?", o:["A power ballad","Something 2000s","Refuses to sing","Rap, badly"] },
  { q:"What would {A} save from a fire, after you?", o:["Photos","The laptop","A gift from you","The pet"] },
  { q:"{A}'s coffee order?", o:["Flat white","Long black","Something sweet","Tea, actually"] },
  { q:"Which pet would {A} bring home tomorrow?", o:["Dog","Cat","Something small","No pets"] },
  { q:"{A}'s love language leans...", o:["Words","Touch","Gifts","Doing things"] },
  { q:"Best gift {A} ever got from you?", o:["Something handmade","A trip","A surprise","A small daily thing"] },
  { q:"{A} plans a date. Budget is nothing. So...", o:["Picnic","Long drive","Cook at home","Free gig"] },
  { q:"What is {A} watching when you are not home?", o:["Reality TV","A documentary","Old comfort show","Sport"] },
  { q:"{A}'s biggest ick in a house?", o:["Mess","Bad lighting","Loud neighbours","No natural light"] },
  { q:"How does {A} sleep?", o:["Starfish","Curled up","Half off the bed","Clinging to you"] },
  { q:"{A} would rather give up...", o:["Coffee","Streaming","Social media","Dessert"] },
  { q:"On a plane, {A} picks...", o:["Window","Aisle","Whatever is free","Whatever you do not want"] },
  { q:"{A}'s reaction to a surprise party?", o:["Loves it","Hates it","Fake loves it","Cries"] },
  { q:"Which room matters most to {A}?", o:["Kitchen","Bedroom","Living room","Outside"] },
  { q:"{A}'s texting style?", o:["Paragraphs","One word","Voice notes","Memes only"] },
  { q:"If {A} won money, first move?", o:["Save it","A trip","Pay off things","Something silly"] },
  { q:"{A} is hungry and tired. Best fix?", o:["Snack","Nap","Both, in order","Being left alone"] },
  { q:"What makes {A} laugh hardest?", o:["Your impressions","Animal videos","Dark humour","Bad puns"] },
  { q:"{A}'s hidden talent?", o:["Cooking","Remembering everything","Directions","Making friends fast"] },
  { q:"Sunday morning, {A} wants...", o:["A sleep in","Breakfast out","A walk","Chores done early"] },
  { q:"{A}'s worst habit, admitted?", o:["Being late","Interrupting","Leaving cups everywhere","Doomscrolling"] },
  { q:"Which season is {A}?", o:["Summer","Autumn","Winter","Spring"] },
  { q:"{A} decorates the home in...", o:["Warm and cosy","Clean and minimal","Colour everywhere","Plants everywhere"] },
  { q:"How does {A} handle a bad day?", o:["Talk about it","Distraction","Sleep","Food"] },
  { q:"What does {A} think you do best?", o:["Listen","Make them laugh","Look after them","Push them"] },
];

/* Memory match uses real props as its faces, so even the filler game is
   made of the same workshop. */
const MEMORY_FACES = ["plant","cat","flowers","bake","lamp","tulips","guitar","coffee"];

let activeGame = null;

function currentStreak(){
  const last = state.streak.lastCheckIn;
  if(!last) return 0;
  return daysSince(last) <= 1 ? state.streak.count : 0;
}
function daysSince(dateStr){
  if(!dateStr) return 999;
  const a = new Date(dateStr + "T00:00:00").getTime();
  const b = new Date(today() + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}
function rollCheckinDay(){
  const d = today();
  if(state.streak.day !== d){ state.streak.day = d; state.streak.a = false; state.streak.b = false; }
}
function maybeCompleteCheckin(){
  const d = today();
  if(state.streak.lastCheckIn === d) return;
  if(!(state.streak.a && state.streak.b)) return;
  state.streak.count = daysSince(state.streak.lastCheckIn) === 1 ? state.streak.count + 1 : 1;
  state.streak.lastCheckIn = d;
  const bonus = Math.min(BALANCE.streakBonus * state.streak.count, BALANCE.streakBonusCap);
  state.stats.gamesPlayed++;
  earn(BALANCE.checkInBase + bonus, "day " + state.streak.count + " together");
  refreshWorld();
}

const GAMES = {
  checkin: {
    id:"checkin", title:"Daily check in", blurb:"Both of you, once a day. The weather in the dome follows this.",
    render(root){
      rollCheckinDay();
      const s = state.streak, doneToday = s.lastCheckIn === today();
      const next = BALANCE.checkInBase + Math.min(BALANCE.streakBonus * (currentStreak() + 1), BALANCE.streakBonusCap);
      root.appendChild(el(`<div class="card">
        <div class="spread"><div><p class="h">Day ${currentStreak()}</p>
        <p class="s dim">${doneToday ? "Claimed for today. The dome keeps its light until tomorrow." : "Both tap in to claim " + next + " hearts"}</p></div>
        <span class="chip warm">${currentStreak()} day streak</span></div>
        <div class="checks"></div></div>`));
      const checks = root.querySelector(".checks");
      [["a", state.couple.partnerA], ["b", state.couple.partnerB]].forEach(([key, name]) => {
        const on = s[key] || doneToday;
        const b = el(`<button class="check" data-on="${on ? 1 : 0}"><span class="tick">${on ? "✓" : ""}</span><span>${esc(name)}</span></button>`);
        b.onclick = () => {
          if(doneToday) return toast("Already claimed today");
          s[key] = !s[key];
          maybeCompleteCheckin();
          save(); render();
        };
        checks.appendChild(b);
      });
    },
  },

  duel: {
    id:"duel", title:"Trivia duel", blurb:"One answers, the other guesses. Pass the phone over.",
    render(root){
      if(!activeGame || activeGame.type !== "duel") return this.start(root);
      const g = activeGame;
      const askName = g.answerer === "A" ? state.couple.partnerA : state.couple.partnerB;
      const guessName = g.answerer === "A" ? state.couple.partnerB : state.couple.partnerA;

      if(g.phase === "answer" || g.phase === "guess"){
        const q = g.qs[g.i];
        const who = g.phase === "answer" ? askName : guessName;
        const prompt = g.phase === "answer" ? q.q.replace("{A}", askName)
          : "What did " + askName + " say? " + q.q.replace("{A}", askName);
        root.appendChild(el(`<div class="card">
          <div class="spread"><span class="chip">${esc(who)}</span><span class="s dim">${g.i + 1} of ${g.qs.length}</span></div>
          <div class="bar"><i style="width:${(g.i / g.qs.length) * 100}%"></i></div>
          <p class="h" style="margin-top:10px">${esc(prompt)}</p><div class="opts"></div></div>`));
        const opts = root.querySelector(".opts");
        q.o.forEach((text, idx) => {
          const b = el(`<button class="opt">${esc(text)}</button>`);
          b.onclick = () => {
            (g.phase === "answer" ? g.answers : g.guesses).push(idx);
            g.i++;
            if(g.i >= g.qs.length){
              if(g.phase === "answer"){ g.phase = "handoff"; g.i = 0; }
              else { g.phase = "done"; GAMES.duel.finish(); }
            }
            render();
          };
          opts.appendChild(b);
        });
        return;
      }
      if(g.phase === "handoff"){
        root.appendChild(el(`<div class="card mid">
          <p class="h">Pass the phone to ${esc(guessName)}</p>
          <p class="s dim">${esc(askName)}, no coaching from over there.</p>
          <button class="btn go" id="ready">I am ${esc(guessName)}, ready</button></div>`));
        root.querySelector("#ready").onclick = () => { g.phase = "guess"; render(); };
        return;
      }
      if(g.phase === "done"){
        const matches = g.guesses.filter((v, i) => v === g.answers[i]).length;
        root.appendChild(el(`<div class="card mid">
          <p class="big">${matches} of ${g.qs.length}</p>
          <p class="s dim">${matches >= 5 ? "You two are unbearable." : matches >= 3 ? "Solid. Room to grow." : "Worth a proper conversation."}</p></div>`));
        const list = el(`<div class="card"></div>`);
        g.qs.forEach((q, i) => {
          const hit = g.guesses[i] === g.answers[i];
          list.appendChild(el(`<div class="line">
            <p class="s dim">${esc(q.q.replace("{A}", askName))}</p>
            <p class="s"><b class="${hit ? "good" : "miss"}">${hit ? "matched" : "missed"}</b> said <b>${esc(q.o[g.answers[i]])}</b>${
              hit ? "" : ', guessed <span class="dim">' + esc(q.o[g.guesses[i]]) + "</span>"}</p></div>`));
        });
        root.appendChild(list);
        const again = el(`<button class="btn go">Play again</button>`);
        again.onclick = () => { activeGame = null; render(); };
        root.appendChild(again);
        return;
      }
      this.start(root);
    },
    start(root){
      const pool = [...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, BALANCE.duelQuestions);
      activeGame = { type:"duel", phase:"answer", qs:pool, i:0, answers:[], guesses:[],
        answerer: state.stats.duelsPlayed % 2 === 0 ? "A" : "B" };
      const who = activeGame.answerer === "A" ? state.couple.partnerA : state.couple.partnerB;
      root.appendChild(el(`<div class="card mid">
        <p class="h">${esc(who)} goes first</p>
        <p class="s dim">Answer ${BALANCE.duelQuestions} questions about yourself, then hand the phone over.</p>
        <button class="btn go" id="begin">Start</button></div>`));
      root.querySelector("#begin").onclick = () => render();
    },
    finish(){
      const g = activeGame;
      const matches = g.guesses.filter((v, i) => v === g.answers[i]).length;
      let reward = matches * BALANCE.duelPerMatch;
      if(matches === g.qs.length) reward += BALANCE.duelSweepBonus;
      state.stats.duelsPlayed++; state.stats.gamesPlayed++;
      state.stats.bestDuel = Math.max(state.stats.bestDuel, matches);
      if(reward > 0) earn(reward, "trivia duel"); else save();
    },
  },

  memory: {
    id:"memory", title:"Memory match", blurb:"Solo filler. Fewer moves, more hearts.",
    render(root){
      if(!activeGame || activeGame.type !== "memory") this.start();
      const g = activeGame;
      root.appendChild(el(`<div class="card">
        <div class="spread"><p class="h" style="margin:0">${g.moves} moves</p>
        <span class="chip">${g.finished ? "done" : "par " + BALANCE.memoryParMoves}</span></div>
        <div class="mgrid"></div></div>`));
      const grid = root.querySelector(".mgrid");
      g.cards.forEach((c, i) => {
        const face = (c.up || c.done) ? `<img src="${Offscreen.icon(c.id, 96)}" alt="">` : "";
        const b = el(`<button class="mcard" data-up="${c.up ? 1 : 0}" data-done="${c.done ? 1 : 0}">${face}</button>`);
        b.onclick = () => this.flip(i);
        grid.appendChild(b);
      });
      if(g.finished){
        root.appendChild(el(`<div class="card mid"><p class="big">${g.reward}</p><p class="s dim">hearts, in ${g.moves} moves</p></div>`));
        const again = el(`<button class="btn go">Play again</button>`);
        again.onclick = () => { activeGame = null; render(); };
        root.appendChild(again);
      }
    },
    start(){
      const faces = [...MEMORY_FACES].sort(() => Math.random() - 0.5).slice(0, BALANCE.memoryPairs);
      const cards = [...faces, ...faces].map(id => ({ id, up:false, done:false })).sort(() => Math.random() - 0.5);
      activeGame = { type:"memory", cards, first:null, moves:0, matched:0, lock:false, finished:false, reward:0 };
    },
    flip(i){
      const g = activeGame, c = g.cards[i];
      if(g.lock || g.finished || c.up || c.done) return;
      c.up = true;
      if(g.first === null){ g.first = i; render(); return; }
      g.moves++;
      const a = g.cards[g.first];
      if(a.id === c.id){
        a.done = c.done = true; a.up = c.up = false;
        g.first = null; g.matched++;
        if(g.matched === BALANCE.memoryPairs){
          g.finished = true;
          const over = Math.max(0, g.moves - BALANCE.memoryParMoves);
          g.reward = Math.max(BALANCE.memoryMin, BALANCE.memoryMax - over * BALANCE.memoryStepPenalty);
          state.stats.gamesPlayed++;
          earn(g.reward, "memory match");
        }
        render(); return;
      }
      g.lock = true;
      render();
      setTimeout(() => { a.up = false; c.up = false; g.first = null; g.lock = false; render(); }, 720);
    },
  },
};
