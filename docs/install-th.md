# คู่มือติดตั้ง Moto24 พรบ Auto-Fill Extension

Chrome Extension สำหรับกรอกข้อมูล พรบ อัตโนมัติบนเว็บ RVP ePolicy จากระบบ Moto24

## ติดตั้งครั้งแรก (ทำครั้งเดียว)

1. **ดาวน์โหลด zip** — ไปที่ [GitHub Releases หน้าล่าสุด](https://github.com/chaptone/moto24-chrome-extension/releases/latest)
   → คลิกไฟล์ `moto24-prb-extension-vX.Y.Z.zip` เพื่อดาวน์โหลด

2. **แตกไฟล์** ลงโฟลเดอร์ที่จะเก็บถาวร — แนะนำ `Documents/moto24-extension/`
   (อย่าวางบน Desktop ที่อาจถูกลบโดยไม่ตั้งใจ)

3. **เปิด Chrome แล้วไปที่** `chrome://extensions`

4. **เปิด Developer mode** — toggle มุมขวาบนของหน้า ให้เป็นสีฟ้า

5. **กดปุ่ม "Load unpacked"** — เลือกโฟลเดอร์ที่แตกไฟล์ไว้ในข้อ 2

6. **ตรวจสอบว่าการ์ด extension ปรากฏ** — ชื่อ "Moto24 พรบ Auto-Fill" version 0.6.0 ขึ้นไป

## ทดสอบว่าใช้งานได้

1. **Login เข้า RVP** — เปิด <https://epolicy4.rvp.co.th/> ในแท็บใหม่ login ตามปกติ (ปล่อยแท็บเปิดไว้)

2. **กลับมาที่ Moto24** — เปิด `/registration-tracking`

3. **ทดสอบกรอก พรบ** — กดปุ่ม **"กรอก พรบ"** ที่แถวใดก็ได้
   - Extension เปิดแท็บ RVP `/Policy/New` ใหม่
   - กรอกฟอร์มอัตโนมัติ ~18 ฟิลด์
   - กลับมาที่ Moto24 จะมี toast แสดงผลลัพธ์

หากกรอกได้ครบ = สำเร็จ ✓

## อัพเดทเวอร์ชั่นใหม่ (ทำเมื่อมี release ใหม่)

1. **ดาวน์โหลด zip ใหม่** จาก [Releases page](https://github.com/chaptone/moto24-chrome-extension/releases/latest) (ลิงก์เดิม — โหลด latest เสมอ)

2. **แตกไฟล์ทับโฟลเดอร์เดิม** — เลือก **"Replace All"** เมื่อระบบถามว่าจะเขียนทับไฟล์เดิมไหม

3. **กลับมาที่** `chrome://extensions` → กดไอคอน **↻ Reload** ที่การ์ด extension

4. **ตรวจสอบว่า version เปลี่ยน** — ดูเลขเวอร์ชันบนการ์ด extension

## Troubleshooting

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| Moto24 ขึ้น "Extension เวอร์ชันเก่า — ต้องอัพเดทก่อน" | extension เก่ากว่าที่ระบบต้องการ | ทำขั้นตอน "อัพเดทเวอร์ชั่นใหม่" |
| Moto24 ขึ้น "กรุณาติดตั้ง Chrome Extension ก่อน" | ยังไม่ได้ติดตั้ง หรือ extension ปิดอยู่ | ตรวจสอบที่ `chrome://extensions` ว่าการ์ด extension toggle เป็นสีฟ้าอยู่ |
| Extension เปิดแท็บ RVP แต่ขึ้น "กรุณา login เข้า RVP ก่อน" | ยังไม่ได้ login RVP | login RVP ในแท็บใหม่ก่อน แล้วลองกดอีกครั้ง |
| Chrome เตือน "Disable developer mode extensions" ทุกครั้งที่เปิด | Chrome เตือนเรื่อง developer mode | ปกติของ Chrome ไม่ใช่ปัญหา — กด Cancel แล้วใช้งานต่อได้ |
| ไม่เห็นปุ่ม "กรอก พรบ" บนหน้า registration-tracking | สิทธิ์ของบัญชี | ติดต่อ admin ตรวจสอบสิทธิ์ |

## ติดต่อ

หากเจอปัญหานอกเหนือจากในตาราง — แจ้ง dev team พร้อมข้อมูล:
- เวอร์ชัน extension (ดูที่ `chrome://extensions`)
- ข้อความ error ที่เห็น (capture หน้าจอ)
- Browser console logs (`chrome://extensions` → "Inspect views: service worker")
