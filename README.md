# QA AI annual plan site

Static, shareable snapshot of the Slack canvas `F0C9Q2F525N` (QA AI annual plan, canvas v2.1).

This folder is a separate site. Do not put it in the Phoenix `cursor-project` repository.

## What is published

- `index.html` renders the page. Leave its design alone during routine updates.
- `plan.json` is the only file a scheduled update should change.
- `robots.txt` asks crawlers not to index the page. The page is still readable by anyone who has the URL once it is on GitHub Pages.

## Publish (GitHub Pages, no server)

1. Create a new public GitHub repository that contains only this folder.
2. Push `main`.
3. In the repository, open Settings, Pages, and deploy from branch `main`, folder `/` (root).
4. The shareable URL is `https://<github-user>.github.io/<repo>/`.

GitHub Pages on a free account serves a public site. Do not point the bot at `cursor-project`.

## Grok Bot routine

Message the Bot that should own the routine. Slack must be connected on that Bot's Cursor account. The first test run may ask for GitHub sign-in and for permission to push. Allow the push for this repository so later runs are not waiting on an approval (unattended approvals expire after about 10 minutes: https://cursor.com/help/grok-bot/how-to).

Short schedules spend weekly usage quickly. Cursor's routine help says an hourly schedule or a short interval can use a week of usage in a day: https://cursor.com/help/grok-bot/routines

Paste this instruction, and replace the schedule phrase before sending:

```text
Every <SCHEDULE>, read Slack canvas F0C9Q2F525N (QA AI annual plan).
Compare it with plan.json in the qa-ai-plan repository (the site repository only, never cursor-project).
If vision, purpose, mission, value, goals, quarters, risks, and how-we-work text are unchanged, stop. Do not commit.
If the canvas text changed, update only plan.json. Keep schema 1 and the same JSON keys. Copy the canvas wording exactly. Do not rewrite, translate, or add tasks. Preserve any existing jira key on an item. Set updatedAt to the current time in Asia/Tbilisi. Set current: true on the quarter that contains today's date and false on the others.
Commit and push main.
Do not edit index.html, README.md, robots.txt, or .nojekyll.
If the canvas cannot be read, do not push.
```

Suggested schedule phrases: `hour`, or `10 minutes` if the weekly usage cost is acceptable.

A new routine waits until the next scheduled time. Use Test on the routine to publish the first update immediately.

## Jira status sync

`.github/workflows/sync-jira-status.yml` runs every 5 minutes. It updates only the Jira status, `since`, and `done` fields of tickets already linked in `plan.json`. It does not move tickets between quarters or add new rows. The status column and the progress block read those fields, so the site updates after the workflow pushes `main`.

Secrets `JIRA_EMAIL`, `JIRA_API_TOKEN`, and `JIRA_BASE_URL` live in the repository Actions secrets. The workflow can write to `main`.

## schema 1

`plan.json` keys:

- `title`, `version`, `range`, `updatedAt`, `sourceUrl`
- `pvm.title`, `pvm.sections[]` with `title` and `paragraphs` (or legacy `text`), plus `pvm.achieving` and `pvm.howWeWork` (`title`, `items`). Copy that wording exactly.
- `feedback`: summary dashboard plus findings taken from the interviews (`tools`, `savedTime`, `nextSteps`, `leadIdeas`). Do not paste the raw interview transcript.
- `goals[]`: `n`, `text`, `tasks`, `quarter`
- `quarters[]`: `id`, `label`, `current`, `items[]` with `id`, `task`, `area`, `priority` (`high` or `medium`), optional `jira` (one issue key such as `GB-1807`) plus optional `status`, `since` (date the issue last entered In Progress), and `done` (date it was resolved). Optional `links` is an array of `{key, status, since, done}` when several issues belong to the same row. The Jira sync updates `status`, `since`, and `done` only. Preserve `jira` and `links` on other routine updates.
- `risks[]`: `quarter`, `text`
- `howWeWork[]`: strings

New canvas sections are not shown until `index.html` is updated once to render them.
