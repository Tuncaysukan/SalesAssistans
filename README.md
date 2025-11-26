# DM Sales Assistant — README (Türkçe)

## İçindekiler
- Hızlı Başlangıç
- Mimari ve Bileşenler
- Gereksinimler
- Kurulum
- Çalıştırma
- Ortam Değişkenleri
- Web UI
- Webhooklar (Meta)
- İç Servis Uçları (Laravel)
- Gönderim Kuralları (WA 24h)
- AI İşleri (Niyet + Taslak)
- Raporlama
- Test Senaryoları
- Sorun Giderme
- Güvenlik ve Uyum
- V1 Yol Haritası Özeti (todos-v1.mvp)

---

## Hızlı Başlangıç
1) Veritabanı ve Kuyruk:
- Postgres ve Redis çalışıyor olmalı (lokalde: `localhost`).
2) Laravel API:
- Dizin: `c:\Users\Tncy\Desktop\SalesAssistans\apps\laravel-api`
- Kurulum:
  ```
  composer install
  Copy-Item .env.example .env -Force
  php artisan key:generate
  php artisan migrate
  php artisan db:seed
  php artisan serve --host 127.0.0.1 --port 8000
  ```
3) Node API:
- Dizin: `c:\Users\Tncy\Desktop\SalesAssistans\apps\node-api`
- Kurulum ve Çalıştırma:
  ```
  npm install
  npm run start        # API
  npm run start:classify
  npm run start:draft  # workerlar
  ```

---

## Mimari ve Bileşenler
- Node API:
  - Webhook alımı (WhatsApp/Instagram), AI iş kuyrukları (BullMQ), raporlama, basit web UI.
- Laravel API:
  - Çoklu-tenant veri modeli, iç servis uçları, iş kuralları, idempotensi.
- Redis:
  - BullMQ iş kuyrukları (classify, draft, followup).
- Postgres:
  - `tenants`, `contacts`, `conversations`, `messages`, `ai_jobs` gibi tablolar.

---

## Gereksinimler
- Postgres (DB)
- Redis (Queue)
- PHP 8.2+, Composer (Laravel)
- Node 18+

---

## Kurulum
- Laravel `.env`:
  ```
  DB_CONNECTION=pgsql
  DB_HOST=127.0.0.1
  DB_PORT=5432
  DB_DATABASE=salesassistans
  DB_USERNAME=postgres
  DB_PASSWORD=postgres

  REDIS_HOST=127.0.0.1
  REDIS_PORT=6379

  INTERNAL_SECRET=devsecret123
  ```
- Node `.env` (örnek):
  ```
  REDIS_HOST=localhost
  REDIS_PORT=6379
  LARAVEL_URL=http://127.0.0.1:8000/api
  INTERNAL_SECRET=devsecret123
  NODE_API_PORT=3001

  OPENAI_API_KEY=
  WA_TOKEN=
  WA_PHONE_NUMBER_ID=
  IG_PAGE_ID=
  IG_TOKEN=
  REPORT_DEBUG_CRON_MS=60000
  FOLLOWUP_DEBUG_MS=5000
  ```

---

## Çalıştırma
- Laravel API:
  ```
  php artisan serve --host 127.0.0.1 --port 8000
  ```
- Node API ve Worker’lar:
  ```
  npm run start
  npm run start:classify
  npm run start:draft
  ```

---

## Ortam Değişkenleri
- Ortak:
  - `INTERNAL_SECRET`: Node → Laravel iç çağrıları için HMAC gizli anahtar.
- Node:
  - `LARAVEL_URL`: `http://127.0.0.1:8000/api`
  - `OPENAI_API_KEY`, `OPENAI_MODEL_MINI`
  - `WA_TOKEN`, `WA_PHONE_NUMBER_ID`
  - `IG_PAGE_ID`, `IG_TOKEN`
  - `REPORT_DEBUG_CRON_MS`, `FOLLOWUP_DEBUG_MS`
- Laravel:
  - `DB_*`, `REDIS_*`, `INTERNAL_SECRET`
  - Opsiyonel: `WA_PHONE_NUMBER_ID`, `IG_PAGE_ID` (seed için)

---

## Web UI
- Inbox: `http://localhost:3001/`
  - Konuşma listesi, mesajlar, AI taslak, gönderim, durum değiştirme.
- Dashboard: `http://localhost:3001/dashboard.html`
  - Inbound/Outbound, intent dağılımı, funnel, raporlar.

---

## Webhooklar (Meta)
- WhatsApp:
  - `POST http://localhost:3001/webhooks/whatsapp`
  - Gövde `metadata.phone_number_id` ve `messages[]` dizisini içerir.
- Instagram:
  - `POST http://localhost:3001/webhooks/instagram`
  - Gövde `page_id` ve `changes[].value.messages[]`.

Node, gelen mesajı `POST /api/internal/ingest` ile Laravel’e HMAC imzalı iletir.

---

## İç Servis Uçları (Laravel)
- `POST /api/internal/ingest`: Gelen mesajı kaydeder; konuşmayı oluşturur/günceller.
- `POST /api/internal/intent`: Intent/lead_score güncelle.
- `POST /api/internal/ai/classified`: AI sınıflandırma sonucu.
- `POST /api/internal/ai/draft`: AI taslak sonucu.
- `POST /api/internal/followup/overdue`: Konuşmayı `overdue=true` işaretler.
- `GET /api/internal/conversations`: Son konuşmalar (liste).
- `GET /api/internal/conversations/{id}`: Konuşma detayı.

Not: `POST` istekleri `X-Internal-Signature: sha256=<hmac>` içerir (HMAC SHA256, gövdeye göre). Middleware: `app/Http/Middleware/InternalSignature.php`.

---

## Gönderim Kuralları (WA 24h)
- 24 saat içinde: `text` serbest.
- 24 saat dışı: onaylı `template` kullanılır.
- Node endpoint:
  ```
  POST /conversations/:id/send
  body: { "text": "..." }   # 24h içi
  ```
- Kanal `wa` ise ve dışarıdaysa `template` gönderilir (tenant config’te isim).

---

## AI İşleri (Niyet + Taslak)
- Niyet Sınıflandırma:
  - Heuristik + OpenAI (`gpt-5-mini`), JSON zorlanmış çıktı.
  - Kuyruk iş bitince `POST /api/internal/ai/classified`.
- Taslak Yanıt:
  - Kısa, nazik Türkçe yanıt üretimi + `next_action`.
  - Kuyruk iş bitince `POST /api/internal/ai/draft`.
- SLA Takip (Follow‑up):
  - Son müşteri mesajından sonra ajan yanıt yoksa gecikmeli kontrol ve `overdue` işareti.

---

## Raporlama
- Günlük:
  - `GET /reports/daily`
- Gece/Periyodik:
  - `GET /reports/nightly/latest`
  - `GET /reports/nightly/all`
- Görselleştirme:
  - `dashboard.html` üzerinde bar chart’lar.

---

## Test Senaryoları
- WhatsApp ingest örneği:
  ```
  POST http://127.0.0.1:3001/webhooks/whatsapp
  {
    "entry":[{"changes":[{"value":{
      "metadata":{"phone_number_id":"wa_dev_1"},
      "messages":[{"id":"wamid.HBgMDEy","from":"905555555555","timestamp":"1732610600","text":{"body":"Ürün fiyatını öğrenebilir miyim?"}}]
    }}]}]
  }
  ```
- Konuşma listesi doğrulama:
  ```
  GET http://127.0.0.1:8000/api/internal/conversations
  ```
- Taslak onay ve gönder:
  - Inbox’ta konuşma seç → “Onayla ve Gönder” → `POST /conversations/:id/send`
- 24h dışı template testi:
  - Son müşteri mesajı üzerinden 24h geçtiyse `type=template` beklenir.

---

## Sorun Giderme
- 401 iç uçlarda:
  - `INTERNAL_SECRET` her iki tarafta aynı mı?
  - `POST` gövdesi HMAC imzalanıyor mu (`sha256=<hmac>`)?
- 500/404 Laravel:
  - Route’lar kayıtlı mı: `php artisan route:list --path=api/internal`
  - Migration’lar çalıştı mı: `php artisan migrate`
- Meta Rate Limit:
  - Retry/backoff ekli mi, token geçerli mi (`WA_TOKEN`, `IG_TOKEN`)?

---

## Güvenlik ve Uyum
- HMAC iç servis güvenliği (Node → Laravel).
- PII masking: Telefon/e‑mail loglarda maskele.
- Tenant izolasyonu: Her sorguda `tenant_id` filtreleri.
- RBAC: `admin/agent/viewer` policy’leri.

---

## V1 Yol Haritası Özeti (todos-v1.mvp)
- Ürün sağlamlaştırma: trace id, global hata, healthcheck, rate‑limit+retry, DLQ, yedek/rollback.
- Multi‑tenant: onboarding wizard, plan/limit enforcement, audit log.
- Ödeme: planlar, abonelik yaşam döngüsü, ödeme entegrasyonu, webhook sync, faturalar.
- Template manager: Vue CRUD, Laravel `templates`, Meta sync, mapping.
- Sektör playbook’ları: boutique/clinic/service JSON paketleri, onboarding kopyası, intent/SLA/stage setleri.
- Katalog/KB: `products` tablosu, draft prompt zenginleştirme, ürün intent bağlama.
- Gelişmiş AI: next best action, otomatik stage + “neden?”, feedback loop.
- Ekip akışı: assignment, internal notes+mentions, SLA UI, canned replies.
- Entegrasyonlar: connector’lar (Sheets, 1 CRM, Calendar), webhook out.
- Analitik: gerçek funnel, intent dönüşüm, FRT user, kaçan lead, CSV/PDF.
- Dağıtım: CI/CD, staging/prod ayrımı, auto migrations, domain+SSL+reverse proxy.

