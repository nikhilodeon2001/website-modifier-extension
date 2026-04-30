# Stripe Setup - Quick Start Guide

**Goal:** Accept payments and automatically generate license keys for Website Modifier extension.

**Time:** ~30 minutes for test mode, +10 minutes to go live

---

## Prerequisites

- ✅ Stripe account (free - sign up at stripe.com)
- ✅ Cloudflare account (free - sign up at cloudflare.com)
- ✅ Resend account (free - sign up at resend.com)

---

## Part 1: Deploy Cloudflare Worker (10 minutes)

This is your license server that validates keys and handles payments.

### Step 1: Install Wrangler CLI

```bash
npm install -g wrangler
```

### Step 2: Login to Cloudflare

```bash
cd cloudflare-worker
wrangler login
```

This opens a browser window to authorize.

### Step 3: Create KV Namespace (License Database)

```bash
wrangler kv:namespace create LICENSES
```

You'll see output like:
```
✨ Success!
{ binding = "LICENSES", id = "abc123xyz456" }
```

**Copy the `id` value** (e.g., `abc123xyz456`)

### Step 4: Update wrangler.toml

Edit `cloudflare-worker/wrangler.toml`:

Find line 15:
```toml
id = "YOUR_KV_NAMESPACE_ID"
```

Replace with your actual ID:
```toml
id = "abc123xyz456"
```

### Step 5: Deploy the Worker

```bash
wrangler publish
```

You'll get a URL like:
```
✨ Published at https://website-modifier-license.your-name.workers.dev
```

**✅ Copy this URL - you'll need it!**

Test it works:
```bash
curl "https://website-modifier-license.your-name.workers.dev/validate?key=TEST"
```

Should return: `{"valid":false,"error":"License key not found"}`

---

## Part 2: Set Up Stripe (10 minutes)

### Step 1: Create Stripe Account

1. Go to [stripe.com](https://stripe.com)
2. Sign up (it's free)
3. **Stay in TEST MODE** (toggle in top-right corner)

### Step 2: Create Product

1. Dashboard → **Products** → **Add product**
2. Fill in:
   - **Name:** Website Modifier - Lifetime License
   - **Description:** Remove watermarks from AI-transformed pages
   - **Pricing:** One-time payment
   - **Price:** $49.00 USD (or whatever you want to charge)
3. Click **Save product**

### Step 3: Create Payment Link

1. Dashboard → **Payment links** → **New**
2. Select your product
3. Configure:
   - ✅ **Collect customer email** (required for sending license)
   - ❌ Quantity (disabled - one license per purchase)
4. Click **Create link**
5. **Copy the Payment Link URL**
   - Looks like: `https://buy.stripe.com/test_abc123xyz`

### Step 4: Get Stripe Secret Key

1. Dashboard → **Developers** → **API keys**
2. Copy **Secret key** (starts with `sk_test_...` in test mode)
3. **Keep it secret!**

### Step 5: Add Stripe Secret to Worker

```bash
cd cloudflare-worker
wrangler secret put STRIPE_SECRET_KEY
```

When prompted, paste your Stripe secret key.

---

## Part 3: Set Up Webhook (5 minutes)

This tells Stripe to notify your Worker when payments succeed.

### Step 1: Create Webhook

1. Stripe Dashboard → **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Enter:
   - **Endpoint URL:** `https://your-worker.workers.dev/webhook`
   - (Use the URL from Part 1, Step 5)
4. Click **Select events**
5. Choose these events:
   - ✅ `checkout.session.completed`
   - ✅ `charge.refunded`
6. Click **Add events** → **Add endpoint**

### Step 2: Get Webhook Secret

1. Click on your newly created webhook
2. Scroll to **Signing secret** → Click **Reveal**
3. Copy the secret (starts with `whsec_...`)

### Step 3: Add Webhook Secret to Worker

```bash
wrangler secret put STRIPE_WEBHOOK_SECRET
```

Paste the webhook secret when prompted.

---

## Part 4: Set Up Email (Resend) (5 minutes)

This sends license keys to customers after payment.

### Step 1: Create Resend Account

1. Go to [resend.com](https://resend.com)
2. Sign up (free tier: 100 emails/day)

### Step 2: Get API Key

1. Dashboard → **API Keys** → **Create API Key**
2. Name: "Website Modifier License Server"
3. Permission: **Full access**
4. Click **Add**
5. **Copy the API key** (starts with `re_...`)

### Step 3: Add Resend API Key to Worker

```bash
wrangler secret put RESEND_API_KEY
```

Paste the Resend API key when prompted.

### Step 4: Update Email "From" Address

Edit `cloudflare-worker/worker.js` line 284:

**For testing (no domain setup needed):**
```javascript
from: 'Website Modifier <onboarding@resend.dev>',
```

**For production (after verifying your domain in Resend):**
```javascript
from: 'Website Modifier <noreply@yourdomain.com>',
```

### Step 5: Redeploy Worker

```bash
wrangler publish
```

---

## Part 5: Update Extension (2 minutes)

### Step 1: Update Worker URL

Edit `extension/config/config.js` line 175:

**Replace:**
```javascript
const WORKER_URL = 'https://website-modifier-license-server.YOUR-SUBDOMAIN.workers.dev';
```

**With your actual Worker URL:**
```javascript
const WORKER_URL = 'https://website-modifier-license.your-name.workers.dev';
```

### Step 2: Update Payment Link

Edit `extension/config/config.html` line 73:

**Replace:**
```html
<a href="https://buy.stripe.com/YOUR_PAYMENT_LINK_ID" target="_blank">
```

**With your Stripe Payment Link:**
```html
<a href="https://buy.stripe.com/test_abc123xyz" target="_blank">
```

### Step 3: Reload Extension

1. Go to `chrome://extensions/`
2. Find "Website Modifier"
3. Click **Reload** icon

---

## Part 6: Test Complete Flow (5 minutes)

### Step 1: Test Payment

1. Open extension → Click ⚙️ Settings
2. Scroll to **License Key** section
3. Click **"Buy License"** link
4. You'll be redirected to Stripe checkout (TEST MODE)

**Use Stripe test card:**
- **Card number:** `4242 4242 4242 4242`
- **Expiry:** Any future date (e.g., `12/34`)
- **CVC:** Any 3 digits (e.g., `123`)
- **ZIP:** Any 5 digits (e.g., `12345`)

5. Enter your **real email** (you'll receive the license key here)
6. Click **Pay**

### Step 2: Check Email

Within 30-60 seconds, you should receive an email:
- **Subject:** "Your Website Modifier Extension License Key"
- **License key:** `WEBMOD-XXXX-YYYY-ZZZZ`

### Step 3: Activate License

1. Copy the license key from email
2. Go back to extension settings
3. Paste license key in **License Key** field
4. Click **Save License Key**
5. Should see: ✅ **"License activated successfully!"**

### Step 4: Verify Watermark Removal

1. Visit any webpage (e.g., CNN.com)
2. Click extension icon → enter transformation
3. Click "Transform Page"
4. Page transforms
5. **✅ NO WATERMARK should appear!** (because you have a valid license)

---

## Part 7: Go Live (When Ready)

Once testing is complete, switch to live mode:

### Step 1: Switch Stripe to Live Mode

1. Stripe Dashboard → Toggle to **Live mode** (top-right)
2. Create product again in Live mode (same settings as test)
3. Create Payment Link in Live mode
4. Copy new Live Payment Link URL

### Step 2: Update Extension with Live Payment Link

Edit `extension/config/config.html` line 73:
```html
<a href="https://buy.stripe.com/live_abc123xyz" target="_blank">
```

### Step 3: Update Worker with Live Keys

```bash
# Get live secret key from Stripe Dashboard → API keys (Live mode)
wrangler secret put STRIPE_SECRET_KEY
# Paste live key (starts with sk_live_...)

# Create new webhook in Live mode (same steps as before)
# Get webhook secret
wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste live webhook secret
```

### Step 4: Verify Domain in Resend (Production)

For production, use your own domain instead of `onboarding@resend.dev`:

1. Resend Dashboard → **Domains** → **Add Domain**
2. Enter your domain (e.g., `yourdomain.com`)
3. Add DNS records as instructed
4. Wait for verification
5. Update `worker.js` line 284:
   ```javascript
   from: 'Website Modifier <noreply@yourdomain.com>',
   ```
6. Redeploy: `wrangler publish`

### Step 5: Test with Real Card

Make a real payment (you'll be charged!) to verify everything works in live mode.

---

## Troubleshooting

### License Email Not Received

**Check Worker logs:**
```bash
wrangler tail
```

Look for errors like:
- `Failed to send email` → Resend API key issue
- `Invalid Stripe signature` → Webhook secret mismatch

**Check Stripe webhook logs:**
1. Dashboard → Developers → Webhooks
2. Click your webhook → View logs
3. Look for failed deliveries

**Check Resend logs:**
1. Resend Dashboard → Logs
2. Check if email was sent

### License Validation Fails

**Test Worker directly:**
```bash
curl "https://your-worker.workers.dev/validate?key=WEBMOD-TEST-1234-5678"
```

**Check KV storage:**
```bash
wrangler kv:key list --binding=LICENSES
```

### Common Errors

| Error | Solution |
|-------|----------|
| `API key configured` | Run `wrangler secret put STRIPE_SECRET_KEY` |
| `Invalid signature` | Regenerate webhook secret in Stripe Dashboard |
| `CORS error` | Check Worker URL in extension config.js is correct |
| `License key not found` | Payment didn't complete or webhook failed |

---

## Quick Commands Reference

```bash
# Deploy Worker
cd cloudflare-worker
wrangler publish

# View logs (live tail)
wrangler tail

# List all license keys
wrangler kv:key list --binding=LICENSES

# Get specific license
wrangler kv:key get "WEBMOD-XXXX-YYYY-ZZZZ" --binding=LICENSES

# Create test license manually
wrangler kv:key put "WEBMOD-TEST-1234-5678" '{"email":"test@example.com","plan":"lifetime","status":"active","issuedAt":"2025-01-15T00:00:00Z"}' --binding=LICENSES

# Test validation
curl "https://your-worker.workers.dev/validate?key=WEBMOD-TEST-1234-5678"

# Add/update secrets
wrangler secret put STRIPE_SECRET_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
wrangler secret put RESEND_API_KEY
```

---

## Cost Summary

### Free Tier (Forever):
- **Cloudflare Worker:** 100,000 requests/day
- **Cloudflare KV:** 1GB storage, 100K reads/day
- **Resend:** 100 emails/day (3,000/month)

### Paid:
- **Stripe:** 2.9% + $0.30 per transaction
  - On $49 sale = $1.73 fee
  - You keep: $47.27

**Total infrastructure cost: $0/month** 🎉

---

## What You Just Built

✅ Fully automated payment system
✅ Automatic license generation after payment
✅ Email delivery to customers
✅ License validation via API
✅ Watermark removal for paying users
✅ Refund handling (auto-revokes licenses)
✅ Scales to thousands of users
✅ **$0/month infrastructure cost**

---

## Next Steps

1. ✅ Complete setup (follow steps above)
2. ✅ Test with Stripe test card
3. ✅ Verify email delivery works
4. ✅ Verify license activation works
5. ⏳ Switch to Live mode when ready
6. 🚀 Publish extension to Chrome Web Store

**You're ready to start selling licenses!** 💰
