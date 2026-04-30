# Stripe Integration - Quick Start (5 Minutes to Test)

Want to test the payment system quickly? Follow these steps:

---

## Step 1: Deploy Cloudflare Worker (2 minutes)

```bash
# Install Wrangler
npm install -g wrangler

# Navigate to worker directory
cd cloudflare-worker

# Login to Cloudflare (opens browser)
wrangler login

# Create KV namespace
wrangler kv:namespace create LICENSES
# Output: { binding = "LICENSES", id = "abc123xyz456" }
# Copy the "id" value

# Edit wrangler.toml - replace YOUR_KV_NAMESPACE_ID with the id from above

# Deploy
wrangler publish
# Output: https://website-modifier-license-server.YOUR-SUBDOMAIN.workers.dev
# Copy this URL
```

---

## Step 2: Create Test License Manually (1 minute)

```bash
# Create a test license key
wrangler kv:key put "WEBMOD-TEST-1234-5678" '{"email":"test@example.com","plan":"lifetime","status":"active","issuedAt":"2025-01-15T00:00:00Z"}' --binding=LICENSES

# Verify it works
curl "https://your-worker.workers.dev/validate?key=WEBMOD-TEST-1234-5678"
# Should return: {"valid":true,"plan":"lifetime",...}
```

---

## Step 3: Update Extension (1 minute)

**Edit `extension/config/config.js` line 175:**

Replace:
```javascript
const WORKER_URL = 'https://website-modifier-license-server.YOUR-SUBDOMAIN.workers.dev';
```

With your actual Worker URL:
```javascript
const WORKER_URL = 'https://website-modifier-license-server.abc123.workers.dev';
```

**Reload extension:**
1. Go to `chrome://extensions/`
2. Find "Website Modifier" extension
3. Click **Reload** icon

---

## Step 4: Test License Activation (1 minute)

1. Click extension icon → ⚙️ Settings
2. Scroll to "🔑 License Key" section
3. Enter: `WEBMOD-TEST-1234-5678`
4. Click **"Save License Key"**
5. Should see: **✅ License activated successfully!**

---

## Step 5: Test Watermark Removal (30 seconds)

1. Visit any webpage (e.g., CNN.com)
2. Click extension → enter topic → click "Transform Page"
3. Page transforms
4. **No watermark should appear!** ✅

---

## What Just Happened?

✅ You deployed a Cloudflare Worker (license server)
✅ You created a test license manually
✅ You configured the extension to use your Worker
✅ You activated a license in the extension
✅ You verified watermark removal works

---

## Next Steps

### To Enable Real Payments (1 hour):

Follow the full guide: [STRIPE_SETUP_GUIDE.md](STRIPE_SETUP_GUIDE.md)

1. Create Stripe account (15 min)
2. Create product & Payment Link (10 min)
3. Set up webhook (5 min)
4. Set up Resend for emails (5 min)
5. Add secrets to Worker (5 min)
6. Test complete flow (20 min)

**Or use this shortcut:**

### Stripe Test Mode (10 minutes):

```bash
# Get Stripe test keys
# 1. Go to stripe.com → Sign up
# 2. Dashboard → Developers → API keys
# 3. Copy "Secret key" (starts with sk_test_)

# Add to Worker
wrangler secret put STRIPE_SECRET_KEY
# Paste your Stripe secret key

# Create Payment Link
# 1. Dashboard → Products → Create product
#    - Name: "Website Modifier License"
#    - Price: $49 one-time
# 2. Payment links → Create link
#    - Copy the URL

# Update extension/config/config.html line 73
# Replace: https://buy.stripe.com/YOUR_PAYMENT_LINK_ID
# With: https://buy.stripe.com/test_abc123xyz

# Set up webhook
# 1. Dashboard → Webhooks → Add endpoint
# 2. URL: https://your-worker.workers.dev/webhook
# 3. Events: checkout.session.completed, charge.refunded
# 4. Copy webhook signing secret

# Add to Worker
wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste webhook secret

# Set up Resend (for email)
# 1. Go to resend.com → Sign up
# 2. API Keys → Create
# 3. Copy API key

# Add to Worker
wrangler secret put RESEND_API_KEY
# Paste Resend API key

# Update worker.js line 239
# Change: from: 'Website Modifier Extension <noreply@yourdomain.com>'
# To: from: 'Website Modifier Extension <onboarding@resend.dev>'

# Redeploy
wrangler publish

# Test payment!
# 1. Click "Buy License" in extension
# 2. Use test card: 4242 4242 4242 4242
# 3. Check email for license key
# 4. Enter key in extension → activate!
```

---

## Troubleshooting

### "License validation failed"
- Check Worker URL in `config/config.js` is correct
- Test Worker: `curl "https://your-worker.dev/validate?key=TEST"`

### "License email not received"
- Check Resend API key: `wrangler secret list`
- Check Worker logs: `wrangler tail`
- Check Stripe webhook logs (Dashboard → Webhooks)

### "Invalid license key" (but you just created it)
- List licenses: `wrangler kv:key list --binding=LICENSES`
- Get license: `wrangler kv:key get "WEBMOD-TEST-1234-5678"`
- Verify status is "active"

---

## Quick Commands Reference

```bash
# Deploy Worker
wrangler publish

# View logs
wrangler tail

# List licenses
wrangler kv:key list --binding=LICENSES

# Get license details
wrangler kv:key get "WEBMOD-XXXX-YYYY-ZZZZ" --binding=LICENSES

# Create test license
wrangler kv:key put "WEBMOD-TEST-XXXX-YYYY" '{"email":"test@example.com","plan":"lifetime","status":"active","issuedAt":"2025-01-15T00:00:00Z"}' --binding=LICENSES

# Delete license
wrangler kv:key delete "WEBMOD-XXXX-YYYY-ZZZZ" --binding=LICENSES

# Test validation
curl "https://your-worker.workers.dev/validate?key=WEBMOD-TEST-1234-5678"

# Add secret
wrangler secret put SECRET_NAME

# List secrets
wrangler secret list
```

---

## Files You Modified

```
extension/
  config/config.js       ← Line 175: Worker URL
  config/config.html     ← Line 73: Payment Link (optional for testing)

cloudflare-worker/
  wrangler.toml          ← Line 15: KV namespace ID
  worker.js              ← Line 239: Email from address (optional)
```

---

## Ready to Go Live?

When you're ready to accept real payments:

1. Switch Stripe to Live mode
2. Create new product + Payment Link (Live mode)
3. Update `config/config.html` with Live Payment Link
4. Update Worker secrets with Live Stripe keys
5. Verify Resend domain (required for production)
6. Test with real card
7. Deploy extension to Chrome Web Store

**Full guide:** [STRIPE_SETUP_GUIDE.md](STRIPE_SETUP_GUIDE.md)

---

## Cost Summary

**Free tier (forever):**
- Cloudflare Worker: 3M requests/month
- Cloudflare KV: 1GB storage
- Resend: 3,000 emails/month

**You pay:**
- Stripe: 2.9% + $0.30 per sale (on $49 = $1.73 fee)
- Your profit: ~$47.27 per license

**Infrastructure cost: $0/month** 🎉

---

That's it! You're ready to start selling licenses for your Chrome extension.

For detailed documentation, see:
- [STRIPE_SETUP_GUIDE.md](STRIPE_SETUP_GUIDE.md) - Complete setup walkthrough
- [CHANGELOG.md](CHANGELOG.md) - What was built and changed
- [ARCHITECTURE.md](ARCHITECTURE.md) - How it works (visual diagrams)
- [TROUBLESHOOTING.md](TROUBLESHOOTING.md) - Common issues and solutions
