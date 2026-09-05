---
name: easy-annotator
description: Sets up Easy Annotator with a domain-only config, writes review HTML, uploads pages, and replies to comments by public id (01, A01). Use when the user mentions annotator, notes on HTML, review docs, pubId, or embedding index.php.
---

# Easy Annotator

Self-hosted notes on HTML. Each operator runs their own PHP copy. Do not assume a shared host.

Config is one field: `domain`. Derive everything else:

- embed = `{domain}/index.php`
- api = `{domain}/annotations.php`
- page = `{domain}/index.php?name={slug}`
- token file = `.annotator-token` (never in git)

## Setup (AI runs this)

If `annotator.config.json` is missing, **do not stop**. Run setup:

1. Ask which coding agent this repo uses. Suggest **Codex**, **OpenCode**, **Claude**. Accept Cursor too.
2. Ask the public folder URL of the PHP install (no filename), e.g. `https://x.example.com/easy-annotator`.
3. Write `annotator.config.json`:

```json
{ "domain": "https://x.example.com/easy-annotator" }
```

4. If `.annotator-token` is missing, generate one (`php -r 'echo bin2hex(random_bytes(16)), "\n";'` or `openssl rand -hex 16`) and write it. chmod 600.
5. If this checkout **is** the PHP server, write the same value to `anno-data/.ai-token` (chmod 600). Otherwise tell the user to put that value on the server once (`anno-data/.ai-token` or env `ANNOTATOR_AI_TOKEN`).
6. Copy **this skill folder** (`skill/easy-annotator/` in this repo, or the folder that contains this SKILL.md) to the agent path:

| Agent | Path |
|---|---|
| Codex | `.agents/skills/easy-annotator/` |
| OpenCode | `.opencode/skills/easy-annotator/` |
| Claude | `.claude/skills/easy-annotator/` |
| Cursor | `.cursor/skills/easy-annotator/` |

7. Ensure `.gitignore` includes `annotator.config.json`, `.annotator-token`, and `anno-data/`.

Then continue the user's task. Do not ask them to paste JSON keys other than `domain`.

## Review docs → HTML

Write shareable reviews as `.html`, not Markdown. Dev-only notes stay Markdown (README, skills, tests).

1. Start from [html-template.html](html-template.html).
2. Hosted pages (`index.php?name=`) get the embed injected on GET. Do not ask the user to paste a script tag for those.
3. HTML opened somewhere else (local file, other host) needs one tag before `</body>`:

```html
<script src="{domain}/index.php"></script>
```

Default slug from the filename (`Pitch VCFM.html` → `pitch-vcfm`). Only ask if that slug is empty or already taken.

Upload:

```bash
DOMAIN=$(python3 -c 'import json; print(json.load(open("annotator.config.json"))["domain"].rstrip("/"))')
TOKEN=$(cat .annotator-token)
RESP=$(curl -sS -X PUT "$DOMAIN/index.php?name=my-slug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @path/to/doc.html)
python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$RESP"
```

After upload, give the user **only that URL**. Do not dump the JSON. Comments key off that exact URL.

## Comments (AI)

AI may **read** and **reply**. Do not edit or delete a human comment. Do not mark Done.

```bash
DOMAIN=$(python3 -c 'import json; print(json.load(open("annotator.config.json"))["domain"].rstrip("/"))')
API="$DOMAIN/annotations.php"
PAGE_URL="$DOMAIN/index.php?name=my-slug"
TOKEN=$(cat .annotator-token)

curl -sS "$API?url=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PAGE_URL")"

curl -sS -X POST "$API?url=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$PAGE_URL")&action=reply&id=01" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Updated the headline on slide 2","author":"AI"}'
```

After a reply, PUT the updated HTML to the same `name` so the share link stays stable.

## Do not

- Put tokens in git or in HTML.
- Export Markdown for human review of product copy.
- Ask the user to set `api`, `script`, or `pages` keys.
- Ask the user to paste `annotator.js` or `ANNOTATOR_API`.
