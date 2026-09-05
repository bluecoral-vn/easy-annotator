# Easy Annotator

Ghi chú trên HTML: bôi chữ, ghim ảnh, lưu JSON, AI đọc và trả lời. PHP 7.4+, không npm.

Người dùng **không gõ lệnh**. Dán một prompt dưới đây cho AI.

Repo: `https://github.com/bluecoral-vn/easy-annotator`

## Prompt có sẵn

### 1. Setup skill (repo đang viết tài liệu)

Dán, thay domain:

```
Setup Easy Annotator từ https://github.com/bluecoral-vn/easy-annotator
Domain: https://YOUR_HOST/easy-annotator
```

AI tự hỏi LLM nếu chưa rõ (gợi ý: Codex, OpenCode, Claude; nhận Cursor), copy skill đúng chỗ, ghi `{ "domain": "…" }`, tạo token. Không điền `api` / `script` / `pages`.

Nếu đã biết LLM, thêm một dòng: `LLM: Codex` (hoặc OpenCode / Claude / Cursor).

### 2. Viết tài liệu để người review

```
Viết [tên tài liệu] thành HTML để review, chèn annotator, upload, gửi link.
```

Skill **luôn** ra `.html` + thẻ `<script src="{domain}/index.php">`. Không ra Markdown cho bản người đọc.

### 3. Trả lời comment

```
Đọc comment trên [URL chia sẻ], reply các note chưa xong. Không đánh Done.
```

### 4. Ghi chú chỉ cho AI (không review)

```
Ghi [nội dung] ra Markdown, chỉ để AI đọc, không chèn annotator.
```

## Hai thư mục (đừng lẫn)

| Thư mục | Đưa đi đâu |
|---|---|
| `host/` | **Chỉ cái này** lên PHP hosting. Upload **nội dung** folder (file nằm ngay document root của `{domain}`). |
| `skill/easy-annotator/` | Copy vào repo tài liệu, theo LLM (bảng dưới). |

Không upload lên hosting: `skill/`, `.cursor/`, README, `AGENTS.md`, `tests/`, `annotator.config.json`, token.

Sau khi upload `host/`, domain ví dụ `https://x.example.com/easy-annotator` phải mở được `{domain}/index.php`.

## Chèn thủ công (không dùng AI)

```html
<script src="https://YOUR_HOST/easy-annotator/index.php"></script>
```

## HTML vs Markdown

| Việc | File |
|---|---|
| Người đọc, comment, share | `.html` + embed |
| README, skill, spec, ghi chú cho model | `.md` |

## Config (AI ghi, không commit)

```json
{ "domain": "https://YOUR_HOST/easy-annotator" }
```

Suy ra: embed `{domain}/index.php`, API `{domain}/annotations.php`, trang `{domain}/index.php?name={slug}`.

Token: máy bạn `.annotator-token`. Server: `anno-data/.ai-token` (cạnh file PHP trong `host/`) hoặc env `ANNOTATOR_AI_TOKEN`.

## Skill path

| Agent | Thư mục |
|---|---|
| Codex | `.agents/skills/easy-annotator/` |
| OpenCode | `.opencode/skills/easy-annotator/` |
| Claude | `.claude/skills/easy-annotator/` |
| Cursor | `.cursor/skills/easy-annotator/` |

Gốc trong repo này: `skill/easy-annotator/`.

## Dùng trên trang

Bôi chữ → nút coral. Click ảnh → ghim. Kéo ảnh → vùng. Alt+N panel. Esc đóng popover rồi panel. Chỉ sửa note của mình. Resolve trên reply. AI chỉ đọc và reply. Id: `01`…`99`, rồi `A01`.

## Hosting (một lần)

1. Upload **nội dung** `host/` lên folder PHP public.
2. Tạo token, ghi `anno-data/.ai-token` (chmod 600) trên server. AI setup có thể làm bước này nếu checkout này chứa `host/`.
3. Demo local: trỏ vhost vào `host/` (xem `dev.md`).

`anno-data/` tự tạo, không public.

## Chống spam (ngắn)

Mở để comment, không captcha. Trần server: 10 ghi/IP/phút, 40 ghi/trang/phút, 8 URL mới/10 phút/IP, 200 note/trang, 4000 ký tự, JSON 256 KB, PUT cần `X-Owner-Key`, upload HTML cần token AI. Honeypot trình duyệt chỉ chặn bot form. Sau Cloudflare: `ANNOTATOR_CLIENT_IP_HEADER=CF-Connecting-IP` nếu cần. Không làm trang `/setup` public.

## Gợi ý

Giữ: người không AI nhớ một thẻ script; người có AI dán prompt; hosting chỉ `host/`; review luôn HTML.

Có thể làm tiếp: deploy `host/` bằng rsync/FTP do AI chạy nếu user đưa sẵn credential; không gộp skill vào file PHP (tránh lỡ upload nhầm). Consumer repo không clone PHP, chỉ skill + domain.

Không thêm: tài khoản, captcha, bắt HTTPS cho embed.
