# Website Modifier - Chrome Extension

A Chrome extension that transforms any webpage's content using AI. Enter a topic, and watch as the extension replaces all text and images on the current page with AI-generated content related to your topic.

## Features

- 🎨 Transform any webpage with AI-generated content
- 📝 Uses OpenAI GPT models for text generation (GPT-4, GPT-4 Turbo, GPT-3.5)
- 🖼️ Generates AI images using DALL-E 3 or DALL-E 2
- ⚙️ BYOAI (Bring Your Own AI) - use your own OpenAI API key
- 🔄 Reset page to original content anytime
- 💾 Saves your API key and preferences locally

## Installation

### Step 1: Get Your OpenAI API Key

1. Go to [OpenAI Platform](https://platform.openai.com/api-keys)
2. Sign in or create an account
3. Click "Create new secret key"
4. Copy your API key (starts with `sk-`)
5. Keep it safe - you'll need it in Step 3

### Step 2: Load the Extension in Chrome

1. Open Google Chrome
2. Navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Navigate to this project folder and select the `extension` folder
6. The extension should now appear in your extensions list

### Step 3: Configure Your API Key

1. Click the extension icon in your Chrome toolbar (you may need to pin it first)
2. Click **⚙️ Configure API Key** at the bottom of the popup
3. Enter your OpenAI API key
4. Choose your preferred models:
   - **Text Generation**: GPT-4, GPT-4 Turbo, or GPT-3.5 Turbo
   - **Image Generation**: DALL-E 3 or DALL-E 2
5. Click **Save Settings**

## How to Use

1. **Navigate to any webpage** (e.g., CNN.com, NYTimes.com, ESPN.com, or any website)

2. **Click the extension icon** in your Chrome toolbar

3. **Enter a topic** in the text field (e.g., "Scientists prove the existence of God")

4. **Choose options**:
   - Enable/disable AI image generation
   - Select how many images to generate (1-5)

5. **Click "Transform Page"**

6. **Wait** while the AI generates content (may take 10-30 seconds depending on image count)

7. **Watch the magic happen!** The page content will be replaced with AI-generated content

8. **To restore** the original page:
   - Click the extension icon again
   - Click **Reset Page**
   - Or simply refresh the page

## How It Works

1. **Content Analysis**: The extension analyzes the current webpage to identify:
   - Headlines (H1, H2, H3)
   - Paragraphs
   - Images
   - Author names
   - Dates

2. **AI Generation**: It sends the topic to OpenAI's API to generate:
   - New headlines and subheadlines
   - Article paragraphs matching the topic
   - Image descriptions for DALL-E

3. **Image Generation**: If enabled, it generates AI images using DALL-E

4. **DOM Replacement**: The extension replaces the original content in the DOM:
   - Replaces all text elements with generated content
   - Swaps images with AI-generated ones
   - Updates meta tags and page title

5. **Temporary Changes**: All changes are made in-browser only. Refresh to restore the original page.

## Project Structure

```
website-modifier/
├── extension/
│   ├── manifest.json          # Extension configuration
│   ├── popup/
│   │   ├── popup.html         # Extension popup UI
│   │   ├── popup.css          # Popup styles
│   │   └── popup.js           # Popup logic
│   ├── content/
│   │   └── content.js         # Content script (DOM manipulation)
│   ├── background/
│   │   └── background.js      # Background service worker (API calls)
│   ├── config/
│   │   ├── config.html        # Settings page
│   │   ├── config.css         # Settings styles
│   │   └── config.js          # Settings logic
│   └── icons/
│       ├── icon16.png         # 16x16 icon
│       ├── icon48.png         # 48x48 icon
│       └── icon128.png        # 128x128 icon
└── README.md
```

## API Costs

**Important**: This extension makes API calls to OpenAI which will incur costs on your account:

- **GPT-4**: ~$0.03 per request (most expensive, best quality)
- **GPT-4 Turbo**: ~$0.01 per request (good balance)
- **GPT-3.5 Turbo**: ~$0.001 per request (cheapest, faster)
- **DALL-E 3**: ~$0.04 per image (1024x1024)
- **DALL-E 2**: ~$0.02 per image (1024x1024)

**Example cost for one transformation:**
- 1 topic with GPT-4 + 3 DALL-E 3 images ≈ $0.15

Monitor your usage at [OpenAI Usage Dashboard](https://platform.openai.com/usage)

## Privacy & Security

- Your API key is stored **locally in your browser** using Chrome's storage API
- The key is **never sent anywhere** except directly to OpenAI's API
- No data is collected or sent to third parties
- All transformations happen locally in your browser

## Debugging

The extension now includes **comprehensive logging** to help you understand what's happening at each step and troubleshoot issues.

### How to View Logs

**1. Background Script Logs** (API calls, main logic):
- Go to `chrome://extensions/`
- Find "Website Modifier"
- Click **"service worker"** link
- View the Console tab

**2. Content Script Logs** (Page manipulation):
- Open DevTools on any webpage (F12)
- Go to Console tab
- Transform the page
- Watch the logs appear

**3. Popup Logs** (Button clicks, user actions):
- Right-click the extension icon
- Select **"Inspect popup"**
- View the Console tab

### Log Format

Logs use emojis and prefixes for easy scanning:

```
🚀 [Transform] Starting transformation...
📝 [Transform] Topic: Scientists prove existence of God
🔑 [Transform] API key configured: sk-proj...xxxx
🤖 [Transform] Text model: gpt-4
🎨 [Transform] Image model: dall-e-3

📊 [Step 1/4] Analyzing page content...
   🔎 [Analysis] Scanning DOM for elements...
   📊 [Analysis] Found headings: 1 H1, 5 H2, 8 H3
   📄 [Analysis] Found 15/120 valid paragraphs
   🖼️ [Analysis] Found 3/45 valid images (>100x100px)
✅ [Step 1/4] Page analysis complete

📝 [Step 2/4] Generating content with gpt-4...
   📤 [API] Sending request to OpenAI...
   📥 [API] Response received
✅ [Step 2/4] Content generated in 3542ms

🎨 [Step 3/4] Generating 3 images with dall-e-3...
   🎨 [Image 1/3] Generating: Scientists in lab discovering...
   ✅ [Image 1/3] Generated successfully
   ⏳ [Image] Waiting 1s before next image...
✅ [Step 3/4] Generated 3/3 images in 8234ms

🔄 [Step 4/4] Replacing page content...
   ✅ [Replace] Updated H1: "Scientists Prove the Existence..."
   ✅ [Replace] Updated 15 paragraphs
   ✅ [Replace] Replaced 3/3 images
✅ [Step 4/4] Content replacement complete!
🎉 [Transform] Transformation successful!
```

### Common Error Messages

If you see errors in the console, here's what they mean:

| Error | Cause | Solution |
|-------|-------|----------|
| `❌ [Transform] No API key configured` | No API key set | Configure API key in settings |
| `❌ [API] Request failed: 401` | Invalid API key | Check API key is correct |
| `❌ [API] Request failed: 429` | Rate limit exceeded | Wait 20-60 seconds, try again |
| `❌ [API] Request failed: 402` | No credits | Add credits to OpenAI account |
| `❌ [Step 1/4] Failed to analyze page` | Can't access page content | Check if on chrome:// page |
| `❌ [Image 1/3] Failed: 400` | DALL-E rejected prompt | Try different topic or DALL-E 2 |
| `❌ [Replace] Error replacing content` | Page structure issue | Try a different website |

## Troubleshooting

### Extension not working?

1. **Check console logs** (see Debugging section above)
2. Look for error messages with ❌ emoji
3. Check that your API key is configured correctly
4. Verify you have API credits available in your OpenAI account
5. Make sure you're on a webpage (not chrome:// pages)

### Rate limit errors?

OpenAI has rate limits. If you hit them:
- Wait a few seconds between transformations
- Reduce the number of images generated
- Upgrade your OpenAI account tier

### Images not generating?

- DALL-E 3 has stricter content policies than DALL-E 2
- Try using DALL-E 2 instead
- Some prompts may be rejected by OpenAI's safety systems

### Page doesn't transform correctly?

- Some websites have complex structures that are harder to transform
- Try disabling image generation for faster results
- Refresh and try again

## Development

### Making Changes

After modifying the extension code:

1. Go to `chrome://extensions/`
2. Click the **reload icon** on the extension card
3. Test your changes

### Debugging

- **Popup**: Right-click the extension icon → Inspect popup
- **Background**: Go to `chrome://extensions/` → Click "service worker"
- **Content Script**: Open DevTools on any webpage → Console tab

## License

MIT License - Feel free to modify and use as needed

## Disclaimer

This extension is for educational purposes. Use responsibly and ethically. Be aware of:
- OpenAI's usage policies
- Website terms of service
- Content authenticity and misinformation concerns

---

Built with ❤️ using OpenAI's GPT-4 and DALL-E APIs
