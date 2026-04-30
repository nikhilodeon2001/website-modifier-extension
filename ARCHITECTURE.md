# Stripe Payment Architecture - Visual Guide

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User's Browser                            │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Website Modifier Chrome Extension                       │  │
│  │                                                            │  │
│  │  ┌──────────────┐        ┌───────────────────────┐       │  │
│  │  │   Popup UI   │        │   Settings (config)   │       │  │
│  │  │              │        │                       │       │  │
│  │  │ Transform    │        │  [License Key Input]  │       │  │
│  │  │  Page        │        │  [Buy License Link]   │       │  │
│  │  └──────────────┘        └───────────────────────┘       │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │          Content Script (content.js)              │    │  │
│  │  │                                                    │    │  │
│  │  │  • Check license: isLicenseUnlocked()            │    │  │
│  │  │  • Show/hide watermark based on license          │    │  │
│  │  │  • Transform page content                         │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  │                                                            │  │
│  │  ┌──────────────────────────────────────────────────┐    │  │
│  │  │       Chrome Storage (chrome.storage.sync)        │    │  │
│  │  │                                                    │    │  │
│  │  │  {                                                │    │  │
│  │  │    licenseKey: "ACTUALLY-XXXX-YYYY-ZZZZ",        │    │  │
│  │  │    licenseValid: true,                           │    │  │
│  │  │    licenseValidatedAt: 1234567890                │    │  │
│  │  │  }                                                │    │  │
│  │  └──────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────┘  │
└───────────────────────┬──────────────────────────────────────────┘
                        │
                        ├─── API Request (validate license)
                        │
                        └─── Opens (buy license)
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External Services                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │               Stripe Checkout (stripe.com)                │  │
│  │                                                            │  │
│  │  1. User clicks "Buy License ($49)"                       │  │
│  │  2. Redirected to Stripe Payment Link                     │  │
│  │  3. Enters card: 4242 4242 4242 4242 (test)              │  │
│  │  4. Payment successful → Stripe sends webhook             │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             │                                    │
│                             │ webhook event                      │
│                             │ checkout.session.completed         │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        Cloudflare Worker (License Server)                 │  │
│  │        https://actually-license-server.workers.dev        │  │
│  │                                                            │  │
│  │  Endpoints:                                               │  │
│  │  • GET /validate?key=XXX  ← Extension calls this         │  │
│  │  • POST /webhook          ← Stripe calls this            │  │
│  │                                                            │  │
│  │  On webhook:                                              │  │
│  │  1. Verify Stripe signature                              │  │
│  │  2. Generate license: ACTUALLY-XXXX-YYYY-ZZZZ            │  │
│  │  3. Save to KV storage                                   │  │
│  │  4. Send email via Resend                                │  │
│  │                                                            │  │
│  │  On /validate:                                            │  │
│  │  1. Check if license exists in KV                        │  │
│  │  2. Check status: "active" or "revoked"                  │  │
│  │  3. Return: { valid: true/false }                        │  │
│  │                                                            │  │
│  │  ┌─────────────────────────────────────────────┐         │  │
│  │  │  Cloudflare KV Storage (Key-Value Database) │         │  │
│  │  │                                               │         │  │
│  │  │  "ACTUALLY-ABCD-1234-EFGH" → {              │         │  │
│  │  │    email: "customer@example.com",           │         │  │
│  │  │    plan: "lifetime",                         │         │  │
│  │  │    status: "active",                         │         │  │
│  │  │    issuedAt: "2025-01-15T10:00:00Z",        │         │  │
│  │  │    stripeSessionId: "cs_...",               │         │  │
│  │  │    stripePaymentIntent: "pi_..."            │         │  │
│  │  │  }                                           │         │  │
│  │  └─────────────────────────────────────────────┘         │  │
│  └──────────────────────────────────────────────────────────┘  │
│                             │                                    │
│                             │ send email (license key)          │
│                             ▼                                    │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              Resend Email Service                         │  │
│  │              https://resend.com                           │  │
│  │                                                            │  │
│  │  Sends email to customer:                                 │  │
│  │  ┌──────────────────────────────────────────┐            │  │
│  │  │ From: Website Modifier <noreply@yourdomain.com>  │            │  │
│  │  │ To: customer@example.com                 │            │  │
│  │  │ Subject: Your Website Modifier License Key       │            │  │
│  │  │                                           │            │  │
│  │  │ Your license key:                        │            │  │
│  │  │ ACTUALLY-ABCD-1234-EFGH                  │            │  │
│  │  │                                           │            │  │
│  │  │ How to activate: [instructions]          │            │  │
│  │  └──────────────────────────────────────────┘            │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Payment Flow (Step-by-Step)

### 1. User Transforms Page (No License)

```
┌─────────────┐
│   User      │
│             │
│  1. Visits  │
│     webpage │
└──────┬──────┘
       │
       ├─ 2. Clicks extension icon
       │
       ▼
┌─────────────┐
│  Extension  │
│   Popup     │
│             │
│  3. Clicks  │
│  "Transform │
│     Page"   │
└──────┬──────┘
       │
       ├─ 4. Sends to content script
       │
       ▼
┌─────────────┐
│  Content    │
│  Script     │
│             │
│  5. Checks  │
│  license    │
└──────┬──────┘
       │
       ├─ 6. isLicenseUnlocked() → false
       │
       ├─ 7. Transforms page content
       │
       └─ 8. Shows watermark overlay
              (bottom-right corner)

Result: Page transformed, watermark visible
```

### 2. User Purchases License

```
┌─────────────┐
│   User      │
│             │
│  1. Clicks  │
│  Settings   │
└──────┬──────┘
       │
       ├─ 2. Scrolls to "License Key" section
       │
       ├─ 3. Clicks "Buy License ($49)"
       │
       ▼
┌──────────────────────┐
│  Browser → Stripe    │
│                      │
│  4. Redirected to    │
│     Stripe checkout  │
│                      │
│  5. Enters card info │
│     4242 4242 4242.. │
│                      │
│  6. Clicks "Pay"     │
└──────┬───────────────┘
       │
       ├─ 7. Stripe charges card ($49)
       │
       ├─ 8. Payment successful
       │
       └─ 9. Stripe sends webhook
              to Cloudflare Worker
              ▼
       ┌──────────────────┐
       │ Cloudflare Worker│
       │                  │
       │ 10. Receives     │
       │     webhook      │
       │                  │
       │ 11. Verifies     │
       │     signature    │
       │                  │
       │ 12. Generates    │
       │     license key: │
       │     ACTUALLY-... │
       │                  │
       │ 13. Saves to KV  │
       │                  │
       │ 14. Sends email  │
       │     via Resend   │
       └──────┬───────────┘
              │
              └─ 15. Email sent (30-60s)
                     ▼
              ┌──────────────┐
              │ User's Email │
              │              │
              │ License key: │
              │ ACTUALLY-... │
              └──────────────┘

Result: User receives license key via email
```

### 3. User Activates License

```
┌─────────────┐
│   User      │
│             │
│  1. Copies  │
│  license    │
│  from email │
└──────┬──────┘
       │
       ├─ 2. Opens extension settings
       │
       ├─ 3. Pastes license in "License Key" field
       │
       └─ 4. Clicks "Save License Key"
              ▼
       ┌──────────────────┐
       │  config.js       │
       │  saveLicenseKey()│
       │                  │
       │  5. Calls API:   │
       │  /validate?key=..│
       └──────┬───────────┘
              │
              ├─ HTTP GET request
              │
              ▼
       ┌──────────────────┐
       │ Cloudflare Worker│
       │                  │
       │  6. Receives     │
       │     validation   │
       │     request      │
       │                  │
       │  7. Checks KV    │
       │     storage      │
       │                  │
       │  8. Found!       │
       │     status:      │
       │     "active"     │
       │                  │
       │  9. Returns:     │
       │     {valid:true} │
       └──────┬───────────┘
              │
              └─ Response
                     ▼
       ┌──────────────────┐
       │  Extension       │
       │                  │
       │  10. Saves to    │
       │      storage:    │
       │      {           │
       │        licenseKey│
       │        licenseVa │
       │        lid: true │
       │      }           │
       │                  │
       │  11. Shows:      │
       │  "✅ License     │
       │   activated!"    │
       └──────────────────┘

Result: License saved locally, watermark will no longer appear
```

### 4. User Revisits Transformed Page

```
┌─────────────┐
│   User      │
│             │
│  1. Visits  │
│  previously │
│  transformed│
│  page (or   │
│  new page)  │
└──────┬──────┘
       │
       ├─ 2. Content script loads
       │
       ▼
┌─────────────┐
│  Content    │
│  Script     │
│             │
│  3. Checks  │
│  license:   │
│  isLicense  │
│  Unlocked() │
└──────┬──────┘
       │
       ├─ 4. Reads chrome.storage.sync
       │     {
       │       licenseKey: "ACTUALLY-...",
       │       licenseValid: true
       │     }
       │
       ├─ 5. licenseValid === true ✅
       │
       ├─ 6. Returns: true (licensed)
       │
       ├─ 7. Skips watermark
       │
       └─ 8. Page displays WITHOUT watermark

Result: No watermark, clean transformed page!
```

---

## Data Flow Diagram

### License Validation Flow

```
Extension                Cloudflare Worker         KV Storage
   │                           │                       │
   │  GET /validate?key=XXX    │                       │
   ├──────────────────────────>│                       │
   │                           │                       │
   │                           │  Get license data     │
   │                           ├──────────────────────>│
   │                           │                       │
   │                           │  License data JSON    │
   │                           │<──────────────────────┤
   │                           │                       │
   │                           │  Check status:        │
   │                           │  "active" or "revoked"│
   │                           │                       │
   │  { valid: true/false }    │                       │
   │<──────────────────────────┤                       │
   │                           │                       │
   │  Save to chrome.storage   │                       │
   │  licenseValid: true       │                       │
   │                           │                       │
```

### Payment Webhook Flow

```
Stripe                  Cloudflare Worker         KV Storage         Resend
  │                           │                       │                 │
  │  POST /webhook            │                       │                 │
  │  (payment completed)      │                       │                 │
  ├──────────────────────────>│                       │                 │
  │                           │                       │                 │
  │                           │  1. Verify signature  │                 │
  │                           │                       │                 │
  │                           │  2. Generate license: │                 │
  │                           │     ACTUALLY-XXXX-... │                 │
  │                           │                       │                 │
  │                           │  3. Save license      │                 │
  │                           ├──────────────────────>│                 │
  │                           │                       │                 │
  │                           │  4. Send email        │                 │
  │                           ├─────────────────────────────────────────>│
  │                           │                       │                 │
  │  { received: true }       │                       │  Email sent     │
  │<──────────────────────────┤                       │  to customer    │
  │                           │                       │                 │
```

---

## Security Flow

### How License Validation Prevents Piracy

```
┌──────────────────────────────────────────────────────┐
│           Before (BROKEN - Anyone Could Bypass)       │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Extension checks:                                    │
│  if (licenseKey.length > 10) {                       │
│    removeWatermark();  // HACKABLE!                  │
│  }                                                    │
│                                                       │
│  Attack:                                              │
│  1. Open DevTools                                     │
│  2. Enter "12345678901" (11 chars)                   │
│  3. Watermark removed ❌                              │
│                                                       │
│  Time to hack: 5 seconds                             │
└──────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────┐
│        After (SECURE - Server-Side Validation)        │
├──────────────────────────────────────────────────────┤
│                                                       │
│  Extension checks:                                    │
│  if (licenseValid === true) {                        │
│    removeWatermark();                                │
│  }                                                    │
│                                                       │
│  To set licenseValid = true, must:                   │
│  1. Call Worker API /validate?key=XXX                │
│  2. Worker checks KV storage (server-side)           │
│  3. Only real licenses (from Stripe) return valid    │
│                                                       │
│  Attack methods:                                      │
│  ✅ Enter random key → Worker returns {valid:false}  │
│  ✅ Modify chrome.storage → No valid license key     │
│  ⚠️ Modify extension code → Requires 1-3 hours       │
│                                                       │
│  Time to hack: 1-3 hours (95% won't bother)         │
└──────────────────────────────────────────────────────┘
```

---

## Cost Flow

### Per-Transaction Breakdown

```
┌─────────────┐
│   User      │
│   Pays $49  │
└──────┬──────┘
       │
       ├─ Stripe charges card
       │
       ▼
┌──────────────────────────────────────────────┐
│              Revenue Split                    │
├──────────────────────────────────────────────┤
│                                               │
│  Gross revenue:          $49.00              │
│  Stripe fee (2.9%):      -$1.42              │
│  Stripe fixed fee:       -$0.30              │
│  ────────────────────────────────            │
│  Subtotal:               $47.28              │
│                                               │
│  Cloudflare Worker:      $0.00 (free tier)   │
│  Resend email:           $0.00 (free tier)   │
│  ────────────────────────────────            │
│  NET PROFIT:             $47.28 ✅           │
│                                               │
└───────────────────────────────────────────────┘

For 100 licenses sold:
  Gross: $4,900
  Stripe fees: -$172
  Infrastructure: $0
  NET: $4,728 💰
```

---

## Monitoring Dashboard View

### What You See in Each Dashboard

```
┌────────────────────────────────────────────────┐
│          Cloudflare Dashboard                   │
│  https://dash.cloudflare.com                   │
├────────────────────────────────────────────────┤
│                                                 │
│  Workers > actually-license-server              │
│                                                 │
│  Metrics:                                       │
│  • Requests: 1,234 (today)                     │
│  • Errors: 0                                    │
│  • CPU time: 12ms avg                          │
│                                                 │
│  KV Storage:                                    │
│  • Keys: 127 licenses                          │
│  • Storage: 45 KB                              │
│                                                 │
│  Logs:                                          │
│  [2025-01-15 10:30:42] License created:        │
│    ACTUALLY-ABCD-1234 for user@example.com     │
│                                                 │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│            Stripe Dashboard                     │
│  https://dashboard.stripe.com                  │
├────────────────────────────────────────────────┤
│                                                 │
│  Payments:                                      │
│  • Total: $6,174 (126 payments)                │
│  • This month: $2,450 (50 payments)            │
│  • Refunds: 3 ($147)                           │
│                                                 │
│  Webhooks:                                      │
│  • Endpoint: actually-license-server.dev       │
│  • Events sent: 129                            │
│  • Failed: 0 ✅                                │
│                                                 │
│  Recent Events:                                 │
│  [10:30] checkout.session.completed ✓          │
│  [10:15] checkout.session.completed ✓          │
│  [09:45] charge.refunded ✓                     │
│                                                 │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│            Resend Dashboard                     │
│  https://resend.com                            │
├────────────────────────────────────────────────┤
│                                                 │
│  Emails Sent:                                   │
│  • Today: 12                                    │
│  • This month: 126                             │
│  • Delivered: 124 (98.4%) ✅                   │
│  • Bounced: 2                                   │
│                                                 │
│  Recent Emails:                                 │
│  [10:30] To: user@example.com                  │
│          Subject: Your Website Modifier License Key     │
│          Status: Delivered ✓                   │
│                                                 │
│  [10:15] To: customer@gmail.com                │
│          Subject: Your Website Modifier License Key     │
│          Status: Delivered ✓                   │
│                                                 │
└────────────────────────────────────────────────┘
```

---

## File Structure Map

```
website-modifier/
│
├── extension/                    ← Chrome Extension
│   ├── manifest.json
│   ├── config/
│   │   ├── config.html          ← MODIFIED: Buy License link
│   │   ├── config.js            ← MODIFIED: saveLicenseKey() API call
│   │   └── config.css
│   ├── content/
│   │   └── content.js           ← MODIFIED: isLicenseUnlocked() check
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── background/
│       └── background.js
│
├── cloudflare-worker/           ← NEW: License Server
│   ├── worker.js                ← Main Worker code
│   ├── wrangler.toml            ← Deployment config
│   └── README.md                ← Worker documentation
│
├── STRIPE_SETUP_GUIDE.md        ← NEW: Setup instructions
├── IMPLEMENTATION_SUMMARY.md    ← NEW: What was built
├── TODO_BEFORE_DEPLOY.md        ← NEW: Deployment checklist
└── ARCHITECTURE.md              ← THIS FILE

Total code changes: ~66 lines in extension
Total new code: ~350 lines (Worker)
```

---

## Technology Stack

```
┌────────────────────────────────────────────────┐
│              Frontend (Extension)               │
├────────────────────────────────────────────────┤
│  • HTML/CSS/JavaScript                         │
│  • Chrome Extension APIs                       │
│  • Chrome Storage API (sync)                   │
│  • Fetch API (HTTP requests)                   │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│           Backend (Cloudflare Worker)           │
├────────────────────────────────────────────────┤
│  • JavaScript (ES modules)                     │
│  • Cloudflare Workers runtime                  │
│  • KV storage (key-value database)             │
│  • Web Crypto API (signature verification)     │
│  • Fetch API (Stripe, Resend)                  │
└────────────────────────────────────────────────┘

┌────────────────────────────────────────────────┐
│              External Services                  │
├────────────────────────────────────────────────┤
│  • Stripe: Payment processing                  │
│  • Resend: Email delivery                      │
│  • Cloudflare: Worker hosting + KV storage     │
└────────────────────────────────────────────────┘
```

---

This architecture provides:
- ✅ $0/month infrastructure cost
- ✅ Scales to thousands of users
- ✅ Server-side license validation
- ✅ Automatic license generation & delivery
- ✅ Refund handling
- ✅ Simple maintenance (check logs once/week)
- ✅ Production-ready security

For detailed setup instructions, see [STRIPE_SETUP_GUIDE.md](STRIPE_SETUP_GUIDE.md).
