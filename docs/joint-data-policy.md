# Joint data, leaving and deletion

Decision record. Written before the schema, because retrofitting any of it
means migrating exactly the data people are angry about.

Status: decided, and implemented in the prototype. Signed off 4 September 2026.

## The problem

Two people jointly create one object. When one asks to be erased, the other has
an equal claim to the same record: the home they built, the streak, the answers
they gave each other. Under GDPR both requests are legitimate and they conflict.
Most products dodge this by pretending the data belongs to whoever asks first.

## The decisions

**A nest freezes. It is never inherited and never destroyed by one person.**

When either partner leaves, or deletes their account, the nest becomes read
only for both of them. Nothing is removed. Neither can place, earn, rename or
publish it again. Both keep the ability to look at it, and both are free to
start a new nest with someone else.

We considered handing the home to whoever stayed, and destroying it outright.
Handing it over makes one person the owner of something two people made.
Destroying it lets one person delete a year of someone else's life without
their consent. Freezing is the only option where neither party can act
unilaterally against the other.

**Personal data is erased. Joint creative output is not.**

On deletion the leaver's name, birthday, authentication identity, push token
and their own ritual answers are erased and cannot be recovered. Their name is
removed from the nest wherever it appeared. The furniture placements, the
streak record and the nest itself remain, because they are the product of two
people and the other one did not ask to be forgotten.

The test for which side a field falls on: could one person have produced it
alone? Their answers, yes, so they go. The home, no, so it stays.

**Leaving is one neutral action, not a breakup flow.**

There is no separate ending ceremony. Leaving is leaving, whatever the reason,
with the same explanation and the same confirmation. We are not going to
presume why someone is going, and a product that stages the moment risks
performing grief at somebody having a perfectly ordinary Tuesday.

What the single action does owe the person is a plain account of what is about
to happen, before it happens, in more room than a dialog gives. That is a
screen, not a modal.

**Deletion is immediate and irreversible.**

No recovery window. A grace period means the data is not actually erased when
we said it was, and we would rather the promise be true. The confirmation is
typing the word, not tapping a button.

## What this looks like in the data

```
Nest    status: pending | active | archived
        archived_at, archived_by, archive_reason: left | deleted
User    deleted: true, and every personal field nulled, identity mapping removed
Game    frozen: true, frozen_at
```

Freezing happens in exactly one function, `freezeNest`, so leaving and deleting
cannot drift apart and neither can skip a step. Membership rows go to `left`,
open invites are revoked, and the game record is marked frozen. The earning and
placement guards read that flag as well as the membership state, so a frozen
nest is inert on both paths.

An archived nest is reachable from settings and from nowhere else. It never
appears in the onboarding flow, so a previous relationship does not greet
somebody starting again.

## Moderation, since it touches the same surface

The street is content one couple publishes for strangers, which Apple's
Guideline 1.2 treats as user generated content. Five things are required and
four of them are code.

- A filter on every piece of text that reaches the street, at publish time
  rather than on input. Rejects slurs, links, email addresses and phone
  numbers, and says which and why.
- A report action on any home, with named reasons. Reporting hides that home
  from the reporter immediately, because nobody should have to keep looking at
  something while a queue is worked through.
- A block action, reversible, per person.
- A published contact, shown on the street itself and not buried.

The fifth is acting within twenty four hours, which is a commitment a team
makes rather than a function anyone can write. The queue that a moderator would
work is there and reports land in it.

## What a real build still has to do

- The word list in the prototype is a placeholder. Real moderation is a service
  that keeps up with how people actually evade one.
- Deletion has to reach backups, analytics, push tokens and any third party
  that received the data, not only the primary store.
- The twenty four hour commitment needs a rota and someone accountable for it.
- Regulators will ask how erasure is proved. Log the deletion, not the data.
