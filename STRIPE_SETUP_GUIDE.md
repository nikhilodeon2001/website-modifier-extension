# Stripe Payment Integration - Complete Setup Guide

This guide will walk you through setting up Stripe payments for the Actually Chrome extension.

## Overview

**What you're building:**
- Users pay $49 one-time via Stripe → receive license key via email → enter key → watermark removed forever

**Cost:** $0/month infrastructure (Cloudflare Workers + Resend free tiers)

---

## Part 1: Deploy Cloudflare Worker (15 minutes)

### Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

### Step 2: Login to Cloudflare

```bash
cd cloudflare-worker
wrangler login
```

This opens a browser window to authorize Wrangler.

### Step 3: Create KV Namespace (License Storage)

```bash
wrangler kv:namespace create LICENSES
```

You'll see output like:
```
🌀 Creating namespace with title "actually-license-server-LICENSES"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "LICENSES", id = "abc123xyz456" }
```

**Copy the `id` value** (e.g., `abc123xyz456`)

### Step 4: Update wrangler.toml

Open `cloudflare-worker/wrangler.toml` and replace:
```toml
id = "YOUR_KV_NAMESPACE_ID"  # Replace with your KV namespace ID
```

With your actual ID:
```toml
id = "abc123xyz456"
```

### Step 5: Deploy Worker

```bash
wrangler publish
```

You'll get a URL like:
```
https://actually-license-server.YOUR-SUBDOMAIN.workers.dev
```

**Copy this URL** - you'll need it later.

### Step 6: Test Worker (Without Secrets Yet)

```bash
curl "https://actually-license-server.YOUR-SUBDOMAIN.workers.dev/validate?key=TEST"
```

Should return:
```json
{"valid":false,"error":"License key not found"}
```

✅ If you see this, the Worker is deployed successfully!

---

## Part 2: Set Up Stripe (10 minutes)

### Step 1: Create Stripe Account

1. Go to [stripe.com](https://stripe.com) → Sign up
2. Complete account setup (business details, etc.)
3. **Stay in TEST MODE** for now (toggle in top-right)

### Step 2: Create Product

1. Dashboard → **Products** → **Add product**
2. Fill in:
   - **Name:** Website Modifier - Lifetime License
   - **Description:** Remove watermarks from AI-transformed pages
   - **Pricing:** $49.00 USD (one-time payment)
   - **Type:** One-time
3. Click **Save product**

### Step 3: Create Payment Link

1. Dashboard → **Payment links** → **New**
2. Select your product ("Website Modifier - Lifetime License")
3. Configure:
   - **Collect customer email:** ✅ Enable (required for license delivery)
   - **Quantity:** ✅ Disable (one license per purchase)
4. Click **Create link**
5. **Copy the Payment Link URL** (looks like: `https://buy.stripe.com/test_abc123xyz`)

### Step 4: Get Stripe API Keys

1. Dashboard → **Developers** → **API keys**
2. Copy **Secret key** (starts with `sk_test_...` in test mode)

**Important:** Keep this secret! Never commit it to code.

### Step 5: Add Stripe Secret to Worker

```bash
cd cloudflare-worker
wrangler secret put STRIPE_SECRET_KEY
```

When prompted, paste your Stripe secret key (the one starting with `sk_test_...`).

---

## Part 3: Set Up Stripe Webhook (5 minutes)

### Step 1: Create Webhook Endpoint

1. Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Enter:
   - **Endpoint URL:** `https://actually-license-server.YOUR-SUBDOMAIN.workers.dev/webhook`
   - **Description:** Actually License Server
4. Click **Select events**
5. Select these events:
   - `checkout.session.completed` (payment successful)
   - `charge.refunded` (customer refunded)
6. Click **Add events** → **Add endpoint**

### Step 2: Get Webhook Signing Secret

1. Click on your newly created webhook
2. Scroll to **Signing secret** → Click **Reveal**
3. Copy the secret (starts with `whsec_...`)

### Step 3: Add Webhook Secret to Worker

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Paste the webhook signing secret when prompted.

---

## Part 4: Set Up Email Delivery (Resend) (5 minutes)

### Step 1: Create Resend Account

1. Go to [resend.com](https://resend.com) → Sign up
2. Verify your email

### Step 2: Verify Domain (or Use Test Domain)

**Option A: Use Test Domain (Quick Testing)**
- Resend provides `onboarding@resend.dev` for testing
- Works immediately, but emails may go to spam
- Good for initial testing

**Option B: Verify Your Domain (Production)**
1. Resend Dashboard → **Domains** → **Add Domain**
2. Enter your domain (e.g., `yourdomain.com`)
3. Add DNS records as instructed
4. Wait for verification (usually < 5 minutes)

### Step 3: Create API Key

1. Dashboard → **API Keys** → **Create API Key**
2. Name: "Actually License Server"
3. Permission: **Full access** (or **Sending access** only)
4. Click **Add**
5. **Copy the API key** (starts with `re_...`)

### Step 4: Add Resend API Key to Worker

```bash
wrangler secret put RESEND_API_KEY
```

Paste the Resend API key when prompted.

### Step 5: Update Worker Email "From" Address

Edit `cloudflare-worker/worker.js` line 239:

**If using test domain:**
```javascript
from: 'Website Modifier <onboarding@resend.dev>',
```

**If using your domain:**
```javascript
from: 'Website Modifier <noreply@yourdomain.com>',
```

Then redeploy:
```bash
wrangler publish
```

---

## Part 5: Update Extension (2 minutes)

### Step 1: Update Worker URL in Extension

Edit `extension/config/config.js` line 175:

Replace:
```javascript
const WORKER_URL = 'https://actually-license-server.YOUR-SUBDOMAIN.workers.dev';
```

With your actual Worker URL:
```javascript
const WORKER_URL = 'https://actually-license-server.abc123.workers.dev';
```

### Step 2: Update Stripe Payment Link

Edit `extension/config/config.html` line 73:

Replace:
```html
<a href="https://buy.stripe.com/YOUR_PAYMENT_LINK_ID" target="_blank">
```

With your actual Payment Link:
```html
<a href="https://buy.stripe.com/test_abc123xyz" target="_blank">
```

### Step 3: Reload Extension

1. Go to `chrome://extensions/`
2. Find "Actually" extension
3. Click **Reload** icon

---

## Part 6: Test Complete Flow (5 minutes)

### Step 1: Test Payment (Test Mode)

1. Open extension → Click ⚙️ Settings
2. Scroll to **License Key** section
3. Click **"Buy License ($49)"** link
4. You'll be redirected to Stripe checkout (TEST MODE)

**Use Stripe test card:**
- Card number: `4242 4242 4242 4242`
- Expiry: Any future date (e.g., `12/34`)
- CVC: Any 3 digits (e.g., `123`)
- ZIP: Any 5 digits (e.g., `12345`)

5. Enter your email (will receive license key)
6. Click **Pay**

### Step 2: Check Email

Within 30-60 seconds, you should receive an email with:
- Subject: "Your Website Modifier License Key"
- License key format: `ACTUALLY-XXXX-YYYY-ZZZZ`

### Step 3: Activate License

1. Copy the license key from email
2. Go back to extension settings
3. Paste license key in **License Key** field
4. Click **Save License Key**
5. Should see: ✅ "License activated successfully!"

### Step 4: Verify Watermark Removal

1. Transform any webpage (without license, you'd see watermark)
2. Watermark should NOT appear
3. ✅ Success!

---

## Part 7: Go Live (Production Mode)

### Step 1: Switch Stripe to Live Mode

1. Stripe Dashboard → Toggle to **Live mode** (top-right)
2. Create new product in Live mode (same as before)
3. Create new Payment Link in Live mode
4. Update `extension/config/config.html` with Live Payment Link

### Step 2: Update Worker with Live Keys

```bash
# Get live secret key from Stripe Dashboard → API keys (Live mode)
wrangler secret put STRIPE_SECRET_KEY
# Paste live key (starts with sk_live_...)

# Create new webhook in Live mode (same as before)
# Get webhook secret
wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste live webhook secret
```

### Step 3: Verify Domain in Resend (If Not Done)

Use your actual domain, not `onboarding@resend.dev` for production.

### Step 4: Test Live Payment

Use a real credit card (Stripe will charge $49) → verify license delivery.

---

## Troubleshooting

### License Email Not Received

**Check Worker logs:**
```bash
wrangler tail
```

Look for errors like:
- `Failed to send email` - Resend API key issue
- `Invalid Stripe signature` - Webhook secret mismatch

**Check Stripe webhook logs:**
1. Dashboard → Developers → Webhooks
2. Click your webhook → View logs
3. Look for failed deliveries

**Check Resend logs:**
1. Resend Dashboard → Logs
2. Check if email was sent successfully

### License Validation Fails

**Test Worker directly:**
```bash
curl "https://your-worker.workers.dev/validate?key=ACTUALLY-TEST-1234-5678"
```

**Check KV storage:**
```bash
wrangler kv:key list --binding=LICENSES
```

### Common Errors

| Error | Solution |
|-------|----------|
| `No API key configured` | Run `wrangler secret put STRIPE_SECRET_KEY` |
| `Invalid signature` | Webhook secret mismatch - regenerate in Stripe Dashboard |
| `CORS error` | Worker not deployed or wrong URL in extension |
| `License key not found` | Payment didn't complete or webhook failed |

---

## Monitoring & Maintenance

### View Logs

```bash
# Live tail Worker logs
wrangler tail

# Or view in Cloudflare Dashboard → Workers → actually-license-server → Logs
```

### Check License Count

```bash
wrangler kv:key list --binding=LICENSES
```

### Manually Create Test License

```bash
wrangler kv:key put "ACTUALLY-TEST-1234-5678" '{"email":"test@example.com","plan":"lifetime","status":"active","issuedAt":"2025-01-15T10:00:00Z"}' --binding=LICENSES
```

### Revoke a License (Refunds)

```bash
# Get license
wrangler kv:key get "ACTUALLY-XXXX-YYYY-ZZZZ" --binding=LICENSES

# Save to file, edit status to "revoked", then:
wrangler kv:key put "ACTUALLY-XXXX-YYYY-ZZZZ" '{"email":"...","status":"revoked",...}' --binding=LICENSES
```

---

## Cost Summary

### Free Tier Limits
- **Cloudflare Workers:** 100,000 requests/day = 3M/month
- **Cloudflare KV:** 1GB storage, 100K reads/day
- **Resend:** 100 emails/day = 3,000/month

### Paid Costs
- **Stripe:** 2.9% + $0.30 per transaction
  - On $49 sale = ~$1.73 fee
  - You keep: ~$47.27 per license

**Expected infrastructure cost:** **$0/month** for up to:
- 3M license validations/month
- 3,000 license sales/month

---

## Next Steps

1. ✅ Test thoroughly in Stripe Test Mode
2. ✅ Verify email delivery works
3. ✅ Test license activation flow
4. Switch to Live Mode when ready
5. Publish extension to Chrome Web Store
6. Market your extension!

---

## Support

**Need help?**
- Cloudflare Workers docs: [developers.cloudflare.com/workers](https://developers.cloudflare.com/workers)
- Stripe docs: [stripe.com/docs](https://stripe.com/docs)
- Resend docs: [resend.com/docs](https://resend.com/docs)

**Common questions:**
- Q: Can I change the price later?
  - A: Yes! Create a new product in Stripe and update the Payment Link
- Q: Can I offer subscriptions?
  - A: Yes, but requires modifying Worker to handle subscription webhooks
- Q: How do I prevent piracy?
  - A: Current implementation validates keys server-side. ~95% effective. See STRIPE_SETUP_GUIDE.md security notes.
