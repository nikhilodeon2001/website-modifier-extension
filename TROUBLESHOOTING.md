# Troubleshooting Guide

## Installation Issues

### Extension won't load
**Error**: "Manifest file is missing or unreadable"
- **Solution**: Make sure you selected the `extension` folder, not the parent folder
- **Check**: The folder should contain `manifest.json` at the root level

### Extension loads but icon doesn't appear
- **Solution**: Click the puzzle piece icon in Chrome toolbar
- **Action**: Pin the "Website Modifier" extension
- **Check**: Icon should now appear as ✨

### Developer mode can't be enabled
- **Solution**: Some managed Chrome installations disable this
- **Check**: Contact your IT administrator if on a work computer

## Configuration Issues

### Can't save API key
**Error**: Settings don't persist
- **Solution**: Check Chrome storage permissions
- **Action**: Reload the extension in `chrome://extensions/`
- **Test**: Settings page should show saved values after closing and reopening

### Invalid API key error
**Symptoms**: "Invalid API key format" message
- **Check**: Key should start with `sk-`
- **Solution**: Copy the full key from OpenAI platform
- **Common mistake**: Copying only part of the key

### API key works but transformations fail
**Error**: "API request failed: 401"
- **Cause**: API key is invalid or expired
- **Solution**: Generate a new key at https://platform.openai.com/api-keys
- **Check**: Verify you have billing set up in your OpenAI account

## Transformation Issues

### Button clicks but nothing happens
**Debugging steps**:
1. Open DevTools (F12)
2. Go to Console tab
3. Click "Transform Page" again
4. Look for error messages

**Common errors**:
- `Failed to fetch`: Network issue or CORS problem
- `API request failed: 429`: Rate limit exceeded
- `API request failed: 402`: Insufficient credits

### Page transforms but looks broken
**Cause**: Some websites have complex structures
- **Solution**: Try a different website
- **Works well**: News sites (CNN, NYTimes, BBC)
- **May have issues**: Single-page apps (SPAs), dynamic sites

### Images don't generate
**Error**: Image generation returns 400 error
- **Cause**: Content policy violation
- **Solution 1**: Try a different topic
- **Solution 2**: Switch to GPT Image 1 — Low (may be less strict)
- **Solution 3**: Disable image generation

### Transformation takes too long
**If > 60 seconds**:
1. Check your internet connection
2. Reduce number of images
3. Switch to GPT-3.5 Turbo (faster)
4. Try again with images disabled

**Typical times**:
- No images: 3-5 seconds
- 1 image: 8-12 seconds
- 3 images: 20-30 seconds
- 5 images: 40-60 seconds

## API & Billing Issues

### Rate limit exceeded (429 error)
**Message**: "Rate limit reached for requests"
- **Cause**: Too many requests too quickly
- **Solution**: Wait 20-60 seconds before trying again
- **Prevention**: Space out your transformations
- **Upgrade**: Consider upgrading OpenAI account tier

### Insufficient credits (402 error)
**Message**: "You exceeded your current quota"
- **Cause**: No credits in OpenAI account
- **Solution**: Add credits at https://platform.openai.com/account/billing
- **Check**: Set up payment method
- **Monitor**: Check usage dashboard

### API costs too high
**Reduce costs**:
1. Use GPT-3.5 Turbo instead of GPT-4 (30x cheaper)
2. Use GPT Image 1 — Low instead of High (50% cheaper)
3. Reduce number of images generated
4. Disable images entirely for text-only transformations

**Cost comparison per transformation**:
- GPT-4 + 3 GPT Image 1 High images: ~$0.15
- GPT-3.5 + 3 GPT Image 1 Low images: ~$0.06
- GPT-3.5 + no images: ~$0.001

## Browser & Website Issues

### Extension doesn't work on chrome:// pages
**This is expected behavior**
- **Cause**: Chrome security restrictions
- **Pages affected**: chrome://extensions/, chrome://settings/, etc.
- **Solution**: Use on regular websites only

### Website blocks the transformation
**Symptoms**: Page refreshes or content reverts
- **Cause**: Website has JavaScript that reloads content
- **Solution**: Try the transformation again quickly
- **Workaround**: Disable JavaScript (not recommended)

### Content-Security-Policy errors
**Error**: CSP violation in console
- **Cause**: Website's strict security policies
- **Impact**: May prevent some transformations
- **Solution**: Try a different website

### Images show as broken
**Symptoms**: Images don't display after transformation
- **Cause 1**: CORS restrictions on image URLs
- **Cause 2**: OpenAI image URLs expired
- **Solution**: The images are temporary (1 hour from OpenAI)
- **Note**: This is a known limitation

## Performance Issues

### Chrome becomes slow
**If browser slows down**:
1. Close the extension popup
2. Reduce number of open tabs
3. Clear browser cache
4. Restart Chrome

### Memory usage is high
- **Cause**: Storing original page content
- **Solution**: Reset the page when done
- **Prevention**: Close transformed tabs you're not using

### Multiple transformations fail
**If consecutive transformations don't work**:
1. Reset the current page first
2. Wait a few seconds
3. Try again
4. Check OpenAI API status: https://status.openai.com

## Debugging Tips

### View extension logs
**Background script**:
1. Go to `chrome://extensions/`
2. Find "Website Modifier"
3. Click "service worker" link
4. Check console for errors

**Popup**:
1. Right-click extension icon
2. Select "Inspect popup"
3. Check console tab

**Content script**:
1. Open DevTools on any webpage (F12)
2. Go to Console tab
3. Transform the page
4. Watch for errors

### Common console errors

**"Failed to fetch"**
- Check internet connection
- Verify API key is set
- Check OpenAI API status

**"Cannot read property of undefined"**
- Page structure is unusual
- Try a different website
- Report as a bug

**"Extension context invalidated"**
- Extension was reloaded
- Refresh the webpage
- Try again

## Still Having Issues?

### Check these resources:
1. ✅ README.md - Full documentation
2. ✅ QUICK_START.md - Installation guide
3. ✅ TESTING_CHECKLIST.md - Verify setup
4. ✅ OpenAI Status: https://status.openai.com
5. ✅ Chrome Extension Docs: https://developer.chrome.com/docs/extensions

### Debug checklist:
- [ ] API key is correctly configured
- [ ] Have billing set up on OpenAI account
- [ ] Have available credits
- [ ] Extension is enabled in chrome://extensions/
- [ ] Tested on a known-working site (cnn.com)
- [ ] Checked browser console for errors
- [ ] Checked extension service worker logs
- [ ] Internet connection is working

### Report a bug:
If you've tried everything above and it still doesn't work:
1. Note the exact error message
2. Note which website you were testing on
3. Note your Chrome version (chrome://version/)
4. Check the extension logs
5. File an issue with all this information

---

**Remember**: This extension makes real API calls to OpenAI which cost money. Always monitor your usage and set spending limits in your OpenAI account!
