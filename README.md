# Moto24 พรบ Auto-Fill Extension (POC)

Chrome Extension ที่รับสัญญาจาก moto24 `/registration-tracking` → เปิด dummy พรบ site → กรอก form อัตโนมัติ

## Install (Unpacked)

1. เปิด `chrome://extensions`
2. เปิด "Developer mode" (มุมขวาบน)
3. คลิก "Load unpacked" → เลือกโฟลเดอร์นี้
4. จด Extension ID ที่แสดง (เช่น `abcdefghijklmnop...`)
5. ใส่ Extension ID ใน moto24 `.env.local`: `NEXT_PUBLIC_PRB_EXTENSION_ID=<extension-id>`
6. Restart `pnpm dev`

## Dev Loop

หลังแก้ไฟล์ → กลับมาที่ `chrome://extensions` → คลิก reload icon ที่ extension ของเรา → reload moto24 page

## Design & Plan

- Design: `docs/superpowers/specs/2026-04-13-prb-autofill-chrome-extension-design.md` (in the moto24 repo)
- Plan: `docs/superpowers/plans/2026-04-14-prb-autofill-chrome-extension.md` (in the moto24 repo)
