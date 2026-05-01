# Changelog

All notable changes to the Website Modifier extension.

## [1.1.0] - 2024-02-11

### 🐛 Bug Fixes

**Fixed: "generateImages is not a function" error**
- **Issue**: Variable naming conflict where `generateImages` parameter shadowed the `generateImages()` function
- **Fix**: Renamed parameter to `shouldGenerateImages` using destructuring
- **Location**: `background/background.js:19`
- **Impact**: Extension now works correctly when image generation is enabled

**Fixed: "Unexpected token / not valid JSON" error**
- **Issue**: GPT sometimes returns JSON wrapped in markdown code blocks or with comments
- **Fixes applied**:
  - Added automatic extraction of JSON from markdown code blocks (` ```json ` and ` ``` `)
  - Added `response_format: { type: "json_object" }` to OpenAI API calls to force JSON output
  - Improved error logging to show first 500 characters of raw response
  - Made system prompts more explicit about returning only JSON
- **Location**: `background/background.js:193-221`
- **Impact**: Much more robust JSON parsing with better error messages

### ✨ New Features

**Comprehensive Logging System**
- Added detailed logging throughout the entire extension
- Emoji-based prefixes for easy scanning (🚀 ✅ ❌ 📊 etc.)
- Step-by-step progress tracking (Step 1/4 through Step 4/4)
- Timing information for all operations
- Detailed error messages with stack traces

**Logging Coverage**:
- **Background Script** (`background/background.js`):
  - Transformation flow tracking
  - API request/response logging
  - Model selection logging
  - API key status (masked for security)
  - Image generation progress with timing
  - Detailed error reporting

- **Content Script** (`content/content.js`):
  - Page analysis results (element counts)
  - DOM manipulation progress
  - Replacement statistics (items updated)
  - Error context and stack traces

- **Popup Script** (`popup/popup.js`):
  - User action tracking (button clicks)
  - Message sending/receiving
  - Configuration logging
  - Response status tracking

**Example Log Output**:
```
🚀 [Transform] Starting transformation...
📝 [Transform] Topic: Scientists prove existence of God
🔑 [Transform] API key configured: sk-proj...xxxx
🤖 [Transform] Text model: gpt-4
🎨 [Transform] Image model: gpt-image-1:high

📊 [Step 1/4] Analyzing page content...
   📊 [Analysis] Found headings: 1 H1, 5 H2, 8 H3
✅ [Step 1/4] Page analysis complete

📝 [Step 2/4] Generating content with gpt-4...
✅ [Step 2/4] Content generated in 3542ms

🎨 [Step 3/4] Generating 3 images with gpt-image-1:high...
✅ [Step 3/4] Generated 3/3 images in 8234ms

🔄 [Step 4/4] Replacing page content...
✅ [Step 4/4] Content replacement complete!
🎉 [Transform] Transformation successful!
```

### 📚 Documentation

**New Files**:
- `DEBUGGING_GUIDE.md` - Complete debugging reference with:
  - How to view logs from all components
  - Common error messages and solutions
  - Step-by-step troubleshooting
  - Advanced debugging techniques

**Updated Files**:
- `README.md` - Added comprehensive "Debugging" section with:
  - How to access different console logs
  - Log format explanation with examples
  - Common error message reference table
  - Quick troubleshooting steps

### 🔧 Improvements

**Better Error Handling**:
- All errors now include detailed context
- Stack traces logged for all exceptions
- Raw API responses shown on parse failures
- Clear error messages pointing to solutions

**More Robust API Integration**:
- Automatic handling of markdown-wrapped JSON responses
- Forced JSON mode for compatible models
- Better prompt engineering for consistent outputs
- Graceful degradation on parse failures

**Developer Experience**:
- Easy-to-scan emoji-based logs
- Progress indicators for long operations
- Timing data for performance analysis
- Clear step-by-step execution flow

## [1.0.0] - 2024-02-11

### Initial Release

- Transform any webpage content with AI
- OpenAI GPT integration (GPT-4, GPT-4 Turbo, GPT-3.5 Turbo)
- GPT Image 1 image generation (High Quality, Low)
- BYOAI (Bring Your Own API key)
- Configurable models and settings
- Reset functionality
- Chrome extension with popup UI
- Settings page for API key management
- Comprehensive documentation

---

## How to Update

To get the latest version with all fixes:

1. Go to `chrome://extensions/`
2. Find "Website Modifier"
3. Click the **reload** icon (circular arrow)
4. The new version is now active!

You don't need to reconfigure your API key - settings are preserved.

## Reporting Issues

If you encounter a bug:

1. Check the console logs (see [DEBUGGING_GUIDE.md](DEBUGGING_GUIDE.md))
2. Look for error messages with ❌ emoji
3. Copy the relevant log output
4. Report with:
   - Error message
   - Website URL you were testing
   - Topic you entered
   - Chrome version
   - Extension version
   - Steps to reproduce
