# Debugging Guide

This guide will help you debug issues with the Website Modifier extension.

## 🔍 Quick Debug Checklist

If the extension isn't working, follow these steps:

1. ✅ **Check the background script console**
   - Go to `chrome://extensions/`
   - Find "Website Modifier"
   - Click "service worker"
   - Look for error messages

2. ✅ **Check the page console**
   - Press F12 on the webpage
   - Go to Console tab
   - Look for messages prefixed with [Content] or [Replace]

3. ✅ **Check the popup console**
   - Right-click extension icon
   - Click "Inspect popup"
   - Look for [Popup] messages

4. ✅ **Verify API key**
   - Click extension icon
   - Click "⚙️ Configure API Key"
   - Make sure it's set correctly (starts with `sk-`)

5. ✅ **Check OpenAI account**
   - Visit https://platform.openai.com/usage
   - Verify you have available credits
   - Check if you've hit rate limits

## 📊 Understanding the Logs

The extension logs every step with emojis for easy scanning:

### Success Flow

```
🚀 [Transform] Starting transformation...
📝 [Transform] Topic: Your topic here
🔑 [Transform] API key configured: sk-xxx...xxx
🤖 [Transform] Text model: gpt-4
🎨 [Transform] Image model: gpt-image-1:high

📊 [Step 1/4] Analyzing page content...
   🔎 [Analysis] Scanning DOM for elements...
   📊 [Analysis] Found headings: 1 H1, 5 H2, 8 H3
   📄 [Analysis] Found 15/120 valid paragraphs
   🖼️ [Analysis] Found 3/45 valid images (>100x100px)
✅ [Step 1/4] Page analysis complete

📝 [Step 2/4] Generating content with gpt-4...
   📤 [API] Sending request to OpenAI...
   📥 [API] Response received
   🔄 [API] Parsing content...
   ✅ [API] Content parsed successfully
✅ [Step 2/4] Content generated in 3542ms

🎨 [Step 3/4] Generating 3 images with gpt-image-1:high...
   🎨 [Image 1/3] Generating: [description]...
   ✅ [Image 1/3] Generated successfully
   ⏳ [Image] Waiting 1s before next image...
   [repeat for each image]
✅ [Step 3/4] Generated 3/3 images in 8234ms

🔄 [Step 4/4] Replacing page content...
   🔄 [Replace] Updating page title...
   🏷️ [Replace] Updating meta tags...
   📝 [Replace] Replacing headings...
   ✅ [Replace] Updated H1: "Your headline..."
   ✅ [Replace] Updated 5 H2 headings
   ✅ [Replace] Updated 8 H3 headings
   📄 [Replace] Replacing paragraphs...
   ✅ [Replace] Updated 15 paragraphs
   🖼️ [Replace] Replacing images...
   ✅ [Replace] Updated image 1/3
   ✅ [Replace] Updated image 2/3
   ✅ [Replace] Updated image 3/3
   ✅ [Replace] Replaced 3/3 images
   ✍️ [Replace] Updating author and date...
   ✨ [Replace] Adding watermark...
✅ [Step 4/4] Content replacement complete!
🎉 [Transform] Transformation successful!
```

### Error Flow

If something goes wrong, you'll see ❌ messages:

```
🚀 [Transform] Starting transformation...
❌ [Transform] No API key configured
```

or

```
📝 [Step 2/4] Generating content with gpt-4...
   📤 [API] Sending request to OpenAI...
   ❌ [API] Request failed: 429 {"error":{"message":"Rate limit reached"}}
❌ [Step 2/4] Content generation failed: Rate limit reached
```

## 🐛 Common Issues & Solutions

### Issue: "generateImages is not a function"

**Status**: ✅ **FIXED** in latest version

**Cause**: Variable naming conflict in background.js

**Solution**: Update to the latest version of the extension. The bug has been fixed.

---

### Issue: "Unexpected token" or "not valid JSON"

**Status**: ✅ **FIXED** in latest version

**Symptoms**:
```
❌ [API] JSON parse error: Unexpected token '/' in JSON at position 123
❌ [API] JSON parse error: Unexpected token '}', ..."...", // ... mor"... is not valid JSON
```

**Cause**: GPT sometimes returns JSON wrapped in markdown code blocks or with comments/extra text

**The Fix** (already applied in latest version):
- ✅ Added automatic extraction of JSON from markdown code blocks
- ✅ Added `response_format: { type: "json_object" }` for compatible models
  - Works with: GPT-4 Turbo, GPT-4o, GPT-3.5-turbo-1106+
  - Automatically disabled for older models (GPT-4 base)
  - Logs which mode is being used
- ✅ Improved error handling with raw content logging (shows first 500 chars)
- ✅ More explicit system prompts to prevent extra text

**What to do**:
1. Reload the extension to get the latest fixes
2. If you still see this error, check the background console
3. Look for `📄 [API] Raw content:` to see what GPT returned
4. The extension now handles most JSON formatting issues automatically

**If still failing**:
- Try using GPT-3.5 Turbo instead of GPT-4 (better JSON compliance)
- The error log will show the exact parsing issue
- Report the issue with the raw content shown in logs

---

### Issue: "Invalid parameter: 'response_format' not supported"

**Status**: ✅ **FIXED** in latest version

**Symptoms**:
```
❌ [API] Request failed: 400 {"error":{"message":"Invalid parameter: 'response_format' of type 'json_object' is not supported with this model."}}
```

**Cause**: You're using GPT-4 base model, which doesn't support the `response_format` parameter

**The Fix** (already applied in latest version):
- ✅ Extension now detects which model you're using
- ✅ Only enables JSON mode for compatible models
- ✅ Falls back to prompt-based JSON for older models
- ✅ Logs which mode is being used

**What you'll see in logs**:
```
🔧 [API] Using JSON mode (response_format)        ← Compatible model
⚠️ [API] Model does not support JSON mode, relying on prompts  ← Older model
```

**Compatible models** (JSON mode enabled):
- ✅ `gpt-4-turbo`
- ✅ `gpt-4-turbo-preview`
- ✅ `gpt-4o`
- ✅ `gpt-3.5-turbo` (latest version)
- ✅ `gpt-3.5-turbo-1106` or newer

**Incompatible models** (prompts only):
- ⚠️ `gpt-4` (base model)
- ⚠️ `gpt-4-0613` or older

**Solution**:
1. Reload the extension (fix is already applied)
2. The extension will automatically work with any model
3. For best JSON compliance, use GPT-4 Turbo or GPT-3.5 Turbo

---

### Issue: "Unterminated string in JSON" or "Failed to parse JSON response"

**Status**: ✅ **FIXED** in latest version

**Symptoms**:
```
❌ [API] JSON parse error: Unterminated string in JSON at position 10909
Failed to parse JSON response: Unterminated string in JSON... Check console for raw content.
```

**Cause**: Response was truncated because it hit the `max_tokens` limit (2000 tokens)

**The Fix** (already applied in latest version):
- ✅ Detects when response is truncated (finish_reason: "length")
- ✅ Automatically retries with increased max_tokens (3000)
- ✅ Limits content requirements to reasonable amounts:
  - Max 1 H1, 5 H2s, 8 H3s
  - Max 12 paragraphs (reduced from unlimited)
  - Max 5 images
- ✅ Shows both first and last 500 chars of failed responses
- ✅ Clear error messages about truncation

**What you'll see in logs**:
```
⚠️ [API] Response truncated due to max_tokens limit!
💡 [API] Retrying with increased max_tokens...
✅ [API] Retry successful with increased tokens
```

Or if page has too many elements:
```
⚠️ [API] Page has 45 paragraphs, limiting to 12 to avoid token limits
```

**Solution**:
1. Reload the extension (fix is already applied)
2. The extension now automatically handles truncation
3. If still failing, the page may have an unusually large amount of content
4. Try a different, simpler webpage

---

### Issue: Extension icon appears but nothing happens when clicked

**Symptoms**:
- Extension icon shows in toolbar
- Clicking it does nothing
- No popup appears

**Debug**:
1. Check popup console: Right-click icon → "Inspect popup"
2. Look for JavaScript errors
3. Verify manifest.json is correct

**Solution**:
- Reload extension in `chrome://extensions/`
- Check that popup/popup.html exists
- Verify file permissions

---

### Issue: "API key not configured" but I set it

**Symptoms**:
- You entered API key in settings
- Still getting "API key not configured" error

**Debug**:
1. Check background console
2. Look for: `🔑 [Transform] API key configured: sk-xxx...xxx`
3. If not there, storage isn't working

**Solutions**:
- Reload the extension
- Try setting API key again
- Check Chrome's storage quota
- Clear extension data and reconfigure

---

### Issue: Page analysis finds 0 elements

**Symptoms**:
```
📊 [Analysis] Found headings: 0 H1, 0 H2, 0 H3
📄 [Analysis] Found 0/0 valid paragraphs
🖼️ [Analysis] Found 0/0 valid images
```

**Causes**:
1. Page hasn't fully loaded yet
2. Content is in Shadow DOM
3. Page uses iframes
4. You're on a chrome:// page

**Solutions**:
- Wait for page to fully load
- Try a different website
- Test on cnn.com or nytimes.com (known to work)
- Don't use on chrome:// pages

---

### Issue: API request fails with 401

**Symptoms**:
```
❌ [API] Request failed: 401 {"error":{"message":"Incorrect API key"}}
```

**Cause**: Invalid or expired API key

**Solutions**:
1. Go to https://platform.openai.com/api-keys
2. Generate a new API key
3. Copy it carefully (entire key including `sk-`)
4. Paste into extension settings
5. Save settings
6. Try again

---

### Issue: API request fails with 429

**Symptoms**:
```
❌ [API] Request failed: 429 {"error":{"message":"Rate limit reached"}}
```

**Cause**: Too many requests in short time

**Solutions**:
- Wait 20-60 seconds before retrying
- Space out your transformations
- Upgrade OpenAI account tier for higher limits
- Use GPT-3.5 instead of GPT-4 (cheaper, less restrictive)

---

### Issue: API request fails with 402

**Symptoms**:
```
❌ [API] Request failed: 402 {"error":{"message":"You exceeded your current quota"}}
```

**Cause**: No credits in OpenAI account

**Solutions**:
1. Go to https://platform.openai.com/account/billing
2. Add a payment method
3. Purchase credits
4. Wait a few minutes for credits to activate
5. Try again

---

### Issue: Images don't generate

**Symptoms**:
```
🎨 [Image 1/3] Generating: [description]...
❌ [Image 1/3] Failed: 400 content_policy_violation
```

**Cause**: Image prompt rejected due to content policy

**Solutions**:
- Try a different, less controversial topic
- Switch to GPT Image 1 — Low (may be less strict)
- Disable image generation and use text only
- Modify topic to be more generic

---

### Issue: Content generated but page doesn't change

**Symptoms**:
- All 4 steps complete successfully
- Logs show ✅ everywhere
- But page looks the same

**Debug**:
1. Check content script console (F12 on page)
2. Look for replacement logs
3. Check if watermark appeared (bottom right)

**Possible causes**:
- Page has JavaScript that reverts changes
- Content is in Shadow DOM
- Page reloads after transformation
- CSS hides the changed elements

**Solutions**:
- Try transformation again quickly
- Look for watermark (if present, transformation worked)
- Try a simpler website
- Disable JavaScript on page (advanced)

---

### Issue: Transformation is very slow

**Expected times**:
- No images: 3-5 seconds
- 1 image: 8-12 seconds
- 3 images: 20-30 seconds
- 5 images: 40-60 seconds

**If slower than this**:

**Debug**: Check console for which step is slow
```
✅ [Step 2/4] Content generated in 3542ms  ← This shows timing
```

**Solutions**:
- Use GPT-3.5 Turbo instead of GPT-4 (much faster)
- Reduce number of images
- Check your internet speed
- Check OpenAI API status: https://status.openai.com

---

## 🔬 Advanced Debugging

### Viewing All Console Logs Together

To see all logs from all components:

1. **Background console**: `chrome://extensions/` → service worker
2. **Page console**: F12 on webpage → Console
3. **Popup console**: Right-click icon → Inspect popup

Keep all three open to see the full flow.

### Enabling Verbose Logging

All logging is already enabled! Every operation is logged with:
- ✅ Success indicators
- ❌ Error indicators
- ⏳ Progress indicators
- 📊 Data/statistics
- ⏱️ Timing information

### Testing the Extension

**Quick test**:
1. Go to https://www.cnn.com
2. Open DevTools (F12)
3. Open background console (`chrome://extensions/` → service worker)
4. Click extension icon
5. Enter topic: "Aliens land on Earth"
6. Uncheck "Generate AI Images" (for faster test)
7. Click "Transform Page"
8. Watch the logs!

**Expected result**:
- Transformation completes in ~5 seconds
- All steps show ✅
- CNN homepage text changes to alien topic
- Watermark appears bottom-right

### Checking Extension Files

Verify all files are present:
```bash
cd /path/to/website-modifier
./verify-installation.sh
```

All should show ✅.

### Monitoring API Usage

Watch your API usage in real-time:
- https://platform.openai.com/usage
- Refresh after each transformation
- Check costs match expectations

### Common API Costs

- GPT-4: ~$0.03/request
- GPT-3.5 Turbo: ~$0.001/request
- GPT Image 1 High: ~$0.04/image
- GPT Image 1 Low: ~$0.02/image

**Example**: Topic with GPT-4 + 3 GPT Image 1 High images = ~$0.15

---

## 📞 Still Stuck?

If you've tried everything and it still doesn't work:

1. **Capture the logs**:
   - Open all three consoles (background, page, popup)
   - Attempt transformation
   - Copy all console output
   - Save to a file

2. **Check extension version**:
   - Go to `chrome://extensions/`
   - Note the version number
   - Make sure you have the latest files

3. **Test on known-working site**:
   - Try https://www.cnn.com
   - If this works but your site doesn't, it's a site-specific issue
   - If this fails too, it's a configuration issue

4. **Check the basics**:
   - Chrome is up to date
   - Extension is enabled
   - No conflicting extensions
   - Internet connection works
   - OpenAI API is operational

5. **Fresh start**:
   - Remove extension completely
   - Delete extension folder
   - Re-extract/download fresh copy
   - Reload extension
   - Reconfigure API key
   - Test again

---

## 📝 Reporting Bugs

If you find a bug, provide:

1. **Error logs** (from all three consoles)
2. **Website URL** you were trying to transform
3. **Topic** you entered
4. **Chrome version** (`chrome://version/`)
5. **Extension version**
6. **Steps to reproduce**
7. **Expected vs actual behavior**

---

**Happy debugging!** 🐛🔧

The comprehensive logging should make it easy to pinpoint exactly where things go wrong.
