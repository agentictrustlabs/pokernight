# What other card rooms put in their navigation

Status: research, 2026-09-09. Author: Claude, for Richard Pedersen.
Companion to `docs/WORKSPACES.md`, which specifies the club, the night and the season. This document
does not specify anything. It reports what eleven comparable products actually do with their
navigation, and ends with one recommendation about the context switcher.

The question this was commissioned to answer: a card room has to serve a stranger who wants to play
against bots in the next thirty seconds, and a club member who arrives from an invitation and lives in
a calendar. We were considering a left rail with a context switcher between *you* and *a club*. Sections
1–11 are the sites. Section 12 is what recurs. Section 13 is where they disagree. Section 14 is the
recommendation.

---

## 0. What could and could not be observed

Honesty about the evidence first, because half of what follows is a live observation and half is
documentation, and the two are not worth the same.

**Fetched and read directly:** lichess.org (home, `/faq`, `/team`, `/team/lichess-swiss`);
chess.com (home, `/play`, `/play/computer`, `/clubs`, `/community`, its help centre and its navbar
announcement); worldofcardgames.com (home, `/canasta`); cardzmania.com (home, `/Canasta`);
canastajunction.com (home); trickstercards.com (home, `/features/for-clubs/`, and four help pages);
pokernow.com; one Board Game Arena group page; four Board Game Arena forum threads; Slack's
workspace-switching help article.

**Could not be fetched, and this matters:**

- **Board Game Arena's own application chrome.** `en.boardgamearena.com`, `/gamelist`, `/grouplist`
  and `/newgroup` all return the single-page-app shell and an error string — *"If you see this
  message, it means that your browser failed to load this file"* — with no navigation in the HTML.
  The homepage renders only marketing copy and one button, **"Start playing now"**, pointing at
  `/account?page=newuser`. Everything below about BGA's menus therefore comes from its own forums and
  from URL structure, and is labelled as such. A group page (`/group?id=…`) did render, so §1's
  description of a group page is a live observation.
- **Every first-party PokerStars page.** `pokerstars.com`, `pokerstars.uk` and `pokerstars.net` all
  301 to `fanduel.com` from this network, and `pokerstarsnj.com/help/…` 301s to `support.fanduel.com`.
  `pokerstars.eu` does not resolve at all. **Nothing in §7 is a first-party observation**; it is
  reconstructed from PokerNews, Rakeback, PokerEnergy and a club owner's own instructions page, and
  each claim says which.
- **Discord's help centre** (403 to every `support.discord.com` article) and **Slack's own UI**.
  §9 and §10 are built from Wikipedia, two third-party interface guides, Slack's help article, and
  search results. The Discord server rail is described consistently by all of them, so the shape is
  safe; the fine detail of what a brand-new user with zero servers sees is weaker evidence and is
  flagged where it appears.
- **Canasta Junction's help centre** (403). §4 uses the marketing site, which is detailed, plus their
  own blog post and search results for the lobby.

Where a sentence rests on documentation rather than on a page I loaded, the sentence says so.

---

## 1. Board Game Arena

**Top-level structure.** A horizontal bar, not a rail. Per a long-running forum thread about the
interface, *"Everything to do with games is under the 'PLAY NOW' heading bar. When you click on that
it has three sub-menus labeled 'play in realtime', 'play turn based', and 'watch games in
progress'."* ([forum thread](https://forum.boardgamearena.com/viewtopic.php?t=11701)) That is
documentation-by-user-report, not an observation. What the URL space confirms is the peer set:
`/gamelist`, `/grouplist`, `/group?id=…`, `/newgroup`, `/tournamentlist`, `/player`, `/preferences`.
Groups sit beside games and tournaments as a top-level noun, not inside them.

**Play now.** The logged-out homepage offers exactly one action — **"Start playing now"** — and it
goes to account creation. BGA does not let a stranger play before registering. Once in, the path is
Play now → speed → game → a table. Three or four actions, and the FAQ warns you may find nobody:
*"come back at peak hour (around 22:00 CEST) if you can't find opponents at the moment."*

**Groups.** A group has its own page and its own membership, and the page I loaded showed **About**,
**Recent activity**, **Chat**, a member count (159), and group configuration for privacy, posting and
size. The header carried **Play Now** alongside **Join group** / **Quit group**. Invitation-only
groups state it plainly: *"Only invited players can join this group."* There is **no context
switcher**. You visit a group the way you visit any other page, and nothing about the rest of the
site changes while you are there.

**Scheduling and invitations.** There is no calendar. A group's only mechanical power is to restrict
a table: create a table, do not open it, then *"restrict table access"* → open only to those invited
or with a link → *"restrict to group"* → pick the group from a dropdown
([forum](https://forum.boardgamearena.com/viewtopic.php?p=182243)). Tournaments exist as a separate
top-level object and members are invited one at a time — a group organiser with 250 members wrote,
*"Every week I create a tournament for my group (we are >250 players) and everytime I need to invite
them one by one…"* ([forum](https://forum.boardgamearena.com/viewtopic.php?t=12987)).

**Practice and stakes.** No money anywhere; BGA's stake is ELO and its separation is
rated/unrated per table.

**Steal:** the group page as a *place*, with its own chat, roster and privacy setting, reachable by
URL and not requiring the app to be "in" group mode.
**Avoid:** the group that indexes nothing. BGA's own users are blunt about the result — *"Groups
don't seem super useful…if there's no way for that group to actually see the open game easily"*, and
*"When group members open tables restricted to that group only, there's no way of other group members
knowing about it -- unless they post about it"*
([forum](https://forum.boardgamearena.com/viewtopic.php?t=29027)). A club that cannot show its own
live tables is a label, not a room. This is the single most transferable negative finding in the
whole survey.

---

## 2. World of Card Games

**Top-level structure.** A thin top bar with log in / sign up, and a homepage that is a grid of
eighteen large game tiles. The menu groups games first, then Rules & Guides, Leaderboards, Blog,
Contact. There is no rail and no dashboard: **the game is the top level of the hierarchy**, and
everything else hangs off a chosen game.

**Play now.** Click a game tile, then choose from five labelled entry points on the game page:
**Browse tables**, **Host table**, **Join private table**, **Join ranked table**, **Play bots**. The
Canasta page states *"Canasta is free in your browser with no download and no signup"*, and an
account is *"only necessary for long-term stats and ranked games."* Two actions from the homepage to
a seat, zero of them an account.

**Groups.** **There are none, and that is the interesting part.** A private table is created by
agreeing on a *name*: *"Click the Menu button, check Private Table, then click Change next to Name
and enter a table name"*, and friends *"enter the same name at their own private table"* to be seated
together. The group is the string. It exists for one evening and leaves nothing behind.

**Scheduling and invitations.** Neither exists. Coordination is entirely out of band — you tell your
friends the table name however you already talk to them.

**Practice and stakes.** Bots are a per-seat affordance, not a mode: *"click the little grey robot
next to any empty seat to invite a bot"*, and you can fill every seat. The site's own advice, quoted
on the homepage, is a good line: *"If you're new to a game, playing against others can feel
intimidating. We always suggest playing against the computer before playing against other people."*
Ranked play is a separate labelled door on the same shelf.

**Steal:** five doors, one shelf, all visible at once — browse, host, private, ranked, bots. A visitor
reads their whole option space in one glance.
**Avoid:** a shared secret with no memory. It is superb for one night and useless for the fourth
Thursday, which is exactly the gap Pokernight's club exists to close.

---

## 3. CardzMania

**Top-level structure.** Navigation is a taxonomy of games by family: Solitaire, Trick Taking, Rummy,
Betting, Climbing/Shedding, Classic. Individual games are flat URLs (`/Hearts`, `/TexasHoldem`,
`/Canasta`). Community facts — Global Leaderboards, Weekly Cups — are features named on the
marketing page rather than destinations in a rail I could see.

**Play now.** The Canasta page's primary control is one button, **"Play Canasta Online"**, with the
variant chosen next (Solo or Teams). The pitch is friction: *"No Sign Up, No Downloads, No
Subscriptions."*

**Groups.** None observed. The site advertises playing "with friends, chat, socialize" but neither
the homepage nor the Canasta page exposed a lobby, a private-table mechanism or a club concept in the
HTML I fetched. **Documented gap:** those may exist inside the game client, which I could not enter.

**Scheduling and invitations.** Nothing found.

**Practice and stakes.** Bots are the fallback and the selling point — the operators say they built
*"the best AI bots we could come up with"* for solo play or when the table is short. No money.

**Steal:** one button per game, and the variant question asked *after* the commitment to play, not
before.
**Avoid:** a marketing page that names social features the navigation does not lead to. If a card
room has clubs, the club has to be a link, not a bullet point.

---

## 4. Canasta Junction

**Top-level structure.** A conventional marketing site — Home, Rules, News, Blog, Support, More —
wrapped around a game client on web, iOS and Android. Inside the client, the documented structure is
a **Main Menu** with three modes: **Live Play**, **Solitaire**, **Duplicate**. Their own blog
describes the path as *"From the Main Menu, select Live Play. In the Game Lobby you will see the list
of existing tables in play."* (Documentation, not observation — their help centre returned 403.)

**Play now.** "Play now" per platform on the marketing site; inside, Solitaire is the frictionless
door and Live Play is the gated one.

**Groups.** None. Community happens as chat at a table and as tournament leaderboards. A private
table is a table with a password — *"Games with a padlock indicate a private game secured with a
password"* — which is World of Card Games' pattern with a lock instead of a name.

**Scheduling and invitations.** No calendar. Duplicate tournaments run daily on the operator's
schedule, not a member's.

**Practice and stakes.** This is the clearest **mode separation** in the survey, and it is drawn on
the money line rather than the skill line: **Solitaire** (offline, against robots, earns rank points)
and **Duplicate** (tournament, everyone plays the same cards, opponents are robots) are free;
**Live Play** — the only mode with real humans — is behind a subscription of $6.99–7.99 monthly with
a 14-day trial. Robots are also available *inside* Live Play: *"Add robots to table as needed."*

**Steal:** three named modes at the very top, and the same robot available in all of them. A robot is
a seat-filler and a practice partner, and calling those two things by one name is correct.
**Avoid:** putting the only social mode behind the paywall while the leaderboard is free. It makes
the club-shaped part of the product the part a newcomer cannot reach.

---

## 5. Trickster Cards — the closest thing to Pokernight's clubs

This site was not on the brief and turned out to be the best comparable in it: browser card games,
free play against strangers, and a genuine club layer with scheduled multi-table events.

**Top-level structure.** Top bar: **Play Now**, **Games**, **Features**, **Shop**, **Help**. Clubs
are not in the top bar of the marketing site; they live inside the app's main menu, where the
documented items are **Schedule Event**, **Create Club**, and the personal sections **Upcoming
Events** and **My Clubs** (help: *About Clubs*).

**Play now.** **"Play"** matches you with players by *"skill and speed"*; **"Join"** puts you in a
friend's private game. Two labelled doors on the front page.

**Groups.** **"My Clubs"** is a list of the clubs where you are an admin or a member — a list, not a
switcher. Discovery is separate: clubs may *"allow anybody to request to join by listing in our
public directory"*, and admins may *"Add members from your friends list, via email, or by sharing a
link."* The Club Details page is a destination with a header stating *"whether you are a club member,
an admin, or are invited to join"*, then buttons to the admin roster, the member list, pending
invitations, partnerships, **Standings**, **Past Events**, and a contact-admins chat. Bottom of the
page: **Leave Club** for members, **Delete Club** for admins, **Join Club / Decline Invitation** for
invitees.

**Scheduling and invitations.** Entirely inside the club, and only for admins: *"Only club admins may
schedule club events."* The Schedule/Edit Event form takes club, name, game, style, length, movement,
rules, date and time, **lobby opening time**, a **grace period for late arrivals**, description,
visibility, and seat-assignment style. Events run 1–10 rounds over multiple tables. Registration is
one of two models: *"Open to all club members"* notifies everyone, or invite-only where *"only invited
members are notified and may play."* Events may be scheduled *"up to 1 month in advance"*, and — a
finding worth stating plainly — **the documentation contains no recurrence at all.** Every event is a
one-off. Clubs are gated: VIP membership is required to create and manage one, *"Your members join
free."*

**Practice and stakes.** No money; the stake is club-wide standings, filterable by timeframe or tag.
Bots are not documented on the pages I read.

**Steal:** the lobby-opening time and the late-arrival grace period as *fields on the event*.
Pokernight's §7.5 alarm table has both concepts as engine behaviour; Trickster makes them the host's
decision, and a poker host absolutely has an opinion about how long to wait.
**Avoid:** one month of horizon with no recurrence. A weekly game re-entered by hand every month is
how a club stops having a calendar, and it is precisely the hole `docs/WORKSPACES.md` §7.1 fills with
a schedule that materialises occurrences.

---

## 6. PokerNow

**Top-level structure.** A short menu of verbs: New Quick Game, Multi-Table Tournament, Clubs, Plus,
community games, Discord bot.

**Play now.** Three actions and no account: *"Start a New Game"* → set blinds, stacks, variant →
*"Send the room link by text, WhatsApp or Discord."* Players join in a browser. This is the lowest
friction in the survey.

**Groups.** Clubs exist as a paid layer with *"membership controls as well as table and ledger
management."* They sit as one item in a flat menu, not as a mode.

**Scheduling and invitations.** The invitation **is** the room link. No calendar observed.

**Practice and stakes.** No bots. Money is not custodied at all — the product ships a *"Session Ledger
(buy-in/buy-out summary)"* and a full log download, and the settling happens between humans
afterwards. `docs/WORKSPACES.md` §9.5 is right that this is the thing Pokernight does not have to
build.

**Steal:** the room link as the whole invitation mechanism. A URL carries the context, so no switcher
is needed to arrive somewhere.
**Avoid:** clubs bolted on above a product whose primitive is a disposable room. The ledger is the
memory, and it is per-session.

---

## 7. PokerStars Home Games

**Every first-party source redirected to FanDuel.** What follows is documentation and third-party
reporting, and no sentence in this section is a live observation.

**Top-level structure.** A **Home Games tab in the desktop lobby**, beside the tabs for the public
games. PokerNews: *"Click on the Home Games Tab in the lobby and click 'Create a Poker Club'."*
PokerEnergy places the tab *"on the right side of the PokerStars client lobby."* So: a club section
that is one peer among the lobby's tabs, not a mode the client enters.

**Play now.** Not the point of this product. Home Games is the private half of a client whose public
half is the ordinary cash and tournament lobby.

**Groups.** The two doors are **"Create a Poker Club"** and **"Join a Poker Club"**. Joining takes a
**Club ID and an invitation code**, then manual approval. A club owner's own instructions read:
*"Club Name: JonathanLittlePoker, Club ID: 1976954, Invitation Code: playpoker … navigate to the
'Home Game' tab, select 'Join a Poker Club', enter the ID and code, then await manual approval, which
typically takes up to 24 hours."* Codes are constrained — 8–16 characters, case-sensitive, must start
with a letter, must contain a number, must not contain your username — and club names are reviewed
before they are shown to anyone. Inside, the manager gets a **Manage Club** tab (suspend, reinstate,
grant admin, theme and images) and a **Manage Games** tab.
**Membership caps, per PokerEnergy:** a player may create two clubs and be *"a member—up to 10 clubs
at a time."* That is the only explicit cap on group membership found anywhere in this survey except
chess.com's, and it is a small number.

**Scheduling and invitations.** Inside **Manage Games**, per Rakeback and PokerNews: pick the game,
buy-in, table size, structure, stacks, payouts, and a start date and time. Secondary guides state
that a tournament can be set to **recur daily, weekly or monthly or at a custom interval** — I could
not confirm this against a first-party page and it should be treated as unverified. Club seasons and
a standings view are documented: standings appear in the club lobby (the club owner's page names a
**"Standings"** section within it), and managers can *"set length of club seasons."*

**Practice and stakes.** Real money and play money are both available, per club and per game, and the
club's tables are its own. No bots — it is a real-money room.

**Steal:** the club ID plus invitation code. It makes a club findable by someone who was told about it
and invisible to everyone else, without a public directory and without confirming existence to a
stranger — which is exactly the 404-not-403 rule in `docs/WORKSPACES.md` §6.2, expressed as a product
feature rather than a status code.
**Avoid:** the 24-hour manual approval and the multi-day name review standing between an invited
friend and their first hand. The newcomer narrative in `docs/WORKSPACES.md` §1 dies at that queue.

---

## 8. Chess.com

**Top-level structure.** A **left rail**, and it has been one long enough for the redesign to be
news. Observed live on `/play` and `/play/computer`, the items are: **Play, Puzzles, Learn, Train,
Watch, Community, Other.** Chess.com's own announcement describes the same seven and states the
rationale — hovering a top-level item shows subcategories, clicking it goes to a landing page, and a
new integrated search exists because *"search results now pop up instantly too"*, so nobody has to
memorise the tree. The rail is **user-customisable**: the help centre describes a cogwheel at the
bottom → *"Customize sidebar"* → check features to pin, drag to reorder, drag into *"Drag to hide
under More"*, and **Reset to Default**. A later change fixed the rail at 170px regardless of
language.

**Play now.** From the homepage, **"Challenge a Bot"** is a direct link on the page; two clicks to a
bot game. `/play/computer` loads without a session.

**Clubs.** Under **Community**, alongside Friends, Members and Coaches. The help centre gives the
exact path twice: to join, *"Hover over 'Community' in the left sidebar and click on 'Clubs'"*, then
browse or search, open a club, click **Join** — with, for some clubs, a form or an approval wait. To
create, the same path plus *"Click 'Create a Club' from the right sidebar."* `/clubs` signed out is a
**directory ranked by activity** — a Matches leaderboard and a Vote Chess leaderboard — with Find
Clubs, Daily Matches, Live Matches, Vote Chess, Leagues and Federations around it. No "my clubs" and
no switcher appeared for a signed-out visitor.
**Scale:** users report the cap is **200 clubs** ([forum](https://www.chess.com/forum/view/general/what-is-the-maximum-number-of-clubs-i-can-join)),
added mid-2020 — a user statement, not staff. At two hundred, a switcher is arithmetically impossible
and chess.com does not attempt one; clubs are a browsable directory plus a personal list.

**Scheduling and invitations.** Inside the club: club matches, vote chess, club tournaments, forums,
admin roles. Not on a global calendar.

**Practice and stakes.** Bots are a merchandised category with personalities and ratings, sitting
under Play beside human play. Rated and unrated are per-game settings.

**Steal:** a fixed rail of verbs plus a user-pinnable tail. It lets the app ship one hierarchy and
still let a person who lives in one club keep it one click away.
**Avoid:** clubs that exist only on the web. Their own forum: *"You need to use the website. The apps
are different than the website … It doesn't have clubs"*, and a moderator conceding *"A web browser is
much better for accessing clubs."* Members found their own clubs by accident, via New Games → Join a
Tournament → Daily → menu → Connect. A club buried five levels deep is a club nobody attends.

---

## 9. Lichess

**Top-level structure.** A **top bar**, observed live: **Play, Puzzles, Learn, Watch, Community,
Tools, Donate.** The submenus are small and complete — Play: *Create lobby game, Challenge a friend,
Play against computer.* Community: *Players, Teams, Forum, Blog.* Tools: analysis board, openings,
board editor, import, advanced search.

**Play now.** The homepage's main column carries three buttons, and one of them is **Play against
computer**. No account is needed — *"You can play chess with the computer, friends or random opponents
without creating an account"*, with the limitation that anonymous games are casual only. One or two
actions to a game, from a cold start, for a stranger. This is the benchmark.

**Teams.** `/team` is a directory of teams ordered by membership. A team page (`/team/lichess-swiss`,
loaded live) is a destination: name, member count, leaders, recent members, a **tournaments** list
showing what is *"Playing now"* versus upcoming, and a team **forum**. Teams are the only group
object, they sit under Community, and there is no switcher.

**Scheduling and invitations.** Team tournaments — arena and Swiss — are created by team leaders and
listed on the team page. The site-wide tournament calendar and the team's own list are different
views of the same objects, which is the cleanest resolution of "global schedule versus club schedule"
anyone in this survey achieves.

**Practice and stakes.** No money. Rated versus casual is a per-game toggle, and anonymity forces
casual, which is a neat way of tying identity to stakes.

**Steal:** the team page that lists *its own upcoming and running events inline*. It is one screen and
it is the exact fix for BGA's complaint in §1.
**Avoid:** teams as a flat global directory ranked by size. Lichess's largest team has 732,661
members, which makes "team" mean something different from "the eight of us who play on Thursday". A
card room whose clubs are eight people should not borrow the directory.

---

## 10. Discord — the canonical container

**Top-level structure.** A narrow **server rail** on the far left, then a channel sidebar, then
content, then a member list. All three third-party guides I could load describe it identically: the
far-left column *"lists all the Discord servers the user is a member of"*, the **topmost bubble is
Direct Messages / Home**, and *"the next sidebar lists the text and voice channels of the Discord
server the user is currently viewing."* Switching servers replaces the entire middle and right of the
application. This is a true context switcher, and it is the reference implementation of one.

**Play now.** Not applicable — but note what occupies the first rail slot: **Home**, the *contextless*
zone with your DMs and friends. Discord's switcher does not have "no server" as an error state; it has
"no server" as slot one, permanently.

**Joining and switching.** By **invite link**, which drops you into a specific channel — *"If you
manually invite someone to your server, Discord sends them straight to the channel you clicked the
Create Invite button next to"*, otherwise to the channel at the top of the list. Servers can require
onboarding, an interactive survey that assigns roles and reveals channels before the newcomer sees the
room. A user with no servers sees the Home screen offering to create one, use a template, or accept an
invite (third-party guide, not a Discord source — the help centre 403s).

**Scheduling.** **Events live inside the server, at the top of its channel list** — for Community
servers the Events page is the first entry above every channel, and members see *"X events"* in the
sidebar. There is no cross-server calendar. Scheduling is a property of the container, always.

**Steal:** two things. Events pinned to the top of the container's own sidebar, above its rooms — a
club's next night should outrank its table list. And an invite link that lands the newcomer in a
specific place, not on a generic landing page.
**Avoid:** the rail itself, unless you are Discord. It is earned by users who belong to dozens of
containers where *all* content is container-owned. Section 14 argues Pokernight is not that.

---

## 11. Slack

**Top-level structure.** Since the 2023 redesign, a narrow global rail of *sections* — Home, DMs,
Activity, Later — with the workspace switcher relegated. The switcher is documented as an icon
rather than a permanent rail: *"Click your workspace icon in the top left to view a list of all the
workspaces you're signed in to"*, and — the important sentence — *"Click the workspace switcher icon
or press ⌘+Shift+S … to keep your workspaces visible in the sidebar."* Persistent multi-workspace
navigation is **opt-in**. On Enterprise plans there is a third position, **All workspaces**, which
filters conversations across them rather than switching between them.

**What happens with exactly one workspace.** **The help article does not say**, and I could not
observe the client. This is the most load-bearing gap in the survey, because it is precisely
Pokernight's commonest case. What the documentation does establish is weaker but still useful: Slack
treats always-visible workspace switching as a preference a multi-workspace user turns on, not as the
default chrome, and the 2023 redesign moved the global rail's slots to *sections of your own
attention* rather than to containers.

**Steal:** the rail whose slots are the user's own concerns — what is new, what is mine, what is
later — with container switching as a smaller, opt-in affordance layered on top.
**Avoid:** shipping a switcher that most people see with one item in it. Slack, whose users routinely
have several, still defaults it away.

---

## 12. What recurs — the patterns worth trusting

A pattern is worth something here when three or more independent products, built by different people
for different games, landed on it.

**12.1 "Play" is the first item, and it reaches a game in one to three actions, with no account and
no group.** Lichess puts **Play against computer** on the homepage and lets an anonymous visitor use
it. Chess.com puts **Challenge a Bot** on the homepage and serves `/play/computer` signed out. World
of Card Games needs two clicks and states *"no download and no signup"*. CardzMania is one button and
*"No Sign Up"*. PokerNow is three steps and no account. Trickster's first menu item is **Play Now**.
Six products, and only BGA dissents — its homepage's single action is registration. The stranger's
path is never routed through a group, a lobby of groups, or a choice about identity.

**12.2 Groups are destinations under a community heading, and every single one of these products
reached for a list where we were considering a switcher.** Chess.com: Community → Clubs, a directory
plus a personal list, capped at 200. Lichess: Community → Teams. BGA: `/grouplist` beside `/gamelist`.
Trickster: **My Clubs** in the main menu, next to Upcoming Events. PokerStars: a Home Games *tab*
beside the other lobby tabs, capped at 10 clubs. **Not one game product in this survey has a context
switcher.** The two that do — Discord and Slack — are not games, and §14 is about why that is not an
accident.

**12.3 Scheduling and invitations live inside the group, never above it.** Trickster's events are
created from the club and only by its admins. PokerStars' scheduled games are inside Manage Games
inside the club. Discord's events sit at the top of the *server's own* channel list and there is no
cross-server calendar. Lichess team tournaments are listed on the team page. Chess.com's matches and
club tournaments are on the club page. Five products, no exceptions: **a calendar is a property of a
container, and the personal view of it is a projection ("Upcoming Events"), not a second calendar.**

**12.4 The invitation is a link or a code, and it carries the context with it.** PokerNow's room link,
Discord's invite link (landing you in a specific channel), PokerStars' Club ID plus invitation code,
Trickster's *"sharing a link"*, World of Card Games' shared table name, BGA's "open only to those
invited or with a link". Nobody makes an invited newcomer find the group in a directory. This matters
for navigation more than it looks: **if the invitation delivers you into the context, the navigation
never has to offer a way to get into it.**

**12.5 Bots sit on the same shelf as human play and are named, not hidden.** Lichess: *Play against
computer*, third item under Play. Chess.com: bots as a merchandised category under Play. World of Card
Games: **Play bots** beside Browse tables, plus a robot icon per empty seat. Canasta Junction:
**Solitaire** as a top-level mode *and* *"Add robots to table as needed"* inside Live Play. CardzMania:
bots as the fill-in for a short table. The recurring insight is that **the same robot serves two jobs**
— practice before you face people, and filling a seat when four have not shown up — and no product
separates them.

**12.6 Where money or rating is at stake, the stake is a named door, not a mode.** World of Card
Games: **Join ranked table** beside the casual ones. Lichess: rated/casual per game, with anonymity
forcing casual. Canasta Junction: the subscription line falls between Solitaire/Duplicate and Live
Play. PokerStars: real money and play money coexist within one club. Three or more products signpost
stakes **at the table**, on the door you walk through, rather than by putting the user into a mode
they might forget they are in.

---

## 13. Where they disagree, and what the disagreement is actually about

**13.1 Is a group a container or an index?** Discord and Slack say container: the group owns the
channels, the events, the messages, and leaving it removes everything. Chess.com, lichess, BGA,
Trickster and PokerStars say index: the games are the platform's, and the group selects, restricts or
scores them. The disagreement is really about **where content lives**. BGA is the natural experiment,
and it failed: its groups index nothing (a group cannot even list its own open tables), so its users
call them *"not super useful"*. Lichess's teams index something real — their tournaments, inline on
the team page — and nobody complains. **The rule the disagreement yields: an index is fine, but it
must actually index the thing the group exists for.**

**13.2 Public directory or private code?** Chess.com and lichess rank clubs and teams publicly by
size and activity; BGA has both, with invitation-only groups saying *"Only invited players can join
this group"*; PokerStars has no directory at all — you need a Club ID and a code. This is a
disagreement about **what a group is for**: growth, or an arrangement between people who already know
each other. A card room whose unit is eight friends on a Thursday is on PokerStars' side of this, and
`docs/WORKSPACES.md` §6.2 has already chosen that side in the strongest form available — 404, never
403.

**13.3 Is solo play a waiting room or a destination?** World of Card Games and Canasta Junction treat
robots as instrumentation — practice first, fill an empty seat. Chess.com sells bots as content with
names, faces and ratings. The disagreement is about whether solo play is where you go when the room is
empty, or a reason to come. It resolves on how good the bots are, and it decides whether "play a bot"
is a primary navigation item or an option on a table.

**13.4 How many groups does a person have?** Chess.com: up to 200. PokerStars: 10, and 2 of your own.
Trickster and BGA: however many, but in practice a handful. Discord: dozens. Slack: a few. **This
number determines the instrument.** A switcher is for dozens; a pinned list is for a handful; a single
link is for one. Nothing in this survey suggests a poker club member has more than a couple, and
PokerStars — the closest analogue — capped it at ten and still used a tab.

---

## 14. Recommendation: a card room whose clubs are the differentiator, whose commonest visitor has none

**14.1 No context switcher.** It is the wrong instrument here, for three reasons the survey supports.

*It is a container's instrument, and a Pokernight club is not a container.* Discord's rail is earned
because switching servers legitimately replaces the entire application — different channels, different
people, different everything. Switch clubs in Pokernight and what changes is a roster, a schedule and
a leaderboard. Your treasury does not change. Your identity does not change. The pickup tables do not
change. The rules of hold'em do not change. A switcher that reframes the whole app to swap three
panels is a promise the product cannot keep, and users will read the emptiness of the rest of the app
in club context as breakage.

*Most users have zero or one club.* §13.4's numbers are decisive: even chess.com's 200-club maximum
produced a directory-plus-list, not a switcher, and PokerStars' analogous product caps membership at
ten and still spends only one lobby tab on it. Slack — a product whose users often have several
workspaces — ships persistent workspace switching **off by default**. A switcher whose menu usually
contains one item is chrome that teaches nothing.

*The stranger would meet it first.* The commonest visitor has no club. A switcher makes their first
navigational encounter a control with an empty menu and an invitation to feel excluded. Every product
in §12.1 spends that same pixel on "Play".

**14.2 What to build instead: a left rail of verbs, with clubs as a pinned list inside it.**

Slot one is **Play** — and it must deal a hand against bots in at most two actions, with no session,
no seat negotiation and no club. That is the settled answer across six products, and Pokernight has an
unfair advantage in it: `packages/canasta` and `packages/engine` are pure and seeded, and
`packages/agent-kit` already has a baseline strategy, so a bot table is a local, instant thing.

Slot two is **Tables** — your live tables and the public pickup tables. BGA's own users asked for
exactly this and did not get it: *"reorganize the top navigation to prioritize 'My tables/games' … before
secondary options like 'Play now'."* They are half right. Play stays first for the stranger; "my
tables" is second because it is first for everyone who returns.

Slot three is **Clubs**, which **expands in place** into the person's clubs by name, and degrades by
count:

| Clubs you have | What the rail shows |
|---|---|
| 0 | One row: **Start a club** · and a quiet **Have an invite?** |
| 1 | The club, by its own name, expanded — Next night, Members, Season |
| 2+ | A short list by name, the one with the soonest night expanded |

That is Trickster's **My Clubs** plus chess.com's pinnable sidebar, and it gives the single-club member
exactly what a switcher would have given them — their club, permanently, one click away — without ever
putting the application into a mode, and without showing a stranger a control that means nothing yet.

**14.3 A club is a destination with its own sub-navigation, not a filter on the whole app.** Its page
carries, in this order: the **next night** with its headcount and an answer control; the club's **live
tables**; **members**; **season standings**; and, for a host, **schedule and settings**. The ordering
is Discord's — events above rooms — and the live-tables row is the direct fix for §1's failure. Copy
Trickster's Club Details header, which states in words whether you are a member, an admin, or invited:
`docs/WORKSPACES.md` §5 derives exactly those three standings already, and showing the derived answer
on the page is free.

**14.4 The invitation carries the context, so navigation never has to.** §12.4 is unanimous. A club
invitation should be a link that lands the invitee on the night they were invited to, with the answer
buttons in front of them — which is what `docs/WORKSPACES.md` §8.1 already builds with `ActionCardV1`
and §8.4's `?return=`. Nobody should ever have to find a club in a list. Combined with 404-never-403,
this means the card room needs **no club directory at all**, and the absence is a feature, not a
missing screen.

**14.5 Where a switcher-shaped control genuinely belongs: on the act, not on the app.** One question,
asked once, at table creation — *Open this table for: **Pickup** / **Thursday Night***. That is BGA's
"restrict to group" dropdown, and it is the correct scope for a chooser: it binds a single object at
the moment the binding is made, which is precisely `TableMeta.club` being stamped at creation and never
re-read. A control that scopes one action is not a context switcher; it is a field.

**14.6 Two things to refuse.** Do not gate the social half behind anything the newcomer cannot pass —
Canasta Junction paywalls the only mode with humans in it, PokerStars puts a 24-hour approval and a
multi-day name review in front of an invited friend, and Trickster requires VIP to create a club. And
do not ship a second-class client: chess.com's clubs are effectively web-only, and its own moderators
say so. If a club's night opens on a phone, the club has to work on the phone.

**14.7 The one-line answer.** Clubs go in the rail as a named, pinned list and each club is a
destination with its own sub-navigation — not a context the application switches into — because a
context switcher is a container's instrument, and a Pokernight club owns a roster, a calendar and a
leaderboard while the tables, the money and the identity stay yours wherever you are.

---

## Sources

Board Game Arena: [homepage](https://en.boardgamearena.com/) ·
[a group page](https://en.boardgamearena.com/group?id=11892245) ·
[interface thread](https://forum.boardgamearena.com/viewtopic.php?t=11701) ·
[group games discovery](https://forum.boardgamearena.com/viewtopic.php?t=29027) ·
[creating a game for a group](https://forum.boardgamearena.com/viewtopic.php?p=182243) ·
[inviting groups](https://forum.boardgamearena.com/viewtopic.php?t=12987) ·
[FAQ](https://en.doc.boardgamearena.com/faq)

World of Card Games: [homepage](https://www.worldofcardgames.com/) ·
[Canasta](https://worldofcardgames.com/canasta) ·
[private tables](https://worldofcardgames.com/blog/p/how-to-set-up-private-table-at-world-of)

CardzMania: [homepage](https://www.cardzmania.com/) · [Canasta](https://www.cardzmania.com/Canasta)

Canasta Junction: [homepage](https://www.canastajunction.com/) ·
[how to start a live game](https://canastajunction.com/2023/06/14/how-to-start-a-live-game/)

Trickster Cards: [homepage](https://www.trickstercards.com/) ·
[for clubs & groups](https://www.trickstercards.com/features/for-clubs/) ·
[about clubs](https://www.trickstercards.com/help/clubs/) ·
[club details](https://www.trickstercards.com/help/clubs-clubdetails/?file=clubs-clubdetails.html) ·
[schedule event](https://www.trickstercards.com/help/clubs-createevent/?file=clubs-createevent.html)

PokerNow: [homepage](https://www.pokernow.com/)

PokerStars Home Games (no first-party page reachable):
[PokerNews 2020 guide](https://www.pokernews.com/news/2020/03/pokerstars-home-games-36819.htm) ·
[PokerNews 2016 guide](https://www.pokernews.com/news/promotions/2016/01/guide-to-setting-up-a-pokerstars-home-game-9650.htm) ·
[Rakeback](https://www.rakeback.com/pokerstars/home-games/) ·
[PokerEnergy](https://pokerenergy.net/edu/item/home-games-ps) ·
[a club owner's join instructions](https://jonathanlittlepoker.com/homegame/) ·
[PokerBonusHub](https://pokerbonushub.com/pokerstars-home-games/)

Chess.com: [homepage](https://www.chess.com/) · [Play](https://www.chess.com/play) ·
[Computer](https://www.chess.com/play/computer) · [Clubs](https://www.chess.com/clubs) ·
[Community](https://www.chess.com/community) ·
[new navbar](https://www.chess.com/news/view/chesscom-new-navbar-updated-search) ·
[customise sidebar](https://support.chess.com/en/articles/12749551-how-do-i-customize-my-sidebar) ·
[join a club](https://support.chess.com/en/articles/8718547-how-do-i-join-a-club-on-chess-com) ·
[create a club](https://support.chess.com/en/articles/8718549-how-do-i-create-a-club) ·
[club limit thread](https://www.chess.com/forum/view/general/what-is-the-maximum-number-of-clubs-i-can-join) ·
[clubs in the apps](https://www.chess.com/forum/view/clubs-and-teams/how-to-access-my-club-in-chess-com-apps)

Lichess: [homepage](https://lichess.org/) · [FAQ](https://lichess.org/faq) ·
[Teams](https://lichess.org/team) · [a team page](https://lichess.org/team/lichess-swiss)

Discord: [Wikipedia](https://en.wikipedia.org/wiki/Discord) ·
[Unito beginner's guide](https://unito.io/blog/discord-beginners-guide/) ·
[remote.tools interface guide](https://www.remote.tools/discord/interface) ·
[Zapier welcome guide](https://zapier.com/blog/discord-welcome/) ·
[Scheduled Events](https://support.discord.com/hc/en-us/articles/4409494125719-Scheduled-Events) (not fetchable; via search)

Slack: [Switch between workspaces](https://slack.com/help/articles/1500002200741-Switch-between-workspaces)
