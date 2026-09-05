# Easy Annotator

Ghi chú trực tiếp trên HTML: bôi chữ, ghim ảnh, lưu JSON, AI đọc và trả lời. Không phụ thuộc npm. Chạy trên PHP 7.4+.

Mục tiêu dùng: **một domain, một thẻ script, một lệnh setup cho AI.**

## 30 giây: chèn thủ công

Trên bất kỳ trang HTML (http, https, localhost, `file://`):

```html
<script src="https://YOUR_HOST/easy-annotator/index.php"></script>
```

Không cần khai báo `ANNOTATOR_API`. Script tự trỏ API về `{domain}/annotations.php`.

## 30 giây: để AI làm

Trong repo đang viết tài liệu, nhắn:

> Setup Easy Annotator. Hỏi tôi đang dùng LLM nào (Codex, OpenCode, Claude). Chỉ cần domain PHP.

AI sẽ hỏi agent + domain, ghi `annotator.config.json` (chỉ field `domain`), tạo token, copy skill đúng chỗ. Không điền `api` / `script` / `pages`.

## Workflow

```
[viết HTML review]
        │
        ├─ Thủ công: dán 1 thẻ <script src="{domain}/index.php">
        │
        └─ AI: PUT {domain}/index.php?name=slug  →  nhận URL chia sẻ
                    │
                    ▼
        người review mở URL, bôi chữ / ghim ảnh, ghi note
                    │
                    ▼
        AI GET comments theo URL đó, reply theo id công khai (01, A01)
        người review bấm Done
```

Comment gắn theo **đúng URL** đang mở. Link chia sẻ luôn là:

`{domain}/index.php?name=ten-tai-lieu`

## Config

`annotator.config.json` (không commit):

```json
{ "domain": "https://YOUR_HOST/easy-annotator" }
```

Suy ra:

| Việc | URL |
|---|---|
| Embed | `{domain}/index.php` |
| API ghi chú | `{domain}/annotations.php` |
| Trang review | `{domain}/index.php?name={slug}` |
| Token máy bạn | `.annotator-token` |
| Token server | `anno-data/.ai-token` hoặc env `ANNOTATOR_AI_TOKEN` |

Slug: chữ thường, số, gạch ngang. AI lấy từ tên file (`Pitch VCFM.html` → `pitch-vcfm`).

## Setup server (một lần)

Copy vào một thư mục PHP public:

- `index.php`, `index.html`, `annotator.js`
- `annotations.php`, `pages.php`
- `bc-anno-pages.php`, `bc-anno-store.php`, `bc-rate-limit.php`

`anno-data/` tự tạo, không cần public. Token AI (cùng giá trị với `.annotator-token`):

```bash
php -r 'echo bin2hex(random_bytes(16)), "\n";'
```

Ghi vào `anno-data/.ai-token` (chmod 600). Demo local: xem `dev.md`.

## Dùng trên trang

- **Bôi chữ** → nút coral → ghi chú.
- **Click ảnh** → ghim điểm. **Kéo trên ảnh** → vùng. Kéo ghim/vùng để đổi chỗ.
- **Alt+N** mở/đóng panel. **Esc** đóng popover rồi panel.
- Ghi chú của bạn mới sửa/xóa được (theo key trình duyệt, không theo IP). Note cũ không có chủ vẫn sửa được.
- **Resolve** chỉ trên reply. AI **chỉ đọc và reply**, không Done, không sửa note người.
- Export JSON luôn kèm comment gốc.

Id trên ghim và list: `01`…`99`, rồi `A01`…`A99`, `B01`…

Rate limit: 10 lần ghi / 60 giây mỗi IP, cộng trần theo trang và theo file mới. Không captcha. Chi tiết: mục **Chống spam**.

## Chống spam

Mô hình cố ý **mở để ghi chú** (embed mọi origin, không tài khoản, không captcha). An toàn ở mức “review link + trần cứng”, không phải tường lửa chống botnet.

**Đã chặt:**

| Lớp | Việc |
|---|---|
| Token AI | Upload HTML và reply kiểu AI. Không token thì không PUT trang. |
| Owner key | PUT comment **bắt buộc** `X-Owner-Key`. Không gắn note “vô chủ” qua API. |
| ACL | Không sửa/xóa note người khác. |
| IP | 10 ghi / 60 giây (PUT + POST). |
| Trang | 40 ghi / 60 giây cùng một URL comment. |
| File mới | Tối đa 8 URL comment mới / 10 phút / IP (chặn tạo `sha1.json` tràn đĩa). |
| Trần trang | 200 note / trang, 8 note mới mỗi lần save, 40 reply / note, 4000 ký tự / note. |
| Payload | JSON comment tối đa 256 KB (trước đây 5 MB). HTML trang 2 MB, cần token. |
| Kho | Tối đa 8000 file comment. `anno-data/` không public. File rate cũ bị xóa. |
| Client | Honeypot + chờ 800 ms + rate 10/60 trên trình duyệt. Chỉ chặn bot form ngây. |

**Còn hở (chấp nhận):**

- Bot `curl` bỏ honeypot. Trần server mới là chỗ chặn.
- Nhiều IP (NAT lẻ / botnet) vẫn ghi được, nhưng **một trang đầy ở 200 note**, **một IP không tạo hàng nghìn file URL**.
- Sau proxy (Cloudflare): mặc định tin `REMOTE_ADDR`. Nếu mọi user ra một IP, họ dùng chung 10/60. Đặt env `ANNOTATOR_CLIENT_IP_HEADER=CF-Connecting-IP` trên host tin cậy. **Không** bật `X-Forwarded-For` mặc định (giả mạo IP).
- GET không rate: đọc thoải mái, không ghi.

**Không làm:** captcha, tài khoản, trang `/setup` public (trang đó sẽ thành chỗ xin token). Link review nên là slug khó đoán, không index SEO.

## Skill cho AI

Gốc (copy sang agent bạn dùng): `skill/easy-annotator/`.

| Agent | Thư mục skill |
|---|---|
| Codex | `.agents/skills/easy-annotator/` |
| OpenCode | `.opencode/skills/easy-annotator/` |
| Claude | `.claude/skills/easy-annotator/` |
| Cursor | `.cursor/skills/easy-annotator/` |

AI upload:

```bash
DOMAIN=$(python3 -c 'import json; print(json.load(open("annotator.config.json"))["domain"].rstrip("/"))')
TOKEN=$(cat .annotator-token)
RESP=$(curl -sS -X PUT "$DOMAIN/index.php?name=my-slug" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/html; charset=utf-8" \
  --data-binary @doc.html)
python3 -c 'import json,sys; print(json.loads(sys.argv[1])["url"])' "$RESP"
```

AI reply id `01`:

```bash
curl -sS -X POST "$API?url=$PAGE&action=reply&id=01" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"Updated slide 2","author":"AI"}'
```

Sau reply, PUT lại HTML cùng `name` để URL chia sẻ không đổi.

`.gitignore` nên có: `annotator.config.json`, `.annotator-token`, `anno-data/`.

## Gợi ý để còn đơn giản hơn

Đã làm trong hướng này: config một field, embed một file `index.php`, setup là prompt, URL trang và embed cùng một entry, AI tự suy ra API từ script.

Nên giữ:

1. **Người không dùng AI** chỉ nhớ một dòng `<script src="…/index.php">`. Không dạy `annotator.js` hay `ANNOTATOR_API`.
2. **Người dùng AI** không điền JSON. Họ trả lời hai câu: agent nào, domain nào.
3. **Người review** không cài gì. Mở URL `index.php?name=…` là xong. Script được server chèn.
4. **Một URL canonical.** `pages.php?name=` redirect sang `index.php?name=` để comment không bị tách hai key.

Có thể làm tiếp nếu muốn gọn nữa (chưa làm):

- **Không cần `annotator.config.json` trên máy** nếu skill hỏi domain mỗi session. File JSON vẫn tiện hơn vì AI không hỏi lại.
- **Consumer repo không clone PHP.** Chỉ cần skill + domain + token.
- **DirectoryIndex:** nếu host ưu tiên `index.php`, vào folder vẫn ra demo HTML khi mở bằng trình duyệt; `<script src="index.php">` vẫn ra JS.

Không nên thêm: tài khoản, captcha, bắt HTTPS cho embed, panel tự mở sau khi save, trang setup public sinh token.
