# Đưa lên VPS và vận hành (Phase 16)

Sổ tay từng bước: thuê máy chủ → deploy lần đầu → tự deploy từ GitHub → sao lưu, khôi phục, quay lại bản trước. Thiết kế và lý do: [`phase-16-deployment-design.md`](phase-16-deployment-design.md).

Các lệnh trên **máy chủ** là bash (Ubuntu). Các lệnh trên **máy bạn** dùng PowerShell; Windows 10/11 có sẵn `ssh`, `scp`, `ssh-keygen`.

> **Không dán vào chat** (kể cả với trợ lý AI): khóa riêng SSH, mật khẩu, nội dung `deploy/.env`. Mọi secret được tạo ngay trên máy chủ.

---

## 1. Tổng quan

```
Internet ──443──► Caddy (HTTPS, Let's Encrypt) ──► web (nginx) ──► api ──► PostgreSQL, Redis
                                                              worker ──► SMTP
                  backup (cron 03:15 giờ VN) ──► deploy/backups
```

| Ở đâu | Là gì |
|---|---|
| `/srv/etp/app` | Code (git, ở trạng thái "detached" đúng commit đang chạy) |
| `/srv/etp/app/deploy/.env` | Cấu hình + secret (chỉ trên máy chủ, `chmod 600`) |
| `/srv/etp/app/deploy/backups` | Bản sao lưu (7 ngày + 4 tuần + 5 bản trước mỗi lần deploy) |
| `/srv/etp/app/deploy/.state/history` | Các commit đã deploy, mới nhất ở cuối |
| Volume Docker `etp-prod_*` | Dữ liệu PostgreSQL, Redis, ảnh tải lên, chứng chỉ |

Lệnh Docker Compose trên máy chủ (thay `<tag>` bằng dòng cuối của `history`):

```bash
cd /srv/etp/app
export IMAGE_TAG="$(tail -n 1 deploy/.state/history)"
docker compose -f deploy/docker-compose.prod.yml ps
docker compose -f deploy/docker-compose.prod.yml logs -f --tail 100 api worker
```

## 2. Chuẩn bị

- **VPS**:
  - Ubuntu **24.04**, tối thiểu 2 GB RAM, 1–2 vCPU, 40 GB ổ.
  - Gợi ý vùng **Singapore** (DigitalOcean, Vultr, Linode, khoảng 12 USD/tháng) hoặc VPS ở Việt Nam.
  - Khi tạo máy chủ, chọn đăng nhập bằng **SSH key**, không dùng mật khẩu.
- **Tên miền**: mua ở đâu cũng được. Ví dụ dùng `ve.example.com` cho site.
- **Khóa SSH trên máy bạn**, nếu chưa có (PowerShell):

  ```powershell
  ssh-keygen -t ed25519 -C "may-cua-toi"
  ```

  Dán nội dung `C:\Users\<bạn>\.ssh\id_ed25519.pub` vào ô "SSH key" khi tạo VPS.
- **Email**: tài khoản Brevo hoặc Resend (mục 6), hoặc tạm dùng Gmail.

## 3. Trỏ tên miền về VPS

Ở nơi quản lý DNS, tạo bản ghi:

| Loại | Tên | Giá trị |
|---|---|---|
| `A` | `ve` (hoặc `@` cho tên miền gốc) | IP của VPS |
| `AAAA` (nếu VPS có IPv6) | `ve` | IPv6 của VPS |

Dùng Cloudflare thì để **DNS only** (đám mây xám). Chế độ proxy (đám mây cam) làm sai IP người dùng trong rate limit và cần cấu hình thêm. Kiểm tra: `nslookup ve.example.com` ra đúng IP.

## 4. Thiết lập máy chủ lần đầu

### 4.1 Bảo mật và cài Docker

Trên **máy bạn**, trong thư mục dự án:

```powershell
scp deploy/scripts/bootstrap-server.sh root@<IP>:/root/
```

```powershell
ssh root@<IP> bash /root/bootstrap-server.sh
```

Script (đọc đầu file để biết chi tiết) làm các việc sau:
- cập nhật hệ thống, tự cài bản vá bảo mật;
- cài Docker, tạo user `deploy`;
- SSH chỉ cho dùng khóa, cấm đăng nhập root, bật fail2ban;
- firewall chỉ mở 22 / 80 / 443;
- tạo swap 2 GB.

**Trước khi đóng cửa sổ root**, mở cửa sổ khác và thử `ssh deploy@<IP>`. Được thì mới đóng.

### 4.2 Cho máy chủ đọc được repo (deploy key chỉ đọc)

Trên **máy chủ** (`ssh deploy@<IP>`):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C "etp-server"
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n  IdentitiesOnly yes\n' >> ~/.ssh/config
ssh-keyscan github.com >> ~/.ssh/known_hosts
cat ~/.ssh/github_deploy.pub
```

Trên GitHub: repo → **Settings → Deploy keys → Add deploy key**, dán khóa vừa in, **không** tích "Allow write access". Sau đó, trên máy chủ:

```bash
git clone git@github.com:Vietnguyen203/Cticket.git /srv/etp/app
```

## 5. Cấu hình và deploy lần đầu

Trên **máy chủ**:

```bash
cd /srv/etp/app
bash deploy/scripts/init-env.sh ve.example.com email-cua-ban@example.com
nano deploy/.env        # điền các dòng SMTP_* (mục 6), lưu: Ctrl+O, Enter, Ctrl+X
bash deploy/scripts/deploy.sh origin/main
```

- `init-env.sh` tạo mọi secret ngẫu nhiên ngay trên máy chủ. Email là để Let's Encrypt báo khi chứng chỉ sắp hết hạn; Caddy tự gia hạn.
- Lần đầu build mất 3–5 phút. Caddy lấy chứng chỉ trong vài giây, nếu DNS ở mục 3 đã trỏ đúng.

Tạo admin:

```bash
export IMAGE_TAG="$(tail -n 1 deploy/.state/history)"
docker compose -f deploy/docker-compose.prod.yml exec -e ADMIN_EMAIL=ban@example.com -e ADMIN_PASSWORD='Mat-Khau-Rat-Manh-2026' api npm run seed:admin
```

- Mở `https://ve.example.com`, đăng nhập admin.
- **Quét QR xác thực hai lớp**, rồi **cất 10 mã khôi phục** ở nơi an toàn (trình quản lý mật khẩu, giấy cất kỹ).
- Nên tạo thêm admin thứ hai: nếu một người mất điện thoại thì người kia "Đặt lại 2FA" được.

Kiểm tra từ **máy bạn** (Git Bash):

```bash
bash deploy/scripts/smoke.sh https://ve.example.com
```

## 6. Email

| Cách | Cấu hình trong `deploy/.env` | Ghi chú |
|---|---|---|
| **Brevo** (300 email/ngày miễn phí) | `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER` / `SMTP_PASS` = SMTP login / SMTP key trong Brevo | Thêm tên miền ở Brevo, tạo các bản ghi DNS nó đưa (**SPF, DKIM, DMARC**) để không vào spam. `MAIL_FROM=ETP Tickets <no-reply@ve.example.com>` |
| **Resend** (3.000 email/tháng) | `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`, `SMTP_PASS=<API key>` | Cũng xác minh tên miền bằng bản ghi DNS |
| **Gmail** (tạm thời) | `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=<gmail>`, `SMTP_PASS=<App Password 16 ký tự>` | `MAIL_FROM` phải là chính địa chỉ Gmail đó; giới hạn khoảng 500 email/ngày |

Đổi `.env` xong thì chạy lại `bash deploy/scripts/deploy.sh --checked-out`: nó không build lại gì nếu code không đổi. Thử bằng cách đăng ký một tài khoản trên site, mã OTP phải tới hộp thư.

## 7. Sao lưu

- **Hằng đêm** (03:15 giờ Việt Nam), container `backup` tự `pg_dump` + nén ảnh vào `deploy/backups`.
- **Trước mỗi lần deploy** cũng có một bản (`db-pre-deploy-…`).
- Sao lưu tay:

  ```bash
  docker compose -f deploy/docker-compose.prod.yml exec backup sh /scripts/backup.sh manual
  ```

- **Mỗi tháng một lần**, kiểm tra bản sao lưu khôi phục được (không đụng dữ liệu thật):

  ```bash
  bash deploy/scripts/restore.sh check deploy/backups/db-daily-<thời điểm>.dump
  ```

### Bản sao ngoài máy chủ (khuyến nghị)

VPS hỏng hẳn thì bản sao lưu trên nó cũng mất. Với **Cloudflare R2** (10 GB miễn phí):
1. Trên Cloudflare: **R2 → Create bucket** `etp-backups`. **Manage R2 API Tokens → Create**, quyền "Object Read & Write", chỉ cho bucket đó. Ghi lại Access Key ID, Secret Access Key, và địa chỉ endpoint `https://<account>.r2.cloudflarestorage.com`.
2. Trên máy chủ:

   ```bash
   mkdir -p deploy/rclone && chmod 700 deploy/rclone
   nano deploy/rclone/rclone.conf
   ```

   Nội dung:

   ```ini
   [r2]
   type = s3
   provider = Cloudflare
   access_key_id = <Access Key ID>
   secret_access_key = <Secret Access Key>
   endpoint = https://<account>.r2.cloudflarestorage.com
   ```

3. Thêm `OFFSITE_REMOTE=r2:etp-backups` vào `deploy/.env`. Thử bằng `bash deploy/scripts/offsite-sync.sh`, rồi cài lịch hằng đêm: `bash deploy/scripts/offsite-sync.sh --install-cron`.
4. Trên bucket, đặt quy tắc tự xóa file cũ hơn 60 ngày (Object lifecycle rules).

## 8. Khôi phục và quay lại bản trước

**Bản mới bị lỗi, nhưng database vẫn ổn** (thường gặp nhất):

```bash
bash deploy/scripts/rollback.sh
```

Chạy lại image của commit trước, có sẵn trên máy chủ, mất khoảng 10 giây. `deploy.sh` cũng tự làm việc này nếu bản mới không khỏe trong khoảng 2 phút.

**Bản mới đã đổi database theo cách bản cũ không đọc được**, hoặc **mất / hỏng dữ liệu**:

```bash
ls -lt deploy/backups | head                          # chọn bản sao lưu, ví dụ db-pre-deploy-…
bash deploy/scripts/rollback.sh                       # nếu cần chạy code cũ
bash deploy/scripts/restore.sh apply deploy/backups/db-pre-deploy-<…>.dump deploy/backups/uploads-pre-deploy-<…>.tar.gz
```

Lệnh `restore.sh apply` lần lượt:
1. hỏi lại tên miền để xác nhận;
2. sao lưu dữ liệu hiện tại;
3. dừng API;
4. **đổi tên** database cũ (giữ lại, không xóa), nạp bản sao lưu vào database mới;
5. chạy lại API.

Khi mọi thứ đã ổn, xóa database cũ được giữ lại:

```bash
docker compose -f deploy/docker-compose.prod.yml exec postgres psql -U etp -d postgres -c 'DROP DATABASE etp_before_restore_<…>'
```

**Admin cuối cùng mất cả điện thoại lẫn mã khôi phục**:

```bash
docker compose -f deploy/docker-compose.prod.yml exec api npm run 2fa:reset -- ban@example.com
```

## 9. Tự deploy từ GitHub Actions

Mỗi lần CI trên `main` xanh, workflow **Deploy** SSH vào máy chủ, deploy đúng commit đó, rồi chạy smoke test từ ngoài vào. Workflow này tắt cho tới khi bạn bật.

1. Trên **máy bạn**, tạo cặp khóa riêng cho CI:

   ```powershell
   ssh-keygen -t ed25519 -f etp-ci -N '""' -C github-actions
   ```

2. Trên **máy chủ**, thêm khóa công khai (`etp-ci.pub`) vào `~/.ssh/authorized_keys` của `deploy`, **có giới hạn ở đầu dòng**: khóa này chỉ chạy được lệnh deploy.

   ```bash
   echo 'command="bash /srv/etp/app/deploy/scripts/ci-deploy.sh",restrict <nội dung etp-ci.pub>' >> ~/.ssh/authorized_keys
   ```

3. Lấy khóa máy chủ để CI không bị đánh lừa bởi máy giả:

   ```powershell
   ssh-keyscan -t ed25519 <IP>
   ```

   So dấu vân tay với bảng điều khiển của nhà cung cấp nếu có.
4. Trên GitHub: repo → **Settings → Secrets and variables → Actions**:
   - **Secrets**:
     - `DEPLOY_SSH_KEY` = toàn bộ nội dung file `etp-ci` (khóa riêng). Thêm xong thì xóa file khỏi máy bạn.
     - `DEPLOY_KNOWN_HOSTS` = dòng in ra ở bước 3.
   - **Variables**: `DEPLOY_HOST` = IP, `DEPLOY_DOMAIN` = `ve.example.com`, `DEPLOY_ENABLED` = `true`.
5. Thử bằng tay: tab **Actions → Deploy → Run workflow**.

Muốn tạm dừng tự deploy: đặt `DEPLOY_ENABLED` = `false`.

## 10. Theo dõi

- **Trang "Tình trạng hệ thống"** (Phase 23, Quản trị → Tình trạng hệ thống): request / phút, tỉ lệ lỗi, độ trễ p95, cơ sở dữ liệu, Redis, worker, job nền, hoàn tiền VNPay kẹt, ổ đĩa, lỗi JavaScript trên web. Cảnh báo được email cho mọi admin (và các địa chỉ trong `ALERT_EMAILS` của `deploy/.env`) khi có sự cố, nhắc lại sau 30 phút và báo khi đã hết. Ngưỡng: `docs/phase-23-monitoring-design.md` mục 5.
- **UptimeRobot** hoặc **Better Stack** (miễn phí): monitor HTTP(s) tới `https://ve.example.com/health/ready` mỗi 1–5 phút, báo qua email khi lỗi. Vẫn cần: khi cả máy chủ sập, trang theo dõi bên trong không tự báo được.
- Ổ đĩa: `df -h`. Docker tự xoay vòng log (10 MB × 3 mỗi container). `deploy.sh` chỉ giữ image của 3 bản gần nhất.
- Log:

  ```bash
  docker compose -f deploy/docker-compose.prod.yml logs --since 1h api worker caddy
  ```

## 11. Việc định kỳ và sự cố thường gặp

| Việc | Cách làm |
|---|---|
| Cập nhật Ubuntu | Bản vá bảo mật tự cài. Mỗi tháng: `sudo apt update && sudo apt upgrade`, khởi động lại khi được yêu cầu (`sudo reboot`; mọi container tự chạy lại) |
| Đổi secret bị lộ | Sửa dòng đó trong `deploy/.env` rồi `bash deploy/scripts/deploy.sh --checked-out`. Hậu quả từng loại xem `production-checklist.md` mục 1 |
| Caddy không lấy được chứng chỉ | DNS chưa trỏ đúng, hoặc cổng 80/443 bị chặn. Xem `logs caddy` |
| `deploy.sh` báo "not healthy" | Đã tự quay về bản trước. Xem `logs api` để biết lý do, sửa, push lại |
| Hết RAM khi build | Kiểm tra swap (`free -h`); nâng VPS lên 4 GB nếu thường xuyên |

## 12. Chạy thử trên máy tính

Toàn bộ quy trình chạy được trên máy có Docker, với tên miền `etp.localhost` và chứng chỉ nội bộ của Caddy. CI cũng chạy đúng như vậy ở job "Production stack". Trên Windows dùng Git Bash, và tắt stack dev nếu nó đang chiếm cổng 80/443.

```bash
bash deploy/scripts/init-env.sh etp.localhost internal
bash deploy/scripts/deploy.sh --checked-out
bash deploy/scripts/smoke.sh https://etp.localhost -k --resolve etp.localhost:443:127.0.0.1 --resolve etp.localhost:80:127.0.0.1
```

Dọn: `docker compose -p etp-prod down -v`, rồi xóa `deploy/.env`, `deploy/.state`, `deploy/backups`.

Lưu ý: `deploy.sh <ref>` và `rollback.sh` sẽ **checkout commit khác** ngay trong thư mục đang đứng. Muốn thử chúng trên máy, hãy làm trên một bản `git clone` riêng.

## 13. Thanh toán VNPay (Phase 17)

Thiết kế và các tình huống: [`phase-17-vnpay-design.md`](phase-17-vnpay-design.md). Không cấu hình gì thì VNPay tắt; thanh toán giả lập cũng tắt trên production, nên **site chưa nhận thanh toán** cho tới khi làm mục này.

1. **Lấy mã**. Để thử: đăng ký sandbox tại http://sandbox.vnpayment.vn/devreg/. Bán vé thật: ký hợp đồng với VNPay, họ cấp bộ mã production và hai địa chỉ production (trang thanh toán, API).
2. Trên **máy chủ**, `nano deploy/.env`, điền:
   - `VNPAY_TMN_CODE`, `VNPAY_HASH_SECRET` (từ email của VNPay; không dán vào chat, không gửi qua kênh nào khác);
   - `VNPAY_SERVER_IP` = IP công khai của VPS;
   - tiền thật: thêm `VNPAY_PAY_URL`, `VNPAY_API_URL` của production.
   
   Rồi `bash deploy/scripts/deploy.sh --checked-out`.
3. Trong **trang quản lý merchant** của VNPay, khai báo IPN URL: `https://ve.example.com/api/v1/payments/vnpay/ipn`. Return URL thì API tự gửi theo `DOMAIN`: `https://ve.example.com/payments/vnpay/return`.
4. **Thử**: mua 1 vé, trả bằng thẻ test → đơn PAID, có vé. Mua lần nữa và bấm hủy trên trang VNPay → trang kết quả báo "Bạn đã hủy giao dịch". Admin hoàn tiền đơn đầu → mục Hoàn tiền của đơn chuyển "Đã hoàn". Xem `logs api worker` không có lỗi.

Vận hành:

| Thấy gì | Làm gì |
|---|---|
| Đơn có hoàn tiền **"Hoàn lỗi"** (trang chi tiết đơn của admin, audit `REFUND_FAILED`) | Đọc lý do. VNPay tạm lỗi thì bấm **"Hoàn tiền lại"**; VNPay từ chối hẳn (sai số tiền, giao dịch không hoàn được) thì liên hệ VNPay |
| Khách báo "đã trừ tiền mà đơn hết hạn" | Bình thường: tiền đến muộn được **hoàn tự động** (audit `LATE_PAYMENT_REFUNDED`, email cho khách). Kiểm tra mục Hoàn tiền của đơn |
| VNPay không trả lời (log "VNPay querydr gave no answer") | Đơn đang chờ VNPay được giữ thêm tối đa 10 phút rồi hết hạn; tiền đến sau đó được hoàn. Kiểm tra máy chủ gọi ra được `VNPAY_API_URL` |
| Lộ `VNPAY_HASH_SECRET` | Đổi ngay trong trang merchant của VNPay, sửa `deploy/.env`, deploy lại |
