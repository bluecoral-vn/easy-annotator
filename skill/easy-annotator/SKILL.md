---
name: easy-annotator
description: Sets up Easy Annotator from a GitHub repo URL and a PHP domain, writes human review docs as HTML with the embed script, uploads pages, and replies by public id (A01). Markdown is only for AI-readable context. Use when the user pastes the easy-annotator repo link, mentions domain, annotator, review HTML, pubId, or notes on a page.
---

# Easy Annotator

Self-hosted notes on HTML. Config is one field: `domain`. Derive:

- embed = `{domain}/index.php`
- api = `{domain}/annotations.php`
- page = `{domain}/index.php?name={slug}`
- comments: GET + POST reply, no token
- HTML PUT token (optional, only to upload pages): env `ANNOTATOR_AI_TOKEN`, or `host/anno-data/.ai-token` if this checkout has `host/`

This git repo has two trees. **Never upload the whole repo to PHP hosting.**

| Path | Where it belongs |
|---|---|
| `host/` | PHP hosting only (upload the **contents** of this folder) |
| `skill/easy-annotator/` | Docs repos (copy into the LLM skill folder) |

## HTML vs Markdown (hard rule)

**Human review** (pitch, slide copy, shareable writeup, anything people comment on): always `.html`. Always include the embed before `</body>`:

```html
<script src="{domain}/index.php"></script>
```

Read `domain` from repo-root `annotator.config.json` (the file committed in this project; there is no `.example` copy). Derive embed as `{domain}/index.php`. If the file is missing or `domain` still contains `YOUR_HOST`, run Setup and write that same filename. Do not skip the tag because the server also injects it. Local preview and other hosts need the tag.

**AI-only context** (README, skills, architecture, `dev.md`, notes the model should read): `.md`. Do not turn those into annotated HTML.

If the user says "viết doc / review / share / comment được": default HTML. If they say "ghi chú cho AI / spec / skill": default Markdown. If unclear, HTML.

Never export a human review as Markdown.

## Setup (AI runs this, no commands for the user)

Trigger: missing `annotator.config.json`, or `domain` still contains `YOUR_HOST`, or the user pastes the GitHub repo + domain.

1. Detect the coding agent. If the user named one, use it. Else if exactly one of these folders exists, use it. Else ask, suggesting **Codex**, **OpenCode**, **Claude** (also accept Cursor).

| Agent | Skill path |
|---|---|
| Codex | `.agents/skills/easy-annotator/` |
| OpenCode | `.opencode/skills/easy-annotator/` |
| Claude | `.claude/skills/easy-annotator/` |
| Cursor | `.cursor/skills/easy-annotator/` |

2. Domain: use the URL they gave (folder of the PHP install, no filename), e.g. `https://x.example.com/easy-annotator`. Read and update `annotator.config.json` only. Do not ask for `api` / `script` / `pages`. Do not create `annotator.config.example.json`.

3. Copy the skill folder (`SKILL.md` + `html-template.html`) into the agent path:

- If this checkout has `skill/easy-annotator/SKILL.md`, copy from there.
- Else download from the repo they pasted (default `https://github.com/bluecoral-vn/easy-annotator`):

```
https://raw.githubusercontent.com/bluecoral-vn/easy-annotator/main/skill/easy-annotator/SKILL.md
https://raw.githubusercontent.com/bluecoral-vn/easy-annotator/main/skill/easy-annotator/html-template.html
```

4. Write or update `annotator.config.json` at the repo root (this is the only config file):

```json
{ "domain": "https://x.example.com/easy-annotator" }
```

When embedding or uploading, always `json.load` this file and use `domain`. Never guess the host.

5. HTML PUT token only if this checkout contains `host/index.php`. If `host/anno-data/.ai-token` is missing, generate one (chmod 600). Do **not** write `.annotator-token`. Docs repos: comments need no token. For HTML PUT, use env `ANNOTATOR_AI_TOKEN`, leftover `.annotator-token`, or ask once for the server `anno-data/.ai-token` value.

6. Ensure `.gitignore` has `anno-data/` (and `.annotator-token` if leftover). Do **not** gitignore `annotator.config.json` (it only holds the public domain).

Then continue the user's task. Do not paste curl cheatsheets at the user.

## Write + share HTML

1. Start from [html-template.html](html-template.html). Fill the content. Keep the embed script, with `{domain}` replaced from config.
2. Slug from the filename (`Pitch VCFM.html` → `pitch-vcfm`). Only ask if empty or taken.
3. Upload. Print **only** the share URL from the JSON `url` field.

```bash
DOMAIN=$(python3 -c 'import json; print(json.load(open("annotator.config.json"))["domain"].rstrip("/"))')
TOKEN="${ANNOTATOR_AI_TOKEN:-}"
if [ -z "$TOKEN" ] && [ -f host/anno-data/.ai-token ]; then TOKEN=$(cat host/anno-data/.ai-token); fi
if [ -z "$TOKEN" ] && [ -f .annotator-token ]; then TOKEN=$(cat .annotator-token); fi
RESP=$(curl -sS -X PUT "$DOMAIN/index.php?name=my-slug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @path/to/doc.html)
python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$RESP"
```

Comments key off that exact URL. After a human-facing edit, PUT again to the same `name`.

## Comments (AI)

AI may **read** and **reply**. Do not edit or delete a human comment. Do not mark Done.

```bash
DOMAIN=$(python3 -c 'import json; print(json.load(open("annotator.config.json"))["domain"].rstrip("/"))')
API="$DOMAIN/annotations.php"
PAGE_URL="$DOMAIN/index.php?name=my-slug"

curl -sS "$API?url=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PAGE_URL")"

curl -sS -X POST "$API?url=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PAGE_URL")&action=reply&id=A01" \
  -H "Content-Type: application/json" \
  -d '{"text":"Updated the headline on slide 2","author":"AI"}'
```

## Do not

- Upload `skill/`, README, tests, or `.cursor/` to PHP hosting. Hosting is `host/` contents only.
- Put tokens in git, in HTML, or in the AI-button clipboard.
- Ask the user to set `api`, `script`, or `pages`, or to paste `annotator.js` / `ANNOTATOR_API`.
- Ask the user to run curl. The agent runs it.
- Store comment TTL in PHP. Optional purge is crontab: `php cron-purge.php 90d` (CLI only).
