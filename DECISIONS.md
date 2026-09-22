# Decision log

Your methods section. About one page total.

Answer these as you go, not the night before it is due.
Specifics beat polish - a short honest answer is worth more than a long vague one.

Delete these instructions when you are done, or leave them. It does not matter.

---

## 1. What did you set out to build, and what changed?

What you wanted at the start, and what is actually live now.
Name one thing you dropped or added along the way, and why.

I first decided on a theme for the site: an interactive study room instead of a generic portfolio page. Then I added the Study Room feature: an hour-by-hour task table with an example view and a 'try it yourself' mode that lets a visitor fill in their own tasks, saved only in their own browser. 
For what changed: At first the schedule was a table with a fixed one-hour row for each line. I later changed it to custom time blocks (like 2 hours, 3 hours), and added toys.js, a small feature that lets you interact with the page in a fun way.

---

## 2. A fork in the road

Name one real choice where you could have gone two ways.
Plain HTML or a framework. One page or several. Your own CSS or someone's template.
What goes on the front page and what does not.

Say which you picked, what the alternative was, and what you gave up by not taking it.


There was a fork here: make the Study Room a static display showing only my own example schedule, or make it something visitors can actually use themselves. I picked the second option which was a 'Try it yourself' button that clears my example and lets visitors fill in their own hourly tasks, saved only in their own browser. The alternative would have been simpler to build, since it needs no input handling or storage, but it would just be something to look at rather than something a visitor could actually use.

---

## 3. Where you overruled the agent

One time Claude suggested, wrote, or claimed something and you did not take it.

What did it do? How did you notice? What did you do instead?

If it genuinely never happened, say so plainly, and then say what you would have had to
check in order to notice. Being honest here costs you far less than a story you cannot
defend when you record your video.

At first I noticed that my background's resolution didn't adjust as I resized the browser window. I explained the issue to the AI, and it claimed: 'I moved the background from body to html... body previously had max-width: 1100px, so the background tended to follow that narrow box, and when the window was wider than that, dark edges would show on the sides. Now the background fills the entire window, and cover will automatically scale with the window size.' But after checking, I found it hadn't actually been fixed, so I kept explaining the issue in the prompt and had it fix it.

---

## 4. How you know it works

What check did you run, and what did it tell you?

Then the real question: **what would have made this check fail?**
A check that could not have failed is not a check.

Link to your `verification/` folder.

When I first opened the live URL, I still saw the old interface. I later found out this was a browser caching issue (confirmed by doing a hard refresh [Cmd+Shift+R]), not a deployment failure. What would have made this check fail: if opening it in an incognito window also showed the unstyled version, that would mean something was actually wrong.

See the verification/ folder for the screenshot, fetch.txt, and README.md

---

## 5. What is still wrong

One thing on your own site that is not right, not finished, or that you do not
fully understand.

What would you do next, and how would you find out?

I'd also like the 'Shake the desk' button to not just shake the toys, but also make the edges of every card/section shake. Like add a brief shake animation class to each .card, and trigger it on all the cards at once when the button is pressed.
