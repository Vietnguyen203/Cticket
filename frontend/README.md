# ETP — Web (Phase 11)

Web cho khách hàng và nhân viên soát vé: Vite + React + TypeScript + React Router + Axios + Tailwind.
Thiết kế: [docs/phase-11-web-design.md](../docs/phase-11-web-design.md).

## Chạy khi dev

API phải đang chạy trong Docker (`docker compose up -d` ở thư mục gốc, API ở cổng 3001).

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Trình duyệt chỉ gọi `http://localhost:5173`: Vite chuyển tiếp `/api/*` và `/ws` sang API (biến `API_PROXY_TARGET`, mặc định `http://localhost:3001`). Nhờ vậy web và API cùng một nguồn: không cần CORS, cookie đăng nhập đơn giản.

`npm run dev:https`: HTTPS tự ký, mở được từ điện thoại cùng Wi-Fi (`https://<IP máy tính>:5173`), cần cho camera quét QR. Thêm địa chỉ đó vào `CORS_ORIGINS` của API (WebSocket kiểm tra `Origin`).

## Lệnh khác

| Lệnh | Việc |
|---|---|
| `npm test` | Test logic (Vitest) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run lint` | oxlint |
| `npm run build` | Build bản tĩnh vào `dist/` |

## Đăng nhập trong trình duyệt

- Access token (15 phút) chỉ nằm trong bộ nhớ (`src/auth/session.ts`), mất khi tải lại trang.
- Refresh token (7 ngày) nằm trong **cookie httpOnly** do API đặt (header `X-Auth-Transport: cookie`): JavaScript không đọc được.
- Mỗi lúc chỉ một lần refresh, kể cả giữa các tab (Web Locks API), vì API coi refresh token bị dùng lại là bị đánh cắp và thu hồi cả phiên.
