# Testing Checklist

Use this to verify the extension works correctly.

## Installation Test

- [ ] Extension loads without errors in `chrome://extensions/`
- [ ] Extension icon appears in toolbar
- [ ] No errors in extension service worker console

## Configuration Test

- [ ] Can open settings page (⚙️ Configure API Key)
- [ ] Can enter and save API key
- [ ] Can toggle API key visibility (👁️ button)
- [ ] Can select text model (GPT-4, GPT-4 Turbo, GPT-3.5)
- [ ] Can select image model (DALL-E 3, DALL-E 2)
- [ ] Settings persist after closing and reopening

## Basic Functionality Test

- [ ] Popup opens when clicking extension icon
- [ ] Can enter a topic in the input field
- [ ] Can toggle "Generate AI Images" checkbox
- [ ] Can select image count (1-5)
- [ ] "Transform Page" button is clickable

## Content Transformation Test

### Test on CNN.com
1. Go to https://cnn.com
2. Click extension icon
3. Enter topic: "Aliens land on Earth"
4. Enable images, set count to 2
5. Click Transform Page

- [ ] Button shows "Transforming..." with loading spinner
- [ ] Transformation completes in 10-30 seconds
- [ ] Page title changes
- [ ] Main headline (H1) changes to new topic
- [ ] Sub-headlines (H2, H3) change
- [ ] Paragraph text changes
- [ ] At least 2 images are replaced
- [ ] Watermark appears (bottom right)
- [ ] Success message shows in popup

### Test on NYTimes.com
Repeat above with different topic: "Scientists cure aging"

- [ ] Works on NYTimes.com
- [ ] Content transforms correctly
- [ ] Images generate successfully

### Test with Images Disabled
1. Go to https://espn.com
2. Topic: "Robots win Olympics"
3. **Uncheck** "Generate AI Images"
4. Click Transform Page

- [ ] Transformation is much faster (< 5 seconds)
- [ ] Text content changes
- [ ] Images remain unchanged
- [ ] No image generation errors

## Reset Functionality Test

- [ ] "Reset Page" button works
- [ ] Original content is restored
- [ ] Page looks exactly as before transformation
- [ ] Can transform again after reset

## Error Handling Test

### Invalid API Key
1. Go to settings
2. Change API key to "invalid-key"
3. Try to transform a page

- [ ] Shows error message
- [ ] Error message is clear and helpful

### No API Key
1. Clear API key in settings
2. Try to transform a page

- [ ] Shows error: "OpenAI API key not configured"

### Network Error
1. Disconnect internet
2. Try to transform a page

- [ ] Shows appropriate error message
- [ ] Extension doesn't crash

## Model Selection Test

### GPT-3.5 Turbo (Fast & Cheap)
- [ ] Select GPT-3.5 Turbo in settings
- [ ] Transformation works
- [ ] Results are coherent

### GPT-4 (Best Quality)
- [ ] Select GPT-4 in settings
- [ ] Transformation works
- [ ] Results are high quality

### DALL-E 2 (Cheaper Images)
- [ ] Select DALL-E 2 in settings
- [ ] Images generate successfully
- [ ] Image quality is acceptable

## Edge Cases Test

### Very Long Topic
- [ ] Works with topic > 200 characters
- [ ] Content generation handles it gracefully

### Special Characters in Topic
- [ ] Works with quotes: `"Breaking News"`
- [ ] Works with emoji: `🚀 Space Travel`
- [ ] Works with unicode: `科学发现`

### Different Websites
Test on various sites:
- [ ] Reddit.com
- [ ] Wikipedia.org
- [ ] Medium.com
- [ ] BBC.com

### Chrome Special Pages (Should Fail Gracefully)
- [ ] chrome://extensions/ - Shows appropriate error
- [ ] chrome://settings/ - Shows appropriate error

## Performance Test

- [ ] Transforming with 1 image: < 10 seconds
- [ ] Transforming with 3 images: < 30 seconds
- [ ] Transforming without images: < 5 seconds
- [ ] Extension doesn't slow down browser
- [ ] Can transform multiple pages in different tabs

## UI/UX Test

- [ ] Popup is visually appealing
- [ ] Settings page is easy to use
- [ ] Buttons have hover effects
- [ ] Loading states are clear
- [ ] Error messages are readable
- [ ] Watermark is visible but not intrusive

## Browser Console Test

Open DevTools (F12) during transformation:

- [ ] No JavaScript errors in console
- [ ] API calls are logged correctly
- [ ] No CORS errors
- [ ] No CSP violations

## Known Limitations

These are expected behaviors:
- Won't work on chrome:// pages (browser limitation)
- Some complex websites may not transform perfectly
- Rate limiting may occur with many rapid requests
- Some DALL-E prompts may be rejected by OpenAI safety

---

**All tests passed?** ✅ Extension is ready to use!

**Found issues?** Check the README.md troubleshooting section.
