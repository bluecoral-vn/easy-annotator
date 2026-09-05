# Agents

Skill pack: `skill/easy-annotator/`. PHP to upload: `host/` only. Do not deploy this whole git tree.

Copy the skill to `.agents/skills/easy-annotator/` (Codex), `.opencode/skills/easy-annotator/` (OpenCode), `.claude/skills/easy-annotator/` (Claude), or `.cursor/skills/easy-annotator/` (Cursor).

Config is `{ "domain": "https://HOST/path" }` in `annotator.config.json` (no example file). Embed is `{domain}/index.php`. Human review docs are HTML, not Markdown.
