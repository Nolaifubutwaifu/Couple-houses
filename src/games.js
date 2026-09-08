/* NEST :: the daily loop and the two side games.
   Every number lives in BALANCE. The caps matter as much as the payouts:
   without them the whole catalogue can be bought in an afternoon, and a home
   that can be finished in an afternoon records nothing. */
"use strict";

const BALANCE = {
  startingCoins: 260,

  /* The ritual. Once a day, both partners, and the only thing that grows the
     streak. Deliberately the best rate in the game per second spent. */
  ritualBase: 30, ritualStreakStep: 3, ritualStreakCap: 60,

  /* The duel. Once a day. Rewards knowing each other, not grinding. */
  duelPerDay: 1, duelQuestions: 6, duelPerMatch: 12, duelSweepBonus: 20,

  /* Memory. Filler for one person alone, so it pays least and caps soonest. */
  memoryPerDay: 2, memoryPairs: 6, memoryMax: 30, memoryMin: 8,
  memoryParMoves: 8, memoryStepPenalty: 3,
};

/* Asked once a day, the same question for both partners. Light, answerable in
   two seconds, and about today rather than about the relationship in the
   abstract, because this one runs every single day for years. */
const RITUAL_QUESTIONS = [
  { q:"What would make today better?", o:["A long walk","Something sweet","An early night","Ten quiet minutes"] },
  { q:"How is today going, honestly?", o:["Good","Fine","Heavy","Ask me later"] },
  { q:"What do you need most tonight?", o:["Quiet","Company","Food","To be listened to"] },
  { q:"Where should we go, if we could go anywhere?", o:["Somewhere warm","Somewhere quiet","Somewhere loud","Home, honestly"] },
  { q:"What is the best thing that happened today?", o:["Something at work","Something small","A message","Nothing yet"] },
  { q:"Pick tonight.", o:["Cook together","Order in","Out somewhere","Separate and easy"] },
  { q:"What is on your mind that you have not said?", o:["Work","Money","Family","Nothing heavy"] },
  { q:"How did you sleep?", o:["Like a log","Badly","Woke up a lot","Not enough"] },
  { q:"What would you rather be doing right now?", o:["This","Sleeping","Outside","Something ambitious"] },
  { q:"What should we do this weekend?", o:["Absolutely nothing","See people","Go somewhere","Fix the house"] },
  { q:"Which of us is more tired today?", o:["Me","You","Both of us","Neither"] },
  { q:"What is the next thing we should save for?", o:["A trip","The home","Something fun","Just save"] },
  { q:"How affectionate are you feeling?", o:["Very","A normal amount","Low battery","Ask me after food"] },
  { q:"Pick a small treat for tonight.", o:["Chocolate","A bath","A show","A phone call to no one"] },
  { q:"What is annoying you today?", o:["Work","The house","Nothing much","I would rather not"] },
  { q:"Which do you want more of this week?", o:["Time together","Time alone","Sleep","Fun"] },
  { q:"What did you think about today that made you smile?", o:["Something we did","Something you said","A memory","Something silly"] },
  { q:"If tonight had a soundtrack it would be...", o:["Calm","Loud","Sad and lovely","Silence"] },
  { q:"How is your week going?", o:["Better than expected","About right","Too long already","Do not ask"] },
  { q:"What would help most right now?", o:["A hug","A plan","A nap","Being left alone"] },
  { q:"Pick the season you feel like today.", o:["Spring","Summer","Autumn","Winter"] },
  { q:"What are you looking forward to?", o:["This weekend","A trip","Nothing in particular","Getting through the week"] },
  { q:"What should we eat tonight?", o:["Something quick","Something good","Whatever is in","Out"] },
  { q:"How much social battery do you have?", o:["Full","Half","Empty","Do not make me"] },
  { q:"What is one thing you did well today?", o:["Got through it","Something at work","Something kind","Rested"] },
  { q:"What do you want from me today?", o:["Patience","A laugh","Help with something","Just be about"] },
  { q:"Pick a place we should walk to.", o:["Water","Trees","The shops","Nowhere, stay in"] },
  { q:"What have you been putting off?", o:["A message","A chore","A decision","A conversation"] },
  { q:"How romantic are you feeling, out of four?", o:["One","Two","Three","Four"] },
  { q:"What is the house missing?", o:["Plants","Light","Space","Nothing, it is good"] },
  { q:"When did you last properly laugh?", o:["Today","Yesterday","Cannot remember","Right now"] },
  { q:"What would a perfect evening look like?", o:["The couch","Out with people","Something new","Early bed"] },
  { q:"Which do you want tonight?", o:["To talk","To be quiet","To be silly","To sleep"] },
  { q:"How is your body today?", o:["Good","Achy","Tired","Ignoring it"] },
  { q:"What is a small thing I could do for you?", o:["Make tea","Take a job off me","Sit with me","Nothing needed"] },
  { q:"What should we do more of?", o:["Cooking","Walking","Going out","Doing nothing"] },
  { q:"Pick the weather that matches your mood.", o:["Bright","Overcast","Storm","Still and warm"] },
  { q:"What is worth celebrating this week?", o:["Something at work","Getting through it","Something we did","Nothing yet"] },
  { q:"How long since we had a proper conversation?", o:["Today","A few days","Too long","We are having one"] },
  { q:"What do you want the weekend to feel like?", o:["Slow","Full","Adventurous","Productive"] },
];

/* The duel. One partner answers about themselves, the other guesses. These
   have to be guessable by someone who knows you, which is a different bar
   from the ritual questions. */
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
  { q:"{A}'s position on mornings?", o:["Loves them","Tolerates them","Hates them","Never sees them"] },
  { q:"What does {A} do at a party?", o:["Works the room","Finds one person","Helps in the kitchen","Leaves early"] },
  { q:"{A}'s guilty pleasure?", o:["Trash TV","Fast food","Online shopping","Naps"] },
  { q:"How does {A} pack for a trip?", o:["Weeks early","Night before","In the taxi","Makes you do it"] },
  { q:"{A}'s driving?", o:["Calm","Fast","Anxious","Does not drive"] },
  { q:"What would {A} spend a free Saturday on?", o:["A project","Friends","Sleeping","You"] },
  { q:"{A}'s idea of a big night?", o:["Out until late","Dinner with friends","Two drinks","Staying in"] },
  { q:"Which does {A} check first in the morning?", o:["Messages","News","Nothing","The weather"] },
  { q:"{A} is stressed. What actually helps?", o:["A plan","A distraction","Being held","Being alone"] },
  { q:"What does {A} always forget?", o:["Keys","Names","To eat","To reply"] },
  { q:"How does {A} feel about camping?", o:["Loves it","Would try","Absolutely not","Only with a bed"] },
  { q:"{A}'s favourite thing about where you live?", o:["The place itself","The people","Being near family","Nothing, let us move"] },
  { q:"What does {A} want more of?", o:["Time","Money","Sleep","Adventure"] },
  { q:"{A} at a restaurant?", o:["Orders first","Agonises","Asks the waiter","Copies you"] },
  { q:"Which would {A} rather lose?", o:["Their phone","Their sense of taste","A week of sleep","Their favourite jumper"] },
  { q:"{A}'s take on birthdays?", o:["Big fuss","Small and nice","Ignore it","Depends on the year"] },
  { q:"How does {A} watch a film?", o:["Full attention","Second screen","Falls asleep","Talks through it"] },
  { q:"What is {A}'s most used emoji?", o:["The crying one","A heart","Thumbs up","None, they use words"] },
  { q:"{A} has an hour free. They...", o:["Read","Scroll","Tidy","Message someone"] },
  { q:"What would {A} put in the garden first?", o:["A tree","Somewhere to sit","Flowers","A firepit"] },
  { q:"{A}'s attitude to plans?", o:["Makes them","Follows them","Cancels them","Forgets them"] },
  { q:"What does {A} miss most about being younger?", o:["The free time","The friends","The energy","Nothing"] },
  { q:"How does {A} take criticism?", o:["Well","Quietly, then badly","Argues","Takes it to heart"] },
  { q:"{A} would describe your home as...", o:["Cosy","A work in progress","Cluttered","Just right"] },
];

/* Memory match uses real props as its faces, so even the filler game is
   made of the same workshop. */
const MEMORY_FACES = ["plant","cat","flowers","bake","lamp","tulips","guitar","coffee"];

let activeGame = null;

/* ---- the day, and the caps that hang off it ---- */
function today(){ return new Date().toISOString().slice(0, 10); }
function daysSince(dateStr){
  if(!dateStr) return 999;
  const a = new Date(dateStr + "T00:00:00").getTime();
  const b = new Date(today() + "T00:00:00").getTime();
  return Math.round((b - a) / 86400000);
}
function currentStreak(){
  const last = state.streak.lastCheckIn;
  if(!last) return 0;
  return daysSince(last) <= 1 ? state.streak.count : 0;
}
function rollDay(){
  const d = today();
  if(!state.daily) state.daily = { day:null, duel:0, memory:0 };
  if(state.daily.day !== d){ state.daily = { day:d, duel:0, memory:0 }; }
  if(state.streak.day !== d){ state.streak.day = d; state.streak.a = false; state.streak.b = false;
                              state.streak.aAns = null; state.streak.bAns = null; }
}
function playsLeft(game){
  rollDay();
  if(game === "duel") return BALANCE.duelPerDay - state.daily.duel;
  if(game === "memory") return BALANCE.memoryPerDay - state.daily.memory;
  return state.streak.lastCheckIn === today() ? 0 : 1;
}
function spendPlay(game){
  rollDay();
  if(game === "duel") state.daily.duel++;
  if(game === "memory") state.daily.memory++;
}

/* the same question for both partners, stable for the whole day */
function ritualToday(){
  const key = today() + (state.nest_id || "");
  let h = 0;
  for(let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return RITUAL_QUESTIONS[h % RITUAL_QUESTIONS.length];
}
function completeRitual(){
  const d = today();
  if(state.streak.lastCheckIn === d) return;
  if(state.streak.aAns === null || state.streak.bAns === null) return;
  state.streak.count = daysSince(state.streak.lastCheckIn) === 1 ? state.streak.count + 1 : 1;
  state.streak.lastCheckIn = d;
  const bonus = Math.min(BALANCE.ritualStreakStep * state.streak.count, BALANCE.ritualStreakCap);
  state.stats.gamesPlayed++;
  state.bond = (state.bond || 0) + 1;
  earn(BALANCE.ritualBase + bonus, "day " + state.streak.count + " together");
  refreshWorld();
}

function capNote(game){
  const left = playsLeft(game);
  if(left > 0) return left === 1 ? "1 play left today" : left + " plays left today";
  return "Back tomorrow";
}

const GAMES = {
  ritual: {
    id:"ritual", title:"Today's question", blurb:"One question, both of you, once a day. This is the streak.",
    render(root){
      rollDay();
      const s = state.streak, q = ritualToday(), done = s.lastCheckIn === today();
      const next = BALANCE.ritualBase + Math.min(BALANCE.ritualStreakStep * (currentStreak() + 1), BALANCE.ritualStreakCap);
      root.appendChild(el(`<div class="card">
        <div class="spread"><span class="chip warm">${currentStreak()} day streak</span>
          <span class="s dim">${done ? "answered today" : "+" + next + " coins"}</span></div>
        <p class="h" style="margin-top:10px">${esc(q.q)}</p>
        <div class="ritual" id="rit"></div></div>`));
      const host = root.querySelector("#rit");
      [["a", state.couple.partnerA], ["b", state.couple.partnerB]].forEach(([key, name]) => {
        const ans = s[key + "Ans"];
        if(ans !== null && ans !== undefined){
          host.appendChild(el(`<div class="answered"><b>${esc(name)}</b><span>${esc(q.o[ans])}</span></div>`));
          return;
        }
        const row = el(`<div class="waiting"><b>${esc(name)}</b>
          <button class="btn sm">${done ? "missed it" : "Answer"}</button></div>`);
        row.querySelector("button").onclick = () => {
          if(done) return;
          this.ask(root, key, name, q);
        };
        host.appendChild(row);
      });
      if(s.aAns !== null && s.aAns !== undefined && s.bAns !== null && s.bAns !== undefined){
        const same = s.aAns === s.bAns;
        root.appendChild(el(`<div class="card mid"><p class="h">${
          same ? "You said the same thing." : "Two different answers."}</p>
          <p class="s dim">${same ? "That is worth something." : "Worth asking about."}</p></div>`));
      }
    },
    ask(root, key, name, q){
      const s = this;
      const sheet = $("#sheet");
      sheet.innerHTML = "";
      sheet.appendChild(el(`<div class="card"><span class="chip">${esc(name)}</span>
        <p class="h" style="margin-top:10px">${esc(q.q)}</p><div class="opts" id="ro"></div></div>`));
      q.o.forEach((text, i) => {
        const b = el(`<button class="opt">${esc(text)}</button>`);
        b.onclick = () => {
          state.streak[key + "Ans"] = i;
          state.streak[key] = true;
          completeRitual();
          save(); render();
        };
        sheet.querySelector("#ro").appendChild(b);
      });
    },
  },

  duel: {
    id:"duel", title:"Trivia duel", blurb:"One answers, the other guesses. Once a day.",
    render(root){
      if(!activeGame || activeGame.type !== "duel"){
        if(playsLeft("duel") <= 0){
          root.appendChild(el(`<div class="card mid"><p class="h">Played today</p>
            <p class="s dim">The duel comes back tomorrow. Grinding it would make the
            house a stopwatch instead of a record.</p></div>`));
          return;
        }
        return this.start(root);
      }
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
        root.appendChild(el(`<p class="s dim mid">Back tomorrow.</p>`));
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
      spendPlay("duel");
      state.stats.duelsPlayed++; state.stats.gamesPlayed++;
      state.stats.bestDuel = Math.max(state.stats.bestDuel, matches);
      if(reward > 0) earn(reward, "trivia duel"); else save();
    },
  },

  memory: {
    id:"memory", title:"Memory match", blurb:"For when you are on your own. Twice a day.",
    render(root){
      if((!activeGame || activeGame.type !== "memory") && playsLeft("memory") <= 0){
        root.appendChild(el(`<div class="card mid"><p class="h">That is both plays</p>
          <p class="s dim">Memory is the filler, so it caps soonest. The real earning
          is the two of you.</p></div>`));
        return;
      }
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
        root.appendChild(el(`<div class="card mid"><p class="big">${g.reward}</p>
          <p class="s dim">coins, in ${g.moves} moves · ${capNote("memory")}</p></div>`));
        if(playsLeft("memory") > 0){
          const again = el(`<button class="btn go">Play again</button>`);
          again.onclick = () => { activeGame = null; render(); };
          root.appendChild(again);
        }
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
          spendPlay("memory");
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
