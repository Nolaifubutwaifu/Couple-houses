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

  /* The duel. Once a day. Rewards knowing each other, not grinding.
     The sweep bonus is gone and the per match rate is down: a perfect duel
     used to pay 92, which is three days of ritual for forty seconds of one
     person tapping through both halves on the same phone. The ritual is
     supposed to be the best rate in the game and now it is again. */
  duelPerDay: 1, duelQuestions: 6, duelPerMatch: 9, duelSweepBonus: 0,

  /* Memory. Filler for one person alone, so it pays least and caps soonest. */
  memoryPerDay: 2, memoryPairs: 6, memoryMax: 30, memoryMin: 8,
  /* Six pairs cannot be cleared in fewer than six moves, and with no lucky
     first flips a perfect memory still needs about ten. A par of eight meant
     nearly every round paid less than the rate this table advertises. */
  memoryParMoves: 10, memoryStepPenalty: 3,
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
/* The couple's day, not Greenwich's. toISOString is UTC, so in Brisbane the
   day turned over at ten in the morning: the streak broke over breakfast and
   the daily caps came back halfway through a morning. */
function localDay(d){
  d = d || new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function today(){ return localDay(); }
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

/* Which row on this screen is yours. The founder is partner A, and there are
   only ever two of them. */
function myRitualKey(){
  const m = App.me && App.me.membership;
  return m && m.role === "partner" ? "b" : "a";
}
function ritualName(key){ return key === "a" ? state.couple.partnerA : state.couple.partnerB; }
function hasAnswered(streak, key){
  const v = streak[key + "Ans"];
  return v !== null && v !== undefined;
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
  // a duel that is under way is not a play left, it is a play happening
  if(game === "duel" && state.duel && state.duel.day === today() && !state.duel.settled)
    return state.duel.phase === "answer" ? "answering now" : "guessing now";
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
      /* Two phones, not one. You answer your own row and nobody else's, and
         you do not see theirs until yours is in. Rendering both rows on
         whichever device opened the screen meant one person could answer for
         both, read their partner's answer first, and take the streak, the
         coins and the payoff line alone in four taps. The reveal is the whole
         point of the ritual, so it waits. */
      const mine = myRitualKey(), theirs = mine === "a" ? "b" : "a";
      const both = hasAnswered(s, "a") && hasAnswered(s, "b");
      [[mine, ritualName(mine), true], [theirs, ritualName(theirs), false]].forEach(([key, name, isMe]) => {
        const ans = s[key + "Ans"];
        if(hasAnswered(s, key)){
          const show = isMe || both;
          host.appendChild(el(`<div class="answered"><b>${esc(name)}</b>
            <span>${show ? esc(q.o[ans]) : "answered"}</span></div>`));
          return;
        }
        if(!isMe){
          host.appendChild(el(`<div class="waiting"><b>${esc(name)}</b>
            <span class="s dim">${done ? "missed it" : "not yet"}</span></div>`));
          return;
        }
        const row = el(`<div class="waiting"><b>${esc(name)}</b>
          <button class="btn sm">${done ? "missed it" : "Answer"}</button></div>`);
        row.querySelector("button").onclick = () => {
          if(done) return;
          go("play", { game:"ritual", asking:true });
        };
        host.appendChild(row);
      });
      /* Answering is a place in the route rather than a sheet drawn over the
         top, so a change from the other phone redraws the question you are
         reading instead of throwing you back to the card behind it. */
      if(route.view && route.view.asking && !done && !hasAnswered(s, mine)){
        host.closest(".card").remove();
        return this.ask(root, mine, ritualName(mine), q);
      }
      if(both){
        const same = s.aAns === s.bAns;
        root.appendChild(el(`<div class="card mid"><p class="h">${
          same ? "You said the same thing." : "Two different answers."}</p>
          <p class="s dim">${same ? "That is worth something." : "Worth asking about."}</p></div>`));
      }
    },
    ask(root, key, name, q){
      const card = el(`<div class="card"><span class="chip">${esc(name)}</span>
        <p class="h" style="margin-top:10px">${esc(q.q)}</p>
        <p class="s dim">Your answer stays hidden until both of you are in.</p>
        <div class="opts" id="ro"></div></div>`);
      q.o.forEach((text, i) => {
        const b = el(`<button class="opt">${esc(text)}</button>`);
        b.onclick = () => {
          rollDay();
          if(hasAnswered(state.streak, key)) return render();     // a double tap is one answer
          state.streak[key + "Ans"] = i;
          state.streak[key] = true;
          route.view = { game:"ritual" };
          completeRitual();
          save(); render();
        };
        card.querySelector("#ro").appendChild(b);
      });
      root.appendChild(card);
    },
  },

  /* The duel, across two phones. It used to run start to finish on whichever
     device opened it, with a "pass the phone" screen in the middle that
     nothing enforced: one person could answer six questions about themselves
     and then guess the answers they had just typed, which is how the whole
     day's earning was swept alone in forty seconds. The round now lives in
     the shared document. You only ever see your own half of it, and the other
     half is your partner's to play on their own phone, which is the same
     product the invite and the pairing already promised. */
  duel: {
    id:"duel", title:"Trivia duel", blurb:"One answers, the other guesses. Once a day.",
    round(){
      rollDay();
      const d = state.duel;
      return d && d.day === today() ? d : null;
    },
    render(root){
      const d = this.round();
      if(!d){
        if(playsLeft("duel") <= 0){
          root.appendChild(el(`<div class="card mid"><p class="h">Played today</p>
            <p class="s dim">The duel comes back tomorrow. Grinding it would make the
            house a stopwatch instead of a record.</p></div>`));
          return;
        }
        return this.start(root);
      }
      const mine = myRitualKey();
      const guessKey = d.answerer === "a" ? "b" : "a";
      const askName = ritualName(d.answerer), guessName = ritualName(guessKey);

      if(d.phase === "done") return this.result(root, d, askName);
      if(d.phase === "answer"){
        if(mine === d.answerer)
          return this.ask(root, d, "answers", askName, q => q.q.replace("{A}", askName));
        return this.waiting(root, esc(askName) + " is answering",
          "Six questions about themselves. You guess them when they are done.");
      }
      if(mine === guessKey)
        return this.ask(root, d, "guesses", guessName,
          q => "What did " + askName + " say? " + q.q.replace("{A}", askName));
      return this.waiting(root, esc(guessName) + " is guessing",
        "They are working out what you said. Nothing to do but wait.");
    },
    /* A screen that waits on somebody else needs a way off it, or a partner
       who never opens the app leaves the day's duel stuck here until midnight.
       Calling it off costs nothing: the play is only spent when a round is
       finished, so the two of you can start again whenever. */
    waiting(root, head, line){
      const card = el(`<div class="card mid"><p class="h">${head}</p>
        <p class="s dim">${esc(line)}</p><div class="ob-pulse"></div>
        <button class="ob-quiet" id="duel-off">Call it off for now</button></div>`);
      card.querySelector("#duel-off").onclick = () => {
        state.duel = null;
        save(); render();
      };
      root.appendChild(card);
    },
    /* One question at a time, and the index is however many are already in,
       so a reload or a second device lands exactly where the round is. */
    ask(root, d, field, who, prompt){
      const i = d[field].length, q = d.qs[i];
      root.appendChild(el(`<div class="card">
        <div class="spread"><span class="chip">${esc(who)}</span>
          <span class="s dim">${i + 1} of ${d.qs.length}</span></div>
        <div class="bar"><i style="width:${(i / d.qs.length) * 100}%"></i></div>
        <p class="h" style="margin-top:10px">${esc(prompt(q))}</p><div class="opts"></div></div>`));
      const opts = root.querySelector(".opts");
      q.o.forEach((text, idx) => {
        const b = el(`<button class="opt">${esc(text)}</button>`);
        b.onclick = () => {
          /* The document this screen was drawn from may already have been
             replaced by one from the other phone. Writing into the old copy
             saved nothing, so the answer is written into the live round, and
             only if it is still the same round at the same question. */
          const cur = this.round();
          if(!cur || cur.qs[0].q !== d.qs[0].q || cur.answerer !== d.answerer) return render();
          if(cur[field].length !== i) return render();   // a double tap is one answer
          cur[field].push(idx);
          if(cur[field].length >= cur.qs.length){
            if(field === "answers") cur.phase = "guess";
            else { cur.phase = "done"; this.settle(cur); }
          }
          save(); render();
        };
        opts.appendChild(b);
      });
    },
    result(root, d, askName){
      const matches = d.guesses.filter((v, i) => v === d.answers[i]).length;
      root.appendChild(el(`<div class="card mid">
        <p class="big">${matches} of ${d.qs.length}</p>
        <p class="s dim">${matches >= 5 ? "You two are unbearable." : matches >= 3 ?
          "Solid. Room to grow." : "Worth a proper conversation."}</p></div>`));
      const list = el(`<div class="card"></div>`);
      d.qs.forEach((q, i) => {
        const hit = d.guesses[i] === d.answers[i];
        list.appendChild(el(`<div class="line">
          <p class="s dim">${esc(q.q.replace("{A}", askName))}</p>
          <p class="s"><b class="${hit ? "good" : "miss"}">${hit ? "Matched" : "Missed"}</b> · ${esc(askName)}
            said <b>${esc(q.o[d.answers[i]])}</b>${
            hit ? "" : ', guessed <span class="dim">' + esc(q.o[d.guesses[i]]) + "</span>"}</p></div>`));
      });
      root.appendChild(list);
      root.appendChild(el(`<p class="s dim mid">Back tomorrow.</p>`));
    },
    start(root){
      const mine = myRitualKey();
      /* Whose turn to answer alternates, and either of you can open the round:
         if it is not your turn to answer, starting it puts the questions on
         your partner's phone rather than on yours. */
      const answerer = state.stats.duelsPlayed % 2 === 0 ? "a" : "b";
      const who = ritualName(answerer);
      root.appendChild(el(`<div class="card mid">
        <p class="h">${esc(who)} goes first</p>
        <p class="s dim">${answerer === mine
          ? "Answer " + BALANCE.duelQuestions + " questions about yourself. " +
            esc(ritualName(answerer === "a" ? "b" : "a")) + " guesses them on their own phone."
          : esc(who) + " answers " + BALANCE.duelQuestions + " questions about themselves on their " +
            "phone, then you guess them on yours."}</p>
        <button class="btn go" id="begin">Start</button></div>`));
      root.querySelector("#begin").onclick = () => {
        if(this.round()) return render();               // their phone got there first
        state.duel = { day:today(), answerer, phase:"answer", settled:false,
          qs:[...QUESTIONS].sort(() => Math.random() - 0.5).slice(0, BALANCE.duelQuestions),
          answers:[], guesses:[] };
        save(); render();
      };
    },
    /* Paid once, by whichever device completed the round. The flag is on the
       shared document, so the other one arriving a moment later pays nothing. */
    settle(d){
      if(d.settled) return;
      d.settled = true;
      const matches = d.guesses.filter((v, i) => v === d.answers[i]).length;
      let reward = matches * BALANCE.duelPerMatch;
      if(matches === d.qs.length) reward += BALANCE.duelSweepBonus;
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
