// Background service worker for Chrome extension
// Handles API calls to OpenAI

// Import IndexedDB helper for image storage
importScripts('imageStore.js');

// ============================================================================
// CONSOLE LOG CAPTURE FOR DEBUGGING
// ============================================================================
let logBuffer = [];
let originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};
let logsAreCaptured = false;
let logSavingEnabled = true; // Default to true, will be loaded from storage

// Global debug flag - controls whether debug logs are shown
let DEBUG_MODE = false;

// Load debug setting from storage
chrome.storage.local.get(['enableDebugLogs'], (result) => {
  DEBUG_MODE = result.enableDebugLogs || false;
});

// Listen for debug setting changes in real-time
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.enableDebugLogs) {
    DEBUG_MODE = changes.enableDebugLogs.newValue || false;
  }
});

// Debug-aware console wrapper - only logs when DEBUG_MODE is true
const debug = {
  log: (...args) => DEBUG_MODE && originalConsole.log(...args),
  warn: (...args) => DEBUG_MODE && originalConsole.warn(...args),
  error: (...args) => originalConsole.error(...args) // Always show errors
};

// ============================================================================
// WEB NAVIGATION LISTENER (Capture URLs before server redirects)
// ============================================================================
/**
 * Listen for navigation events to capture intended URLs before server redirects to 404
 * This solves the problem where visiting a generated URL gets redirected to /404
 * by the server before our content script can intercept it.
 */
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  // Only process main frame navigations (not iframes)
  if (details.frameId !== 0) return;

  const url = details.url;
  debug.log('🧭 [Navigation] onBeforeNavigate:', url);

  // Check if this URL is a generated URL in our cache
  const storage = await chrome.storage.local.get(['generatedToOriginalMap']);
  const generatedMap = storage.generatedToOriginalMap || {};

  // Helper to normalize URLs for comparison
  const normalizeUrl = (url) => {
    try {
      const urlObj = new URL(url);
      const path = urlObj.pathname.replace(/\/$/, '');
      return `${urlObj.protocol}//${urlObj.host}${path}`;
    } catch {
      return url;
    }
  };

  const normalizedUrl = normalizeUrl(url);

  // Check if this is a generated URL (exact or normalized match)
  const isGeneratedUrl = generatedMap[url] ||
                         Object.keys(generatedMap).some(genUrl => normalizeUrl(genUrl) === normalizedUrl);

  if (isGeneratedUrl) {
    // Store the intended URL so content script can use it if we get redirected to 404
    debug.log('🎯 [Navigation] Detected generated URL navigation, storing intended URL:', url);
    await chrome.storage.local.set({
      pendingIntercept: {
        url: url,
        timestamp: Date.now(),
        tabId: details.tabId
      }
    });
  }
});

/**
 * Listen for navigation completion to detect 404 redirects
 */
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only process main frame navigations
  if (details.frameId !== 0) return;

  const url = details.url;

  // Check if we have a pending intercept for this tab (handles /404 and framework redirects)
  const storage = await chrome.storage.local.get(['pendingIntercept']);
  const pending = storage.pendingIntercept;

  if (pending && pending.tabId === details.tabId) {
    const age = Date.now() - pending.timestamp;
    if (age < 5000) {
      if (url !== pending.url) {
        // We landed somewhere other than the intended generated URL — got redirected
        debug.log('🔍 [Navigation] Redirect detected, keeping pending intercept for content script:', pending.url);
        debug.log('   Landed at:', url);
        // Keep it in storage so content script can override currentUrl
      } else {
        // We actually landed on the generated URL (shouldn't normally happen since server would 404)
        debug.log('✅ [Navigation] Landed on intended generated URL, clearing pending intercept');
        await chrome.storage.local.remove('pendingIntercept');
      }
    } else {
      debug.log('⏰ [Navigation] Pending intercept too old, clearing');
      await chrome.storage.local.remove('pendingIntercept');
    }
  }
});

/**
 * Inject content script at navigation commit for auto-intercept.
 * Fires before page content renders, allowing the content script's page-hiding
 * IIFE to prevent any flash of original content.
 * Only runs when the user has enabled auto-intercept; otherwise no-ops.
 */
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;

  const storage = await chrome.storage.local.get(['autoInterceptSettings']);
  const autoSettings = storage.autoInterceptSettings || {};
  if (!autoSettings.interceptOriginalUrls && !autoSettings.interceptGeneratedUrls) return;

  try {
    await chrome.scripting.executeScript({
      target: { tabId: details.tabId },
      files: ['content/content.js'],
      injectImmediately: true
    });
  } catch (e) {
    // Not injectable (chrome://, new tab page, etc.)
  }
});

/**
 * Start capturing console logs to buffer
 */
async function startLogCapture() {
  try {
    const result = await chrome.storage.local.get(['enableDebugLogs', 'enableLogSaving']);
    const debugEnabled = result.enableDebugLogs || false;
    logSavingEnabled = result.enableLogSaving || false;

    // Only capture logs if BOTH debug mode AND log saving are enabled
    if (!debugEnabled || !logSavingEnabled || logsAreCaptured) return;
  } catch (error) {
    console.error('Failed to load log saving setting:', error);
    return;
  }

  logsAreCaptured = true;
  logBuffer = [];

  const timestamp = () => new Date().toISOString();

  console.log = function(...args) {
    logBuffer.push(`[${timestamp()}] [BACKGROUND] LOG: ${args.join(' ')}`);
    originalConsole.log.apply(console, args);
  };

  console.warn = function(...args) {
    logBuffer.push(`[${timestamp()}] [BACKGROUND] WARN: ${args.join(' ')}`);
    originalConsole.warn.apply(console, args);
  };

  console.error = function(...args) {
    logBuffer.push(`[${timestamp()}] [BACKGROUND] ERROR: ${args.join(' ')}`);
    originalConsole.error.apply(console, args);
  };
}

/**
 * Stop capturing and restore original console
 */
function stopLogCapture() {
  if (!logsAreCaptured) return;

  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  logsAreCaptured = false;
}

/**
 * Get the captured logs (to be sent to content script for file download)
 */
function getCapturedLogs() {
  return [...logBuffer];
}

/**
 * ============================================================================
 * LOG FILE DOWNLOAD HELPER
 * ============================================================================
 */

/**
 * Download log file using Chrome downloads API
 * @param {string} logContent - The log content to download
 * @param {string} filename - The filename for the download
 */
async function downloadLogsFile(logContent, filename) {
  try {
    // Convert text to data URL
    const blob = new Blob([logContent], { type: 'text/plain' });
    const reader = new FileReader();

    return new Promise((resolve, reject) => {
      reader.onload = function() {
        const dataUrl = reader.result;

        // Use Chrome downloads API to download the file
        chrome.downloads.download({
          url: dataUrl,
          filename: filename,
          saveAs: false  // Auto-save to Downloads folder
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            console.error('❌ Failed to download logs:', chrome.runtime.lastError);
            reject({ success: false, error: chrome.runtime.lastError.message });
          } else {
            debug.log(`✅ Logs download started: ${filename} (ID: ${downloadId})`);
            resolve({ success: true, downloadId });
          }
        });
      };

      reader.onerror = function() {
        console.error('❌ Failed to read log blob:', reader.error);
        reject({ success: false, error: 'Failed to read log content' });
      };

      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('❌ Failed to create log download:', error);
    return { success: false, error: error.message };
  }
}

/**
 * ============================================================================
 * URL NORMALIZATION HELPER
 * ============================================================================
 */

/**
 * Normalize URL for comparison (removes trailing slashes, query params, fragments)
 * This ensures URLs match even if they differ slightly in format
 */
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove trailing slash from pathname
    const path = urlObj.pathname.replace(/\/$/, '');
    // Return normalized version (protocol + host + path, no query/hash)
    return `${urlObj.protocol}//${urlObj.host}${path}`;
  } catch (error) {
    debug.warn('⚠️ [URL] Failed to normalize URL:', url, error);
    return url; // Return as-is if invalid
  }
}

/**
 * ============================================================================
 * CONTENT SCRIPT COMMUNICATION HELPERS
 * ============================================================================
 */

/**
 * Helper function to check if content script is loaded and responsive
 * Sends a ping message and waits for pong response
 */
async function isContentScriptLoaded(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return response && response.pong === true;
  } catch (error) {
    debug.warn('⚠️ [Background] Content script not responding to ping:', error.message);
    return false;
  }
}

/**
 * Helper function to ensure content script is loaded
 * If not loaded, programmatically inject it
 */
async function ensureContentScript(tabId) {
  debug.log('🔍 [Background] Checking if content script is loaded...');

  const isLoaded = await isContentScriptLoaded(tabId);

  if (isLoaded) {
    debug.log('✅ [Background] Content script is already loaded and responsive');
    return true;
  }

  debug.log('⚠️ [Background] Content script not loaded, injecting...');

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content/content.js']
    });

    // Wait a bit for script to initialize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Verify it loaded
    const isLoadedNow = await isContentScriptLoaded(tabId);
    if (isLoadedNow) {
      debug.log('✅ [Background] Content script injected successfully');
      return true;
    } else {
      console.error('❌ [Background] Content script injection failed');
      return false;
    }
  } catch (error) {
    console.error('❌ [Background] Failed to inject content script:', error);
    return false;
  }
}

/**
 * Helper function to send message with retry logic
 * Retries up to 3 times with 500ms delay between attempts
 */
async function sendMessageWithRetry(tabId, message, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      debug.log(`📤 [Background] Sending message (attempt ${attempt}/${maxRetries}):`, message.action);
      const response = await chrome.tabs.sendMessage(tabId, message);
      debug.log(`✅ [Background] Message sent successfully on attempt ${attempt}`);
      if (response && response.success === false) {
        debug.warn(`⚠️ [Background] Message sent but response indicates failure:`, response.error);
      }
      return response;
    } catch (error) {
      debug.warn(`⚠️ [Background] Message failed on attempt ${attempt}:`, error.message);
      debug.warn(`   Error name:`, error.name);
      debug.warn(`   Error stack:`, error.stack);

      if (attempt < maxRetries) {
        debug.log(`⏳ [Background] Waiting 500ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        console.error(`❌ [Background] All ${maxRetries} attempts failed`);
        console.error(`   Action was:`, message.action);
        console.error(`   Last error:`, error.message);
        throw error;
      }
    }
  }
}

/**
 * Clean expired cache on extension startup
 */
chrome.runtime.onStartup.addListener(() => {
  debug.log('🚀 [Extension] Starting up, cleaning expired cache...');
  cleanExpiredCache();
});

// Also clean on install/update
chrome.runtime.onInstalled.addListener(() => {
  debug.log('🚀 [Extension] Installed/Updated, cleaning expired cache...');
  cleanExpiredCache();
});

/**
 * Listen for messages from popup and content scripts
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Transform page action
  if (request.action === 'transformPage') {
    handleTransformPage(request, sendResponse);
    return true; // Keep message channel open for async response
  }

  // Download logs action
  if (request.action === 'downloadLogs') {
    downloadLogsFile(request.logContent, request.filename).then(sendResponse);
    return true;
  }

  // Cache management messages
  if (request.action === 'getCacheStats') {
    getCacheStats().then(sendResponse);
    return true;
  }

  if (request.action === 'searchCache') {
    searchCache(request.query, request.modeFilter).then(sendResponse);
    return true;
  }

  if (request.action === 'deleteTransformation') {
    deleteTransformationById(request.id).then(sendResponse);
    return true;
  }

  if (request.action === 'clearAllCache') {
    clearAllCache().then(sendResponse);
    return true;
  }

  if (request.action === 'getTransformationByUrl') {
    getTransformationByUrl(request.url).then(sendResponse);
    return true;
  }

  if (request.action === 'deleteCacheEntry') {
    deleteCacheEntryByUrl(request.url).then(sendResponse);
    return true;
  }

  // Get image blob URL from IndexedDB
  if (request.action === 'getImageBlobUrl') {
    getImageBlobUrl(request.imageId)
      .then(blobUrl => sendResponse({ blobUrl }))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  // Lock document.title in page context (bypasses CSP via chrome.scripting world: MAIN)
  if (request.action === 'lockTitle') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: (title) => {
        let proto = Object.getPrototypeOf(document);
        let orig = null;
        while (proto) {
          orig = Object.getOwnPropertyDescriptor(proto, 'title');
          if (orig) break;
          proto = Object.getPrototypeOf(proto);
        }
        if (!orig) return;
        orig.set.call(document, title);
        Object.defineProperty(document, 'title', {
          get: orig.get.bind(document),
          set: function(v) {
            var desired = document.documentElement.getAttribute('data-ext-desired-title');
            if (desired && v !== desired) return;
            orig.set.call(document, v);
          },
          configurable: true
        });

        // Watch <title> element for direct DOM text mutations
        // (React 18 concurrent renderer patches text nodes directly, bypassing document.title setter)
        function attachTitleObserver(titleEl) {
          var obs = new MutationObserver(function() {
            var desired = document.documentElement.getAttribute('data-ext-desired-title');
            if (desired && document.title !== desired) {
              orig.set.call(document, desired);
            }
          });
          obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
          return obs;
        }

        var titleEl = document.querySelector('title');
        var titleObs = titleEl ? attachTitleObserver(titleEl) : null;

        // Watch <head> in case React replaces the <title> element entirely
        new MutationObserver(function(mutations) {
          mutations.forEach(function(m) {
            m.addedNodes.forEach(function(node) {
              if (node.nodeName === 'TITLE') {
                var desired = document.documentElement.getAttribute('data-ext-desired-title');
                if (desired) orig.set.call(document, desired);
                if (titleObs) titleObs.disconnect();
                titleObs = attachTitleObserver(node);
              }
            });
          });
        }).observe(document.head, { childList: true });
      },
      args: [request.title]
    }).then(() => sendResponse({ success: true }))
      .catch(e => sendResponse({ success: false, error: e.message }));
    return true;
  }

  // Restore original document.title descriptor in page context
  if (request.action === 'unlockTitle') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        document.documentElement.removeAttribute('data-ext-desired-title');
        let proto = Object.getPrototypeOf(document);
        let orig = null;
        while (proto) {
          orig = Object.getOwnPropertyDescriptor(proto, 'title');
          if (orig) break;
          proto = Object.getPrototypeOf(proto);
        }
        if (orig) Object.defineProperty(document, 'title', orig);
      }
    }).then(() => sendResponse({ success: true }))
      .catch(() => sendResponse({ success: false }));
    return true;
  }
});

/**
 * Send progress update to popup
 */
function sendProgressUpdate(message) {
  chrome.runtime.sendMessage({
    action: 'progressUpdate',
    message: message
  }).catch(() => {
    // Popup might be closed, ignore errors
  });
}

/**
 * Main transformation handler
 */
async function handleTransformPage(request, sendResponse) {
  try {
    // Start capturing logs for this transformation
    await startLogCapture();

    const { mode, topic, transformPrompt, tabId, generateImages: shouldGenerateImages, imageCount, replaceUrl, selectedImageSelectors, selectedImagePrompts, selectedUseModifiedDesc, articleLengthLimit } = request;

    debug.log('🚀 [Transform] Starting transformation...');
    debug.log('🎯 [Transform] Mode:', mode);
    debug.log('📝 [Transform] Topic:', topic);
    debug.log('📝 [Transform] Transform Prompt:', transformPrompt);
    debug.log('🖼️ [Transform] Generate images:', shouldGenerateImages);
    debug.log('🔢 [Transform] Image count:', imageCount);
    debug.log('🔗 [Transform] Replace URL:', replaceUrl);
    debug.log('🎨 [Transform] Selected image selectors:', selectedImageSelectors?.length || 0);
    debug.log('📏 [Transform] Article length limit:', articleLengthLimit, 'words');

    // Get API key and model settings from storage
    const { openaiApiKey, textModel, imageModel } = await chrome.storage.sync.get([
      'openaiApiKey',
      'textModel',
      'imageModel'
    ]);

    if (!openaiApiKey) {
      console.error('❌ [Transform] No API key configured');
      sendResponse({
        success: false,
        error: 'OpenAI API key not configured. Please set it in the extension settings.'
      });
      return;
    }

    debug.log('🔑 [Transform] API key configured');

    // Use selected models or defaults
    const selectedTextModel = textModel || 'gpt-4';
    const selectedImageModel = imageModel || 'dall-e-3';

    debug.log('🤖 [Transform] Text model:', selectedTextModel);
    debug.log('🎨 [Transform] Image model:', selectedImageModel);

    // Step 0: Ensure content script is loaded
    debug.log('🔍 [Step 0/4] Ensuring content script is loaded...');
    debug.log('   Tab ID:', tabId);
    sendProgressUpdate('🔍 Loading content script...');

    // Get tab info for debugging
    let tab;
    try {
      tab = await chrome.tabs.get(tabId);
      debug.log('   Tab URL:', tab.url);
      debug.log('   Tab title:', tab.title);
      debug.log('   Tab status:', tab.status);
    } catch (error) {
      console.error('❌ [Step 0/4] Failed to get tab info:', error);
      sendResponse({
        success: false,
        error: 'Could not access tab. Please try again.'
      });
      return;
    }

    const scriptLoaded = await ensureContentScript(tabId);
    if (!scriptLoaded) {
      console.error('❌ [Step 0/4] Content script could not be loaded');
      console.error('   Tab URL:', tab.url);
      console.error('   This could be due to:');
      console.error('   - CSP restrictions on the page');
      console.error('   - Chrome Web Store or internal pages (not allowed)');
      console.error('   - Page not fully loaded');
      sendResponse({
        success: false,
        error: 'Could not load content script. Please refresh the page and try again.'
      });
      return;
    }
    debug.log('✅ [Step 0/4] Content script ready');

    // Step 1: Analyze page content
    debug.log('📊 [Step 1/4] Analyzing page content...');
    sendProgressUpdate('📊 Analyzing page content...');
    let analysisResponse;
    try {
      analysisResponse = await sendMessageWithRetry(tabId, {
        action: 'analyzeContent',
        articleLengthLimit: articleLengthLimit || 1000,
        selectedModel: selectedTextModel
      });
    } catch (error) {
      console.error('❌ [Step 1/4] Failed to send message to content script:', error);
      sendResponse({
        success: false,
        error: 'Could not connect to page. Please refresh the page and try again.'
      });
      return;
    }

    if (!analysisResponse || !analysisResponse.success) {
      console.error('❌ [Step 1/4] Failed to analyze page content');
      sendResponse({ success: false, error: 'Failed to analyze page content' });
      return;
    }

    const analysis = analysisResponse.analysis;
    debug.log('✅ [Step 1/4] Page analysis complete:');
    debug.log('   - H1 headings:', analysis.headings.h1.length);
    debug.log('   - H2 headings:', analysis.headings.h2.length);
    debug.log('   - H3 headings:', analysis.headings.h3.length);
    debug.log('   - Paragraphs:', analysis.paragraphs.length);
    debug.log('   - Images:', analysis.images.length);

    // Validate article length before calling API
    // Estimate if the output will fit in the model's token limit
    const totalElements = analysis.paragraphs.length + analysis.headings.h2.length + analysis.headings.h3.length;
    const isGpt35 = selectedTextModel.includes('gpt-3.5-turbo');
    const maxElementsForGpt35 = 40; // GPT-3.5-turbo struggles above ~40 elements
    const maxElementsForGpt4 = 80;  // GPT-4 can handle more

    if (isGpt35 && totalElements > maxElementsForGpt35) {
      console.error('   ❌ [Validation] Article too long for GPT-3.5-turbo');
      console.error(`      Total elements: ${totalElements} (${analysis.paragraphs.length} paragraphs, ${analysis.headings.h2.length} H2, ${analysis.headings.h3.length} H3)`);
      console.error(`      Maximum for GPT-3.5-turbo: ${maxElementsForGpt35} elements`);
      console.error('      Solutions:');
      console.error('         1. Switch to GPT-4-turbo (recommended)');
      console.error('         2. Reduce the Article Length slider');
      throw new Error(
        `Article too long for GPT-3.5-turbo (${totalElements} elements). ` +
        `Try: 1) Switch to GPT-4-turbo, or 2) Reduce Article Length slider to ${maxElementsForGpt35} or less`
      );
    } else if (!isGpt35 && totalElements > maxElementsForGpt4) {
      debug.warn('   ⚠️ [Validation] Article is very long, may hit token limits');
      debug.warn(`      Total elements: ${totalElements} (recommended max: ${maxElementsForGpt4})`);
      debug.warn('      If transformation fails, try reducing the Article Length slider');
    }

    // Step 2: Generate content using OpenAI (mode-dependent)
    let contentResult;
    const startTime = Date.now();

    if (mode === 'transform') {
      debug.log('📝 [Step 2/4] Generating context-aware content with', selectedTextModel, '...');
      sendProgressUpdate(`🤖 Generating content with ${selectedTextModel}...`);
      contentResult = await generateContextAwareContent(openaiApiKey, transformPrompt, analysis, selectedTextModel);
    } else {
      debug.log('📝 [Step 2/4] Generating new content with', selectedTextModel, '...');
      sendProgressUpdate(`🤖 Generating content with ${selectedTextModel}...`);
      contentResult = await generateContent(openaiApiKey, topic, analysis, selectedTextModel);
    }

    const contentTime = Date.now() - startTime;

    if (!contentResult.success) {
      console.error('❌ [Step 2/4] Content generation failed:', contentResult.error);
      sendResponse({ success: false, error: contentResult.error });
      return;
    }

    // Log if content was partial (but continue - we'll use what we got)
    if (contentResult.partial) {
      debug.warn('⚠️ [Step 2/4] Partial content generated (article too long for model)');
      debug.warn('   Transformation will replace as much as possible from top to bottom');
    }

    debug.log('✅ [Step 2/4] Content generated in', contentTime + 'ms');
    debug.log('   - Headline:', contentResult.content.mainHeadline);
    debug.log('   - Paragraphs:', contentResult.content.paragraphs.length);
    debug.log('   - Image descriptions:', contentResult.content.imageDescriptions.length);

    // Post-process headline: strip site branding suffixes the AI sometimes includes
    // Matches: " - The New York Times", " | CNN", " – BBC News", " : Reuters", etc.
    // Safe: requires whitespace before separator, uppercase after, so "Spider-Man: No Way Home" is not stripped
    if (contentResult.content.mainHeadline) {
      const brandingSuffixPattern = /\s[\-\u2013\u2014|:]\s+[A-Z][A-Za-z\s\.]+$/;
      const originalHeadline = contentResult.content.mainHeadline;
      contentResult.content.mainHeadline = contentResult.content.mainHeadline
        .replace(brandingSuffixPattern, '')
        .trim();
      if (contentResult.content.mainHeadline !== originalHeadline) {
        debug.log('   - Headline branding stripped:', originalHeadline, '→', contentResult.content.mainHeadline);
      }
    }

    // Step 3: Generate images (if enabled)
    let images = [];
    if (shouldGenerateImages && contentResult.content.imageDescriptions.length > 0) {
      // If user manually selected images, generate exactly that many
      const targetImageCount = (selectedImageSelectors && selectedImageSelectors.length > 0)
        ? selectedImageSelectors.length
        : (imageCount || 3);

      debug.log('🎨 [Step 3/4] Generating', targetImageCount, 'images with', selectedImageModel, '...');
      sendProgressUpdate(`🎨 Generating ${targetImageCount} AI image${targetImageCount > 1 ? 's' : ''} with ${selectedImageModel}...`);
      if (selectedImageSelectors && selectedImageSelectors.length > 0) {
        debug.log('   Using manually selected images:', selectedImageSelectors.length);
      }

      const imageStartTime = Date.now();
      // Use transformed alt texts as DALL-E prompts if available, otherwise use image descriptions
      const useAltTexts = contentResult.content.imageAlts && contentResult.content.imageAlts.length > 0;
      const contentPrompts = useAltTexts
        ? contentResult.content.imageAlts
        : contentResult.content.imageDescriptions;
      const defaultFallback = topic || transformPrompt || contentResult.content.mainHeadline || 'news article image';

      // Build per-slot prompts: custom prompt > content prompt > fallback
      const imagePrompts = [];
      for (let i = 0; i < targetImageCount; i++) {
        const customPrompt = selectedImagePrompts?.[i];
        if (customPrompt && customPrompt.trim()) {
          imagePrompts.push(customPrompt.trim());
        } else {
          imagePrompts.push(contentPrompts?.[i] || defaultFallback);
        }
      }

      if (useAltTexts) {
        debug.log('   Using transformed alt texts as DALL-E prompts:', imagePrompts.length);
      } else {
        debug.log('   Using image descriptions as DALL-E prompts:', imagePrompts.length);
      }

      images = await generateImages(openaiApiKey, imagePrompts, selectedImageModel);
      const imageTime = Date.now() - imageStartTime;

      const successCount = images.filter(img => img.success).length;
      const failedCount = images.length - successCount;
      debug.log('✅ [Step 3/4] Generated', successCount, '/', imagePrompts.length, 'images in', imageTime + 'ms');

      if (failedCount > 0) {
        debug.warn(`   ⚠️ [Step 3/4] ${failedCount} image(s) failed to generate`);
        images.forEach((img, idx) => {
          if (!img.success) {
            console.error(`   ❌ [Step 3/4] Image ${idx + 1} error:`, img.error);
          }
        });
      }
    } else {
      debug.log('⏭️ [Step 3/4] Skipping image generation');
      sendProgressUpdate('⏭️ Skipping image generation...');
    }

    // Capture original URL BEFORE content replacement (before URL changes)
    // Reuse tab variable from Step 0
    const originalUrl = tab.url;
    debug.log('📍 [Transform] Captured original URL:', originalUrl);

    // Generate fake URL if requested
    let generatedUrl = null;
    if (replaceUrl) {
      debug.log('🔗 [Transform] Generating fake URL...');
      debug.log('   replaceUrl flag:', replaceUrl);
      debug.log('   Current tab URL:', tab.url);

      // Use topic for replace mode, or extract from transformPrompt for transform mode
      const urlTopic = mode === 'transform' ? transformPrompt : topic;
      generatedUrl = generateFakeUrl(urlTopic, contentResult.content.mainHeadline, tab.url);
      debug.log('   Generated URL:', generatedUrl);
      debug.log('   Generated URL type:', typeof generatedUrl);
    } else {
      debug.log('⏭️ [Transform] Skipping URL generation (replaceUrl is', replaceUrl, ')');
    }

    // Step 4: Replace content on page
    debug.log('🔄 [Step 4/4] Replacing page content...');
    sendProgressUpdate('✨ Applying changes to page...');

    // Override LLM-generated captions with user's custom prompt (verbatim) where provided,
    // but only for slots that already have a caption to replace.
    if (selectedImagePrompts?.length && contentResult.content.imageCaptions?.length) {
      selectedImagePrompts.forEach((prompt, i) => {
        if (prompt && prompt.trim() && contentResult.content.imageCaptions[i]) {
          contentResult.content.imageCaptions[i] = prompt.trim();
        }
      });
    }

    // Capture background logs before sending to content script
    const backgroundLogs = getCapturedLogs();

    let replaceResponse;
    try {
      replaceResponse = await sendMessageWithRetry(tabId, {
        action: 'replaceContent',
        content: contentResult.content,
        images: images,
        generatedUrl: generatedUrl,
        replaceUrl: replaceUrl,
        selectedImageSelectors: selectedImageSelectors,
        backgroundLogs: backgroundLogs  // Include background logs
      });
    } catch (error) {
      console.error('❌ [Step 4/4] Failed to send message to content script:', error);

      // Stop log capture on error
      stopLogCapture();

      sendResponse({
        success: false,
        error: 'Could not connect to page. Please refresh the page and try again.'
      });
      return;
    }

    if (replaceResponse && replaceResponse.success) {
      debug.log('✅ [Step 4/4] Content replacement complete!');
      debug.log('🎉 [Transform] Transformation successful!');

      // ⭐ Use original URL from content script response (captured BEFORE URL was modified)
      // This ensures we save the correct original URL to cache
      const actualOriginalUrl = replaceResponse.originalUrl || originalUrl;
      debug.log('📍 [Cache] Original URL from content script:', replaceResponse.originalUrl);
      debug.log('📍 [Cache] Original URL from tab.url:', originalUrl);
      debug.log('📍 [Cache] Using for cache:', actualOriginalUrl);

      // 🔍 DEBUG LOGGING
      debug.log('🔍 DEBUG - Response from content script:', JSON.stringify(replaceResponse, null, 2));
      debug.log('🔍 DEBUG - originalUrl from response:', replaceResponse.originalUrl);
      debug.log('🔍 DEBUG - originalUrl from tab:', originalUrl);
      debug.log('🔍 DEBUG - actualOriginalUrl being used:', actualOriginalUrl);
      debug.log('🔍 DEBUG - generatedUrl:', generatedUrl);

      // Save transformation to cache (NEW: pass content and images)
      debug.log('💾 [Cache] Saving transformation to cache...');
      await saveTransformationToCache(
        actualOriginalUrl,  // ⭐ Use original URL from content script (before modification)
        generatedUrl,
        tabId,
        {
          mode,
          topic,
          transformPrompt,
          timestamp: Date.now(),
          selectedImageSelectors  // Save image selectors for reapplication
        },
        contentResult.content,  // Pass the generated content
        images                  // Pass the generated images
      );
      debug.log('✅ [Cache] Transformation saved');

      // 🔍 DEBUG - Verify what was saved to cache
      const verification = await chrome.storage.local.get(['transformationCache', 'generatedToOriginalMap']);
      debug.log('🔍 DEBUG - Cache after save:');
      debug.log('   cacheKeys:', JSON.stringify(Object.keys(verification.transformationCache || {}), null, 2));
      debug.log('   mapKeys:', JSON.stringify(Object.keys(verification.generatedToOriginalMap || {}), null, 2));
      debug.log('   cacheHasOriginal:', !!(verification.transformationCache || {})[actualOriginalUrl]);
      debug.log('   cacheHasGenerated:', !!(verification.transformationCache || {})[generatedUrl]);
      debug.log('   mapHasGenerated:', !!(verification.generatedToOriginalMap || {})[generatedUrl]);
    } else {
      console.error('❌ [Step 4/4] Content replacement failed');
    }

    // Add image error warnings to the response if any images failed
    if (replaceResponse && replaceResponse.success) {
      const failedImages = images.filter(img => !img.success);
      if (failedImages.length > 0) {
        replaceResponse.warning = `${failedImages.length} image(s) failed to generate: ${failedImages[0].error}`;
        replaceResponse.imageErrors = failedImages.map(img => img.error);
      }
    }

    // Stop log capture (logs already sent to content script)
    stopLogCapture();

    sendResponse(replaceResponse);

  } catch (error) {
    console.error('❌ [Transform] Fatal error:', error);
    console.error('Stack trace:', error.stack);

    // Stop log capture on fatal error
    stopLogCapture();

    sendResponse({ success: false, error: error.message });
  }
}

/**
 * Get model context window (total input + output tokens)
 */
function getModelContextWindow(model) {
  // GPT-4 Turbo and GPT-4o have large context windows
  if (model.includes('gpt-4-turbo') || model.includes('gpt-4o')) {
    return 128000;  // 128k context window
  }

  // GPT-4 (non-turbo) has 8k context
  if (model.includes('gpt-4') && !model.includes('gpt-4-turbo')) {
    return 8192;
  }

  // GPT-3.5-turbo has 16k context (newer versions)
  if (model.includes('gpt-3.5-turbo')) {
    return 16384;
  }

  // Default to conservative 8k
  return 8192;
}

/**
 * Repair common JSON syntax errors from LLM responses
 * @param {string} jsonString - Potentially malformed JSON string
 * @returns {string} Repaired JSON string
 */
function repairJSON(jsonString) {
  let repaired = jsonString.trim();

  debug.log('   🔧 [JSON Repair] Starting repair process...');

  // 1. Remove trailing commas before closing brackets/braces
  repaired = repaired.replace(/,(\s*[}\]])/g, '$1');
  debug.log('   ✓ [JSON Repair] Removed trailing commas');

  // 2. Fix unterminated strings at end of JSON (common with truncation)
  // If the last character before closing brackets is not a quote, and we have an open quote
  if (repaired.endsWith('}') || repaired.endsWith(']')) {
    const beforeClosing = repaired.substring(0, repaired.lastIndexOf(repaired.endsWith('}') ? '}' : ']'));
    const quoteCount = (beforeClosing.match(/"/g) || []).length;

    // Odd number of quotes means unterminated string
    if (quoteCount % 2 !== 0) {
      const insertPos = repaired.lastIndexOf(repaired.endsWith('}') ? '}' : ']');
      repaired = repaired.substring(0, insertPos) + '"' + repaired.substring(insertPos);
      debug.log('   ✓ [JSON Repair] Fixed unterminated string at end');
    }
  }

  // 3. Add missing closing brackets for truncated responses
  const openBraces = (repaired.match(/{/g) || []).length;
  const closeBraces = (repaired.match(/}/g) || []).length;
  const openBrackets = (repaired.match(/\[/g) || []).length;
  const closeBrackets = (repaired.match(/]/g) || []).length;

  let added = false;
  for (let i = 0; i < (openBrackets - closeBrackets); i++) {
    repaired += ']';
    added = true;
  }
  for (let i = 0; i < (openBraces - closeBraces); i++) {
    repaired += '}';
    added = true;
  }

  if (added) {
    debug.log(`   ✓ [JSON Repair] Added ${openBrackets - closeBrackets} closing brackets, ${openBraces - closeBraces} closing braces`);
  }

  debug.log('   ✅ [JSON Repair] Repair complete');
  return repaired;
}

/**
 * Accurately count tokens in a string
 * Uses ~3.3 chars per token for English text (more accurate than 4)
 * @param {string} text - Text to count tokens for
 * @returns {number} Approximate token count
 */
function countTokens(text) {
  if (!text) return 0;
  // More accurate approximation: 1 token ≈ 3.3 characters for English
  // Add small overhead for formatting/whitespace
  return Math.ceil(text.length / 3.3);
}

/**
 * Count tokens in a complete API request
 * @param {object} requestBody - The full request body object
 * @returns {number} Total token count for the request
 */
function countRequestTokens(requestBody) {
  let totalTokens = 0;

  // Count tokens in all messages
  if (requestBody.messages) {
    for (const message of requestBody.messages) {
      // Add tokens for message content
      totalTokens += countTokens(message.content);
      // Add overhead for message structure (role, formatting, etc.)
      totalTokens += 4;
    }
  }

  // Add overhead for request structure
  totalTokens += 10;

  return totalTokens;
}

/**
 * Get maximum output tokens allowed by the model (different from context window!)
 * @param {string} model - Model name
 * @returns {number} Maximum output tokens
 */
function getModelMaxOutputTokens(model) {
  // All GPT-4 variants: 4,096 max output tokens (API hard limit)
  if (model.includes('gpt-4-turbo') || model.includes('gpt-4o') || model.includes('gpt-4')) {
    return 4096;
  }

  // GPT-3.5-turbo: 4,096 max output tokens
  if (model.includes('gpt-3.5-turbo')) {
    return 4096;
  }

  // Default to conservative 4k
  return 4096;
}

/**
 * Calculate maximum allowed completion tokens for a request
 * @param {string} model - Model name
 * @param {object} requestBody - The request body to send (without max_tokens set)
 * @returns {number} Maximum tokens available for completion
 */
function calculateMaxCompletionTokens(model, requestBody) {
  const contextWindow = getModelContextWindow(model);
  const maxOutputTokens = getModelMaxOutputTokens(model);
  const requestTokens = countRequestTokens(requestBody);

  // Safety buffer to account for minor token counting differences
  const safetyBuffer = 200;

  // Calculate remaining tokens in context window
  const availableInContext = contextWindow - requestTokens - safetyBuffer;

  // CRITICAL: Use the SMALLER of:
  // 1. What the context window allows (available space)
  // 2. What the model's max output limit allows (hard API limit)
  // This prevents "max_tokens is too large" errors!
  const maxCompletionTokens = Math.min(availableInContext, maxOutputTokens);

  // Ensure we have at least 500 tokens for completion, but never exceed max output
  const finalMaxTokens = Math.max(500, Math.min(maxCompletionTokens, maxOutputTokens));

  debug.log('   📊 [Tokens] Context window:', contextWindow);
  debug.log('   📊 [Tokens] Model max output:', maxOutputTokens);
  debug.log('   📊 [Tokens] Request tokens:', requestTokens);
  debug.log('   📊 [Tokens] Safety buffer:', safetyBuffer);
  debug.log('   📊 [Tokens] Available in context:', availableInContext);
  debug.log('   📊 [Tokens] Max completion tokens:', finalMaxTokens, '(limited by', finalMaxTokens >= maxOutputTokens ? 'output limit)' : 'context window)');
  debug.log('   📊 [Tokens] Total would be:', requestTokens + finalMaxTokens, '/', contextWindow);

  return finalMaxTokens;
}

/**
 * Generate context-aware content using OpenAI API
 * This preserves the original article structure while transforming subjects/details
 */
async function generateContextAwareContent(apiKey, transformPrompt, analysis, model) {
  try {
    debug.log('   📤 [API] Sending context-aware transformation request...');
    debug.log('   📝 [API] Transform prompt:', transformPrompt);
    debug.log('   📰 [API] Original article length:', analysis.fullArticleText.length, 'chars');

    // Check if model supports JSON mode
    const supportsJsonMode = model.includes('gpt-4-turbo') ||
                            model.includes('gpt-3.5-turbo-1106') ||
                            model.includes('gpt-4-1106') ||
                            model.includes('gpt-4o') ||
                            model === 'gpt-3.5-turbo';

    if (supportsJsonMode) {
      debug.log('   🔧 [API] Using JSON mode (response_format)');
    } else {
      debug.log('   ⚠️ [API] Model does not support JSON mode, relying on prompts');
    }

    // Extract original author and date for preservation
    const originalAuthor = analysis.authors && analysis.authors.length > 0
      ? analysis.authors[0].text
      : "Unknown";
    const originalDate = analysis.dates && analysis.dates.length > 0
      ? analysis.dates[0].text
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Build request body WITHOUT max_tokens first (so we can measure its size)
    const requestBody = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a MINIMAL MODIFICATION specialist. You MUST respond with ONLY a valid JSON object, nothing else.

CRITICAL RULES - You MUST follow these exactly:
1. This is a MINIMAL MODIFICATION task - change ONLY what the instruction explicitly mentions
2. If the instruction doesn't mention changing something, DO NOT CHANGE IT AT ALL
3. Keep the EXACT SAME topic - if it's about chatbots, keep it about chatbots; if it's about sports, keep it about sports
4. Match the EXACT LENGTH of each element - count words in original and match closely (±2 words max)

CRITICAL ARRAY LENGTH REQUIREMENTS - YOUR RESPONSE WILL BE REJECTED IF THESE ARE WRONG:
- If original has 5 paragraphs → your "paragraphs" array MUST have EXACTLY 5 elements
- If original has 3 subheadlines → your "subHeadlines" array MUST have EXACTLY 3 elements
- If original has 2 section headings → your "sectionHeadings" array MUST have EXACTLY 2 elements
- DO NOT merge multiple paragraphs into one
- DO NOT split one paragraph into multiple
- DO NOT skip or omit any elements
- Each array index maps 1:1 with the original (paragraph[0] → paragraph[0], paragraph[1] → paragraph[1], etc.)

CRITICAL METADATA PRESERVATION:
- The "author" field MUST be copied EXACTLY from the original article - do NOT transform or change it
- The "date" field MUST be copied EXACTLY from the original article - do NOT transform or change it
- These fields are metadata that should always remain identical to the source

CRITICAL HEADLINE RULES:
- Do NOT append site branding like "- The New York Times", "| CNN", "- BBC News" to the mainHeadline
- The mainHeadline should be ONLY the article title, nothing more
- Site branding is added automatically by the browser - do NOT include it in your JSON response

DO NOT:
- Change the fundamental topic or subject matter
- Add new people, places, organizations, or entities unless explicitly instructed
- Make any element longer or shorter than the original
- Change the narrative structure or flow
- Invent new facts or statistics unless explicitly instructed

GOOD EXAMPLE:
Original subheadline: "The unemployment rate dropped to 3.7% in September."
Instruction: "Change the unemployment rate to 5.2%"
Correct output: "The unemployment rate rose to 5.2% in September." (same length, only changed number)

BAD EXAMPLE (DO NOT DO THIS):
Original subheadline: "Many physicians find chatbots threatening."
Instruction: "Change to meditation concerns"
WRONG output: "While meditation is touted for mental health benefits, recent studies suggest a concerning link to increased cancer rates." (completely different topic, way too long, invented facts)
CORRECT output: "Many physicians find meditation concerning for patient care." (keeps structure, similar length)

Your task: Make ONLY the minimal changes requested. Preserve everything else EXACTLY.

Do not include markdown code blocks, explanations, or any text before or after the JSON.

IMPORTANT CAPTION HANDLING:
- If the article contains lines starting with "IMAGE CAPTION:", you MUST extract those into the "imageCaptions" array
- Each "IMAGE CAPTION:" line represents one caption that needs transformation
- Apply the transformation instruction to the captions as well (if applicable)
- CRITICAL: Lines starting with "IMAGE CAPTION:" must ONLY appear in the "imageCaptions" array
- CRITICAL: Do NOT include "IMAGE CAPTION:" lines in the "paragraphs" array
- CRITICAL: Remove the "IMAGE CAPTION:" prefix when adding to the "imageCaptions" array (only include the caption text itself)
- If there are NO image captions in the article, you can OMIT the "imageCaptions" field entirely or set it to an empty array []

IMPORTANT ALT TEXT HANDLING:
- If the article contains lines starting with "IMAGE ALT:", you MUST extract those into the "imageAlts" array
- Each "IMAGE ALT:" line represents one image's alt text that needs transformation
- Apply the transformation instruction to the alt texts contextually (transform them to match the transformed article theme)
- CRITICAL: Lines starting with "IMAGE ALT:" must ONLY appear in the "imageAlts" array
- CRITICAL: Do NOT include "IMAGE ALT:" lines in the "paragraphs" array
- CRITICAL: Remove the "IMAGE ALT:" prefix when adding to the "imageAlts" array (only include the alt text itself)
- If there are NO image alt texts in the article, you can OMIT the "imageAlts" field entirely or set it to an empty array []

Return this EXACT JSON structure:
{
  "mainHeadline": "string",
  "articleDeck": "string or null",
  "subHeadlines": ["string", "string"],
  "sectionHeadings": ["string", "string"],
  "paragraphs": ["string", "string"],
  "imageCaptions": ["string"] (REQUIRED if "IMAGE CAPTION:" appears in article - one entry per caption),
  "imageAlts": ["string"] (REQUIRED if "IMAGE ALT:" appears in article - one entry per alt text),
  "imageDescriptions": ["string", "string"],
  "author": "string",
  "date": "string"
}`
        },
        {
          role: 'user',
          content: `ORIGINAL ARTICLE:
${analysis.fullArticleText}

PRESERVE THESE EXACT VALUES (do NOT transform):
- Original author: "${originalAuthor}"
- Original date: "${originalDate}"

TRANSFORMATION INSTRUCTION:
${transformPrompt}

Apply ONLY the following transformation to the article above:
"${transformPrompt}"

CRITICAL - COUNT THESE EXACT REQUIREMENTS:
${analysis.headings.h2.length > 0 ? `Sub-headlines (${analysis.headings.h2.length} required):
${analysis.headings.h2.slice(0, 10).map((h, i) => {
  const wordCount = h.text.split(/\s+/).length;
  return `  [${i}] "${h.text.substring(0, 60)}${h.text.length > 60 ? '...' : ''}" (${wordCount} words) → Transform keeping ~${wordCount} words`;
}).join('\n')}${analysis.headings.h2.length > 10 ? `\n  ... and ${analysis.headings.h2.length - 10} more (see article above)` : ''}
` : ''}${analysis.headings.h3.length > 0 ? `Section headings (${analysis.headings.h3.length} required):
${analysis.headings.h3.slice(0, 10).map((h, i) => {
  const wordCount = h.text.split(/\s+/).length;
  return `  [${i}] "${h.text.substring(0, 60)}${h.text.length > 60 ? '...' : ''}" (${wordCount} words) → Transform keeping ~${wordCount} words`;
}).join('\n')}${analysis.headings.h3.length > 10 ? `\n  ... and ${analysis.headings.h3.length - 10} more (see article above)` : ''}
` : ''}Paragraphs (${analysis.paragraphs.length} required - YOUR ARRAY MUST HAVE EXACTLY ${analysis.paragraphs.length} ELEMENTS):
${analysis.paragraphs.slice(0, 10).map((p, i) => {
  const wordCount = p.text.split(/\s+/).length;
  return `  [${i}] ${wordCount} words → Your paragraph[${i}] must be ~${wordCount} words`;
}).join('\n')}${analysis.paragraphs.length > 10 ? `\n  ... paragraphs [10] through [${analysis.paragraphs.length - 1}] follow same pattern (see article above)` : ''}
${analysis.images.length > 0 ? `Image Descriptions (${Math.min(analysis.images.length, 5)} required - GENERATE DALL-E PROMPTS):
  You MUST generate ${Math.min(analysis.images.length, 5)} image description(s) for DALL-E
  Each description should be a detailed prompt for generating an image related to the transformed article
  Example: "A photorealistic image of [subject] in [setting]"
` : ''}
RULES - Follow these EXACTLY:
1. Change ONLY what this instruction explicitly mentions
2. If the instruction says "change X to Y", ONLY change X to Y - nothing else
3. Keep EVERYTHING ELSE identical to the original (same topic, same length, same words)
4. PRESERVE the exact author and date values shown above (copy them verbatim into the JSON)
5. Your "paragraphs" array MUST have EXACTLY ${analysis.paragraphs.length} elements
6. Your "subHeadlines" array MUST have EXACTLY ${analysis.headings.h2.length} elements
7. Your "sectionHeadings" array MUST have EXACTLY ${analysis.headings.h3.length} elements
${analysis.images.length > 0 ? `8. Your "imageDescriptions" array MUST have EXACTLY ${Math.min(analysis.images.length, 5)} elements\n` : ''}${analysis.images.length > 0 ? '9' : '8'}. DO NOT merge paragraphs, skip paragraphs, or change array lengths

WARNING: If you change the topic, make things longer/shorter, change array lengths, or add content not in the instruction, you have FAILED this task.

Output ONLY valid JSON, no code blocks or extra text.`
        }
      ],
      temperature: 0.3
    };

    // Add response_format only if model supports it
    if (supportsJsonMode) {
      requestBody.response_format = { type: "json_object" };
    }

    // NOW calculate max_tokens based on actual request size
    const maxCompletionTokens = calculateMaxCompletionTokens(model, requestBody);
    requestBody.max_tokens = maxCompletionTokens;

    // ============================================================================
    // DEBUG: Log full LLM request
    // ============================================================================
    console.group('🔍 [DEBUG] Full LLM Request');
    debug.log('📤 Model:', model);
    debug.log('📤 Transform Instruction:', transformPrompt);
    debug.log('\n📤 System Prompt:');
    debug.log(requestBody.messages[0].content);
    debug.log('\n📤 User Prompt (Article Analysis):');
    debug.log(requestBody.messages[1].content);
    debug.log('\n📤 Expected Output Structure:');
    debug.log({
      mainHeadline: '1 headline',
      articleDeck: analysis.articleDeck ? '1 article deck' : 'none',
      subHeadlines: `${analysis.headings.h2.length} H2 headings`,
      sectionHeadings: `${analysis.headings.h3.length} H3 headings`,
      paragraphs: `${analysis.paragraphs.length} paragraphs`,
      imageCaptions: `${analysis.captions ? analysis.captions.length : 0} captions`,
      imageDescriptions: `${Math.min(analysis.images.length, 5)} images`
    });
    debug.log('\n📤 Full Article Text Being Sent:');
    debug.log(analysis.fullArticleText);
    debug.log('\n📤 Token Budget (already calculated above):');
    debug.log('   Max completion tokens:', requestBody.max_tokens);
    debug.log('   Temperature:', requestBody.temperature);
    console.groupEnd();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('   ❌ [API] Request failed:', response.status, errorData);
      throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
    }

    debug.log('   📥 [API] Response received');
    const data = await response.json();

    // Check if response was truncated (but continue with partial content)
    const finishReason = data.choices[0].finish_reason;
    const wasTruncated = finishReason === 'length';

    if (wasTruncated) {
      debug.warn('   ⚠️ [API] Response truncated - will use partial content');
      debug.warn('   💡 [API] Some paragraphs at end of article may not be transformed');
    }

    let rawContent = data.choices[0].message.content;
    debug.log('   📄 [API] Raw response length:', rawContent.length);

    // ============================================================================
    // DEBUG: Log full LLM response
    // ============================================================================
    console.group('🔍 [DEBUG] Full LLM Response');
    debug.log('📥 Finish Reason:', finishReason);
    debug.log('📥 Was Truncated:', wasTruncated);
    debug.log('📥 Response Length:', rawContent.length, 'characters');
    debug.log('\n📥 Raw Response Content:');
    debug.log(rawContent);
    console.groupEnd();

    // Extract JSON if wrapped in markdown
    if (rawContent.includes('```json')) {
      debug.log('   🔧 [API] Extracting JSON from markdown code block...');
      rawContent = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (rawContent.includes('```')) {
      debug.log('   🔧 [API] Extracting JSON from code block...');
      rawContent = rawContent.replace(/```\n?/g, '');
    }

    rawContent = rawContent.trim();

    // Parse JSON with automatic repair
    let content;
    try {
      content = JSON.parse(rawContent);
      debug.log('   ✅ [API] Content parsed successfully (no repair needed)');
    } catch (parseError) {
      debug.warn('   ⚠️ [API] JSON parse failed, attempting repair...');
      console.error('   📄 [API] Parse error:', parseError.message);

      try {
        // Attempt to repair common JSON issues
        const repairedContent = repairJSON(rawContent);
        content = JSON.parse(repairedContent);
        debug.log('   ✅ [API] Successfully repaired and parsed JSON');
      } catch (repairError) {
        console.error('   ❌ [API] Could not repair JSON:', repairError.message);
        console.error('   📄 [API] Raw content (first 500 chars):', rawContent.substring(0, 500));
        console.error('   📄 [API] Raw content (last 500 chars):', rawContent.substring(Math.max(0, rawContent.length - 500)));
        throw new Error(`Failed to parse JSON response: ${parseError.message}. Check console for raw content.`);
      }
    }

    // Log what was generated (especially important for partial transformations)
    const paragraphCount = (content.paragraphs || []).length;
    const expectedParagraphs = analysis.paragraphs.length;
    const subHeadlineCount = (content.subHeadlines || []).length;
    const expectedSubHeadlines = analysis.headings.h2.length;
    const sectionHeadingCount = (content.sectionHeadings || []).length;
    const expectedSectionHeadings = analysis.headings.h3.length;

    debug.log('   📊 [API] Generated content:');
    debug.log('      Headline:', content.mainHeadline ? '✓' : '✗');
    debug.log('      Sub-headlines:', subHeadlineCount, 'of', expectedSubHeadlines);
    debug.log('      Section headings:', sectionHeadingCount, 'of', expectedSectionHeadings);
    debug.log('      Paragraphs:', paragraphCount, 'of', expectedParagraphs);
    debug.log('      Image descriptions:', (content.imageDescriptions || []).length);

    // Validate structure matches (unless response was truncated)
    const structureValid =
      subHeadlineCount === expectedSubHeadlines &&
      sectionHeadingCount === expectedSectionHeadings &&
      paragraphCount === expectedParagraphs;

    if (!structureValid && !wasTruncated) {
      debug.warn('   ⚠️ [Validation] Structure mismatch detected - continuing anyway');
      debug.warn('      Expected structure:');
      debug.warn('         Sub-headlines:', expectedSubHeadlines);
      debug.warn('         Section headings:', expectedSectionHeadings);
      debug.warn('         Paragraphs:', expectedParagraphs);
      debug.warn('      Got:');
      debug.warn('         Sub-headlines:', subHeadlineCount, subHeadlineCount === expectedSubHeadlines ? '✓' : '✗');
      debug.warn('         Section headings:', sectionHeadingCount, sectionHeadingCount === expectedSectionHeadings ? '✓' : '✗');
      debug.warn('         Paragraphs:', paragraphCount, paragraphCount === expectedParagraphs ? '✓' : '✗');
      debug.warn('      💡 Transformation will proceed with the content that was generated');
      debug.warn('      💡 Missing elements will remain unchanged from the original article');
    }

    if (wasTruncated && paragraphCount < expectedParagraphs) {
      debug.warn('   ⚠️ [API] Partial transformation: Only', paragraphCount, 'of', expectedParagraphs, 'paragraphs generated');
      debug.warn('   💡 [API] Remaining', (expectedParagraphs - paragraphCount), 'paragraphs will remain unchanged');
    }

    // ============================================================================
    // DEBUG: Log parsed content structure
    // ============================================================================
    console.group('🔍 [DEBUG] Parsed Content Structure');
    debug.log('📋 Main Headline:');
    debug.log('   Generated:', content.mainHeadline);

    debug.log('\n📋 Sub-Headlines (H2):');
    debug.log('   Count:', (content.subHeadlines || []).length, 'of', analysis.headings.h2.length, 'expected');
    (content.subHeadlines || []).forEach((heading, i) => {
      debug.log(`   [${i}]:`, heading);
    });

    debug.log('\n📋 Section Headings (H3):');
    debug.log('   Count:', (content.sectionHeadings || []).length, 'of', analysis.headings.h3.length, 'expected');
    (content.sectionHeadings || []).forEach((heading, i) => {
      debug.log(`   [${i}]:`, heading);
    });

    debug.log('\n📋 Paragraphs:');
    debug.log('   Count:', paragraphCount, 'of', expectedParagraphs, 'expected');
    (content.paragraphs || []).forEach((paragraph, i) => {
      const preview = paragraph.length > 100 ? paragraph.substring(0, 100) + '...' : paragraph;
      debug.log(`   [${i}]:`, preview);
    });

    debug.log('\n📋 Image Descriptions:');
    debug.log('   Count:', (content.imageDescriptions || []).length);
    (content.imageDescriptions || []).forEach((desc, i) => {
      debug.log(`   [${i}]:`, desc);
    });

    console.groupEnd();

    // ============================================================================
    // DEBUG: Original vs Transformed Comparison
    // ============================================================================
    console.group('🔍 [DEBUG] Original vs Transformed Comparison');

    debug.log('\n📊 HEADLINE COMPARISON:');
    const originalH1Text = analysis.headings.h1[0]?.text || '(none)';
    debug.log('   Original:', originalH1Text);
    debug.log('   Transformed:', content.mainHeadline);
    debug.log('   Changed:', originalH1Text !== content.mainHeadline ? '✓' : '✗');

    debug.log('\n📊 ARTICLE DECK COMPARISON:');
    const originalDeck = analysis.articleDeck?.text || '(none)';
    const transformedDeck = content.articleDeck || '(none)';
    debug.log('   Original:', originalDeck);
    debug.log('   Transformed:', transformedDeck);
    debug.log('   Changed:', originalDeck !== transformedDeck ? '✓' : '✗');

    debug.log('\n📊 SUB-HEADLINES (H2) COMPARISON:');
    const maxH2 = Math.max(analysis.headings.h2.length, (content.subHeadlines || []).length);
    for (let i = 0; i < maxH2; i++) {
      const original = analysis.headings.h2[i]?.text || '(missing)';
      const transformed = (content.subHeadlines || [])[i] || '(missing)';
      const changed = original !== transformed;
      debug.log(`   [${i}] ${changed ? '✓ CHANGED' : '✗ SAME'}:`);
      debug.log(`       Original:    ${original}`);
      debug.log(`       Transformed: ${transformed}`);
    }

    debug.log('\n📊 SECTION HEADINGS (H3) COMPARISON:');
    const maxH3 = Math.max(analysis.headings.h3.length, (content.sectionHeadings || []).length);
    for (let i = 0; i < maxH3; i++) {
      const original = analysis.headings.h3[i]?.text || '(missing)';
      const transformed = (content.sectionHeadings || [])[i] || '(missing)';
      const changed = original !== transformed;
      debug.log(`   [${i}] ${changed ? '✓ CHANGED' : '✗ SAME'}:`);
      debug.log(`       Original:    ${original}`);
      debug.log(`       Transformed: ${transformed}`);
    }

    debug.log('\n📊 PARAGRAPHS COMPARISON:');
    const maxParagraphs = Math.max(analysis.paragraphs.length, paragraphCount);
    for (let i = 0; i < maxParagraphs; i++) {
      const original = analysis.paragraphs[i]?.text || '(missing)';
      const transformed = (content.paragraphs || [])[i] || '(missing)';
      const changed = original !== transformed;

      // Truncate for readability
      const originalPreview = original.length > 150 ? original.substring(0, 150) + '...' : original;
      const transformedPreview = transformed.length > 150 ? transformed.substring(0, 150) + '...' : transformed;

      debug.log(`   [${i}] ${changed ? '✓ CHANGED' : '✗ SAME'}:`);
      debug.log(`       Original:    ${originalPreview}`);
      debug.log(`       Transformed: ${transformedPreview}`);

      // Show word count comparison
      const originalWords = original.split(/\s+/).length;
      const transformedWords = transformed.split(/\s+/).length;
      const wordDiff = transformedWords - originalWords;
      debug.log(`       Word count: ${originalWords} → ${transformedWords} (${wordDiff >= 0 ? '+' : ''}${wordDiff})`);
    }

    debug.log('\n📊 SUMMARY:');
    const changedH2 = analysis.headings.h2.filter((h, i) => h.text !== (content.subHeadlines || [])[i]).length;
    const changedH3 = analysis.headings.h3.filter((h, i) => h.text !== (content.sectionHeadings || [])[i]).length;
    const changedP = analysis.paragraphs.filter((p, i) => p.text !== (content.paragraphs || [])[i]).length;
    debug.log(`   Headline changed: ${originalH1Text !== content.mainHeadline ? 'YES' : 'NO'}`);
    debug.log(`   Article deck changed: ${originalDeck !== transformedDeck ? 'YES' : 'NO'}`);
    debug.log(`   Sub-headlines changed: ${changedH2} of ${analysis.headings.h2.length}`);
    debug.log(`   Section headings changed: ${changedH3} of ${analysis.headings.h3.length}`);
    debug.log(`   Paragraphs changed: ${changedP} of ${analysis.paragraphs.length}`);

    console.groupEnd();

    // Return formatted content
    return {
      success: true,
      partial: wasTruncated && paragraphCount < expectedParagraphs,
      content: {
        mainHeadline: content.mainHeadline || 'Transformed Article',
        articleDeck: content.articleDeck || null,
        subHeadlines: content.subHeadlines || [],
        sectionHeadings: content.sectionHeadings || [],
        paragraphs: content.paragraphs || [],
        imageCaptions: content.imageCaptions || [],
        imageDescriptions: content.imageDescriptions || [],
        author: content.author || 'Staff Writer',
        date: content.date || new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        topic: transformPrompt
      }
    };

  } catch (error) {
    console.error('   ❌ [API] Error in context-aware transformation:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate content using OpenAI API (Replace Mode)
 */
async function generateContent(apiKey, topic, analysis, model) {
  try {
    // Limit content to reasonable amounts to avoid max_tokens issues
    // Note: Paragraphs are already limited by word count truncation in content extraction
    const contentStructure = {
      h1Count: Math.min(analysis.headings.h1.length, 1) || 1,
      h2Count: Math.min(analysis.headings.h2.length, 5) || 3,
      h3Count: Math.min(analysis.headings.h3.length, 8) || 5,
      paragraphCount: analysis.paragraphs.length,  // Use actual count - already limited by word count
      imageCount: Math.min(analysis.images.length, 5) || 3
    };

    debug.log('   📤 [API] Sending request to OpenAI...');
    debug.log('   📊 [API] Content structure:', contentStructure);

    // Check if model supports JSON mode
    const supportsJsonMode = model.includes('gpt-4-turbo') ||
                            model.includes('gpt-3.5-turbo-1106') ||
                            model.includes('gpt-4-1106') ||
                            model.includes('gpt-4o') ||
                            model === 'gpt-3.5-turbo'; // Latest version supports it

    if (supportsJsonMode) {
      debug.log('   🔧 [API] Using JSON mode (response_format)');
    } else {
      debug.log('   ⚠️ [API] Model does not support JSON mode, relying on prompts');
    }

    // Extract original author and date for preservation
    const originalAuthor = analysis.authors && analysis.authors.length > 0
      ? analysis.authors[0].text
      : "Unknown";
    const originalDate = analysis.dates && analysis.dates.length > 0
      ? analysis.dates[0].text
      : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Build request body WITHOUT max_tokens first (so we can measure its size)
    const requestBody = {
      model: model,
      messages: [
        {
          role: 'system',
          content: `You are a content transformation expert. You MUST respond with ONLY a valid JSON object, nothing else.

Your task is to create a new article on a different topic while PRESERVING:
- The exact same structure (same number of headings, paragraphs, etc.) as the original
- The exact same LENGTH for each element (headlines, subheadlines, paragraphs must be similar length to originals)
- The same narrative flow and writing style
- The same tone and journalistic approach
- Similar types of details (if original has statistics, include statistics; if it has quotes, include quotes)

IMPORTANT: Match the LENGTH of each element - if a subheadline is 15 words, keep it ~15 words; if a paragraph is 3 sentences, keep it ~3 sentences.

CRITICAL METADATA PRESERVATION:
- The "author" field MUST be copied EXACTLY from the original article - do NOT transform or change it
- The "date" field MUST be copied EXACTLY from the original article - do NOT transform or change it
- These fields are metadata that should always remain identical to the source

Do not include markdown code blocks, explanations, or any text before or after the JSON.

IMPORTANT CAPTION HANDLING:
- If the article contains lines starting with "IMAGE CAPTION:", you MUST extract those into the "imageCaptions" array
- Each "IMAGE CAPTION:" line represents one caption that needs transformation
- Image captions should match the length and style of the original captions
- CRITICAL: Lines starting with "IMAGE CAPTION:" must ONLY appear in the "imageCaptions" array
- CRITICAL: Do NOT include "IMAGE CAPTION:" lines in the "paragraphs" array
- CRITICAL: Remove the "IMAGE CAPTION:" prefix when adding to the "imageCaptions" array (only include the caption text itself)
- If there are NO image captions in the article, you can OMIT the "imageCaptions" field entirely or set it to an empty array []

Return this EXACT JSON structure:
{
  "mainHeadline": "string",
  "articleDeck": "string or null",
  "subHeadlines": ["string", "string"],
  "sectionHeadings": ["string", "string"],
  "paragraphs": ["string", "string"],
  "imageCaptions": ["string"] (REQUIRED if "IMAGE CAPTION:" appears in article - one entry per caption),
  "imageAlts": ["string"] (REQUIRED if "IMAGE ALT:" appears in article - one entry per alt text),
  "imageDescriptions": ["string", "string"],
  "author": "string",
  "date": "string"
}`
        },
        {
          role: 'user',
          content: `ORIGINAL ARTICLE (for style/structure reference):
${analysis.fullArticleText}

PRESERVE THESE EXACT VALUES (do NOT transform):
- Original author: "${originalAuthor}"
- Original date: "${originalDate}"

NEW TOPIC:
${topic}

Create a NEW article about "${topic}" that:
- Matches the EXACT structure of the original:
  - ${analysis.articleDeck ? '1 article deck/subheader' : 'no article deck'}
  - ${contentStructure.h2Count} sub-headlines (H2)
  - ${contentStructure.h3Count} section headings (H3)
  - ${contentStructure.paragraphCount} paragraphs
  - ${analysis.captions?.length || 0} image captions
  - ${contentStructure.imageCount} image descriptions
- Matches the EXACT LENGTH of each corresponding element in the original (count words/sentences in each original element and match them)
- Uses the SAME writing style, tone, and narrative approach as the original
- Includes similar types of details (statistics, quotes, examples) as the original
- PRESERVES the exact author and date values shown above (copy them verbatim into the JSON)

CRITICAL: Each subHeadline, sectionHeading, and paragraph MUST be approximately the same length as its corresponding original element.

Output ONLY valid JSON, no code blocks or extra text.`
        }
      ],
      temperature: 0.8
    };

    // Add response_format only if model supports it
    if (supportsJsonMode) {
      requestBody.response_format = { type: "json_object" };
    }

    // NOW calculate max_tokens based on actual request size
    const maxCompletionTokens = calculateMaxCompletionTokens(model, requestBody);
    requestBody.max_tokens = maxCompletionTokens;

    // ============================================================================
    // DEBUG: Log full LLM request (Replace Mode)
    // ============================================================================
    console.group('🔍 [DEBUG] Full LLM Request (Replace Mode)');
    debug.log('📤 Model:', model);
    debug.log('📤 Topic:', topic);
    debug.log('\n📤 System Prompt:');
    debug.log(requestBody.messages[0].content);
    debug.log('\n📤 User Prompt (Article Analysis):');
    debug.log(requestBody.messages[1].content);
    debug.log('\n📤 Expected Output Structure:');
    debug.log({
      mainHeadline: '1 headline',
      articleDeck: analysis.articleDeck ? '1 article deck' : 'none',
      subHeadlines: `${contentStructure.h2Count} H2 headings`,
      sectionHeadings: `${contentStructure.h3Count} H3 headings`,
      paragraphs: `${contentStructure.paragraphCount} paragraphs`,
      imageCaptions: `${analysis.captions?.length || 0} captions`,
      imageDescriptions: `${contentStructure.imageCount} images`
    });
    debug.log('\n📤 Full Article Text Being Sent:');
    debug.log(analysis.fullArticleText);
    debug.log('\n📤 Token Budget:');
    debug.log('   Max completion tokens:', requestBody.max_tokens);
    debug.log('   Temperature:', requestBody.temperature);
    debug.log('   JSON mode enabled:', !!requestBody.response_format);
    console.groupEnd();

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('   ❌ [API] Request failed:', response.status, errorData);
      throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
    }

    debug.log('   📥 [API] Response received');
    const data = await response.json();
    debug.log('   🔄 [API] Parsing content...');

    // Check if response was truncated due to max_tokens
    const finishReason = data.choices[0].finish_reason;
    if (finishReason === 'length') {
      debug.warn('   ⚠️ [API] Response truncated due to max_tokens limit!');
      debug.warn('   💡 [API] Retrying with increased max_tokens...');

      // Retry with higher max_tokens
      requestBody.max_tokens = 3000;
      const retryResponse = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (retryResponse.ok) {
        const retryData = await retryResponse.json();
        if (retryData.choices[0].finish_reason === 'length') {
          console.error('   ❌ [API] Response still truncated even with 3000 tokens');
          throw new Error('Response too long - reduce the number of paragraphs/headings required');
        }
        data.choices[0] = retryData.choices[0];
        debug.log('   ✅ [API] Retry successful with increased tokens');
      }
    }

    let rawContent = data.choices[0].message.content;
    debug.log('   📄 [API] Raw response length:', rawContent.length);
    debug.log('   🏁 [API] Finish reason:', finishReason);

    // Try to extract JSON if wrapped in markdown code blocks
    if (rawContent.includes('```json')) {
      debug.log('   🔧 [API] Extracting JSON from markdown code block...');
      rawContent = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (rawContent.includes('```')) {
      debug.log('   🔧 [API] Extracting JSON from code block...');
      rawContent = rawContent.replace(/```\n?/g, '');
    }

    // Remove any leading/trailing whitespace
    rawContent = rawContent.trim();

    // Try to parse JSON with automatic repair
    let content;
    try {
      content = JSON.parse(rawContent);
      debug.log('   ✅ [API] Content parsed successfully (no repair needed)');
    } catch (parseError) {
      debug.warn('   ⚠️ [API] JSON parse failed, attempting repair...');
      console.error('   📄 [API] Parse error:', parseError.message);

      try {
        // Attempt to repair common JSON issues
        const repairedContent = repairJSON(rawContent);
        content = JSON.parse(repairedContent);
        debug.log('   ✅ [API] Successfully repaired and parsed JSON');
      } catch (repairError) {
        console.error('   ❌ [API] Could not repair JSON:', repairError.message);
        console.error('   📄 [API] Raw content (first 500 chars):', rawContent.substring(0, 500));
        console.error('   📄 [API] Raw content (last 500 chars):', rawContent.substring(Math.max(0, rawContent.length - 500)));
        console.error('   💡 [API] Finish reason was:', finishReason);

        if (finishReason === 'length') {
          throw new Error('Response was truncated (hit max_tokens). Try reducing content requirements or the page has too many elements.');
        }

        throw new Error(`Failed to parse JSON response: ${parseError.message}. Check console for raw content.`);
      }
    }

    // Ensure all required fields exist
    return {
      success: true,
      content: {
        mainHeadline: content.mainHeadline || topic,
        articleDeck: content.articleDeck || null,
        subHeadlines: content.subHeadlines || [],
        sectionHeadings: content.sectionHeadings || [],
        paragraphs: content.paragraphs || [],
        imageCaptions: content.imageCaptions || [],
        imageDescriptions: content.imageDescriptions || [],
        author: content.author || 'Staff Writer',
        date: content.date || new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        }),
        topic
      }
    };

  } catch (error) {
    console.error('   ❌ [API] Error generating content:', error);
    console.error('   📍 [API] Error details:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Generate a realistic URL based on topic and current page
 * @param {string} topic - The topic
 * @param {string} headline - The main headline
 * @param {string} currentUrl - The current page URL
 * @returns {string} - Generated URL
 */
function generateFakeUrl(topic, headline, currentUrl) {
  try {
    const url = new URL(currentUrl);

    // Generate URL slug from headline or topic
    const slugSource = headline || topic;
    const newSlug = slugSource
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove special chars
      .replace(/\s+/g, '-') // Spaces to hyphens
      .replace(/-+/g, '-') // Multiple hyphens to single
      .substring(0, 80); // Limit length

    // Split path into segments and remove empty strings
    const pathSegments = url.pathname.split('/').filter(s => s);

    // Replace only the last segment (the slug) with our new slug
    if (pathSegments.length > 0) {
      pathSegments[pathSegments.length - 1] = newSlug;
    } else {
      // If no path segments, just add the slug
      pathSegments.push(newSlug);
    }

    // Rebuild the pathname with new slug
    url.pathname = '/' + pathSegments.join('/');

    const newUrl = url.toString();

    debug.log('🔗 [URL] Generated URL:');
    debug.log('   Original:', currentUrl);
    debug.log('   New:', newUrl);
    debug.log('   Slug:', newSlug);

    return newUrl;
  } catch (error) {
    console.error('❌ [URL] Error generating URL:', error);
    return currentUrl; // Return original if error
  }
}

/**
 * Generate images using OpenAI DALL-E API
 */
async function generateImages(apiKey, prompts, model) {
  const images = [];

  // Check user setting for local storage
  const { storeImagesLocally } = await chrome.storage.sync.get('storeImagesLocally');
  const shouldStoreLocally = storeImagesLocally !== false; // Default true

  debug.log(`🖼️ [Image] Storage mode: ${shouldStoreLocally ? 'Local IndexedDB (persistent)' : 'Temporary DALL-E URLs (~1hr)'}`);

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    try {
      const requestBody = {
        model: model,
        prompt: prompt,
        n: 1,
        size: '1024x1024'
      };

      // Only add quality parameter for dall-e-3
      if (model === 'dall-e-3') {
        requestBody.quality = 'standard';
      }

      // ============================================================================
      // DEBUG: Log FULL DALL-E request (not truncated)
      // ============================================================================
      console.group(`🔍 [DEBUG] DALL-E Request ${i + 1}/${prompts.length}`);
      debug.log('📤 Model:', model);
      debug.log('📤 Size:', requestBody.size);
      if (requestBody.quality) {
        debug.log('📤 Quality:', requestBody.quality);
      }
      debug.log('\n📤 FULL IMAGE PROMPT:');
      debug.log(prompt);
      debug.log('\n📤 Prompt Length:', prompt.length, 'characters');
      console.groupEnd();

      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json();

        // Enhanced error logging
        console.group(`❌ [DEBUG] DALL-E Error ${i + 1}/${prompts.length}`);
        console.error('📥 Status:', response.status);
        console.error('📥 Error message:', errorData.error?.message);
        console.error('📥 Failed prompt:', prompt);
        console.error('📥 Full error data:', errorData);
        console.groupEnd();

        images.push({
          success: false,
          error: errorData.error?.message || 'Failed to generate image',
          prompt,
          storedLocally: false
        });
        continue;
      }

      const data = await response.json();
      const dalleUrl = data.data[0].url;

      // Enhanced success logging
      console.group(`✅ [DEBUG] DALL-E Response ${i + 1}/${prompts.length}`);
      debug.log('📥 Image URL received');
      debug.log('📥 Original prompt:', prompt);
      console.groupEnd();

      // Conditionally download and store in IndexedDB
      if (shouldStoreLocally) {
        try {
          debug.log(`💾 [Image ${i + 1}] Downloading image for local storage...`);

          // Fetch the image blob from DALL-E URL
          const imageResponse = await fetch(dalleUrl);
          if (!imageResponse.ok) {
            throw new Error(`Failed to fetch image: ${imageResponse.status}`);
          }

          const imageBlob = await imageResponse.blob();
          debug.log(`   ✓ Downloaded ${(imageBlob.size / 1024).toFixed(1)} KB`);

          // Save to IndexedDB
          const imageId = await saveImageBlob(imageBlob);
          debug.log(`   ✓ Saved to IndexedDB: ${imageId}`);

          images.push({
            success: true,
            imageId: imageId,
            prompt: prompt,
            storedLocally: true
          });
        } catch (storageError) {
          console.error(`❌ [Image ${i + 1}] Failed to store locally:`, storageError);
          debug.warn(`   ⚠️ Falling back to temporary DALL-E URL`);

          // Fallback to temporary URL if storage fails
          images.push({
            success: true,
            url: dalleUrl,
            prompt: prompt,
            storedLocally: false
          });
        }
      } else {
        // Use temporary DALL-E URL (current behavior)
        images.push({
          success: true,
          url: dalleUrl,
          prompt: prompt,
          storedLocally: false
        });
      }

      // Add delay between image generations to avoid rate limiting
      if (i < prompts.length - 1) {
        debug.log(`   ⏳ [Image] Waiting 1s before next image...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      console.error(`   ❌ [Image ${i + 1}/${prompts.length}] Error:`, error.message);
      images.push({
        success: false,
        error: error.message,
        prompt,
        storedLocally: false
      });
    }
  }

  return images;
}

/**
 * ============================================================================
 * CACHE MANAGEMENT FUNCTIONS
 * ============================================================================
 */

/**
 * Save a transformation to the cache (NEW: stores data + images, not full HTML)
 */
async function saveTransformationToCache(originalUrl, generatedUrl, tabId, metadata, content, images) {
  try {
    debug.log('   💾 [Cache] Saving transformation data...');

    // Store image data (URL or IndexedDB ID depending on storage mode)
    debug.log('   🖼️ [Cache] Storing image data...');
    const cachedImages = images.map((img, index) => ({
      url: img.success && !img.storedLocally ? img.url : null,  // DALL-E URL (temporary)
      imageId: img.success && img.storedLocally ? img.imageId : null,  // IndexedDB ID (persistent)
      prompt: img.prompt,
      index: index,
      storedLocally: img.storedLocally || false,
      error: img.error || null
    }));

    const localCount = cachedImages.filter(img => img.imageId).length;
    const urlCount = cachedImages.filter(img => img.url).length;
    debug.log(`   ✅ [Cache] Stored ${localCount} local images, ${urlCount} DALL-E URLs`);

    // 🔍 DEBUG - Log metadata being saved
    debug.log('🔍 DEBUG - Metadata being saved to cache:');
    debug.log('   mode:', metadata.mode);
    debug.log('   topic:', metadata.topic);
    debug.log('   selectedImageSelectors:', metadata.selectedImageSelectors);

    // Generate unique ID
    const id = 'transform_' + Date.now() + '_' + Math.random().toString(36).substring(7);

    // Determine storage mode based on first successful image
    const storedLocally = images.length > 0 && images.some(img => img.success && img.storedLocally);

    // Create cache entry with data instead of full HTML
    const cacheEntry = {
      id,
      originalUrl,
      generatedUrl: generatedUrl || null,
      timestamp: metadata.timestamp,
      storedLocally: storedLocally,  // Track storage type for auto-cleanup logic
      metadata: {
        mode: metadata.mode,
        topic: metadata.topic || null,
        transformPrompt: metadata.transformPrompt || null,
        selectedImageSelectors: metadata.selectedImageSelectors || null,  // ⭐ Save image selectors for auto-intercept
        date: new Date().toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
      },
      // Store content data instead of HTML
      content: {
        mainHeadline: content.mainHeadline,
        articleDeck: content.articleDeck,
        subHeadlines: content.subHeadlines,
        sectionHeadings: content.sectionHeadings,
        paragraphs: content.paragraphs,
        imageCaptions: content.imageCaptions || [],  // Include captions in cache
        imageDescriptions: content.imageDescriptions || [],
        author: content.author,
        date: content.date,
        topic: content.topic
      },
      // Store image data (URLs or IndexedDB IDs)
      images: cachedImages
    };

    // Get existing cache
    const storage = await chrome.storage.local.get(['transformationCache', 'generatedToOriginalMap', 'cachedEntries']);
    const cache = storage.transformationCache || {};
    const generatedMap = storage.generatedToOriginalMap || {};
    const cachedEntries = storage.cachedEntries || [];

    // Store under original URL (both exact and normalized)
    cache[originalUrl] = cacheEntry;
    const normalizedOriginal = normalizeUrl(originalUrl);
    if (normalizedOriginal !== originalUrl) {
      cache[normalizedOriginal] = cacheEntry;
      debug.log('   📝 [Cache] Also stored under normalized original URL:', normalizedOriginal);
    }

    // If generated URL exists, store mapping (both exact and normalized)
    if (generatedUrl) {
      generatedMap[generatedUrl] = originalUrl;
      debug.log('   🔗 [Cache] Mapped generated URL:', generatedUrl);

      // 🔍 DEBUG LOGGING
      debug.log('🔍 DEBUG - Saving to cache:');
      debug.log('  Original URL:', originalUrl);
      debug.log('  Generated URL:', generatedUrl);
      debug.log('  generatedMap[generatedUrl] =', originalUrl);

      // Also store normalized version for fuzzy matching
      const normalizedGenerated = normalizeUrl(generatedUrl);
      if (normalizedGenerated !== generatedUrl) {
        generatedMap[normalizedGenerated] = originalUrl;
        debug.log('   🔗 [Cache] Also mapped normalized generated URL:', normalizedGenerated);
        debug.log('  Normalized generated URL:', normalizedGenerated);
      }
    }

    // Add to cached entries list if not already there
    if (!cachedEntries.includes(originalUrl)) {
      cachedEntries.push(originalUrl);
    }

    // Save to storage
    await chrome.storage.local.set({
      transformationCache: cache,
      generatedToOriginalMap: generatedMap,
      cachedEntries
    });

    debug.log('   ✅ [Cache] Saved transformation:', id);
    debug.log('      Original URL:', originalUrl);
    debug.log('      Generated URL:', generatedUrl || 'None');
    debug.log('      Storage mode:', storedLocally ? 'Local (persistent)' : 'Temporary URLs');
    debug.log('      Content items:', content.paragraphs.length, 'paragraphs');
    debug.log('      Images:', localCount, 'local,', urlCount, 'temporary');

  } catch (error) {
    console.error('   ❌ [Cache] Error saving transformation:', error);
  }
}


// capturePageHTML function removed - no longer needed with new data storage approach

/**
 * Clean expired cache entries (older than 1 hour)
 * ONLY cleans entries using temporary DALL-E URLs
 * Entries with local IndexedDB storage never expire
 */
async function cleanExpiredCache() {
  try {
    const storage = await chrome.storage.local.get(['transformationCache', 'generatedToOriginalMap', 'cachedEntries']);
    const cache = storage.transformationCache || {};
    const generatedMap = storage.generatedToOriginalMap || {};
    let cachedEntries = storage.cachedEntries || [];

    const oneHourAgo = Date.now() - 3600000; // 1 hour in milliseconds
    let deletedCount = 0;

    // Filter entries and remove expired ones
    const validEntries = cachedEntries.filter(url => {
      const entry = cache[url];

      // ⭐ NEW: Only auto-clean if using temporary DALL-E URLs
      // If images are stored locally (IndexedDB), they never expire - keep cache forever
      if (entry && entry.storedLocally === false && entry.timestamp < oneHourAgo) {
        debug.log(`   🗑️ [Cache] Removing expired entry (temporary DALL-E URLs expired): ${url}`);

        // No IndexedDB cleanup needed (no images were stored locally)

        // Remove from generated URL map if exists
        if (entry.generatedUrl) {
          delete generatedMap[entry.generatedUrl];
        }

        // Remove from cache
        delete cache[url];
        deletedCount++;
        return false;
      }

      // ⭐ Keep entries that:
      // 1. Use local storage (storedLocally = true) - never expire
      // 2. Are less than 1 hour old (not expired yet)
      // 3. Don't have storedLocally flag (backward compatibility - keep for now)
      return true;
    });

    if (deletedCount > 0) {
      // Save updated cache
      await chrome.storage.local.set({
        transformationCache: cache,
        generatedToOriginalMap: generatedMap,
        cachedEntries: validEntries
      });

      debug.log(`   ✅ [Cache] Cleaned ${deletedCount} expired entries (temporary DALL-E URLs only)`);
    } else {
      debug.log(`   ✅ [Cache] No expired entries to clean`);
    }

  } catch (error) {
    console.error('   ❌ [Cache] Error cleaning expired entries:', error);
  }
}

/**
 * Get a transformation from cache by URL (checks both original and generated)
 */
async function getTransformationByUrl(url) {
  // Clean expired entries first
  await cleanExpiredCache();

  const storage = await chrome.storage.local.get(['transformationCache', 'generatedToOriginalMap']);
  const cache = storage.transformationCache || {};
  const generatedMap = storage.generatedToOriginalMap || {};

  // Check if URL is an original URL
  if (cache[url]) {
    return cache[url];
  }

  // Check if URL is a generated URL
  if (generatedMap[url]) {
    const originalUrl = generatedMap[url];
    return cache[originalUrl];
  }

  return null;
}

/**
 * Delete a transformation from cache by ID
 */
async function deleteTransformationById(id) {
  try {
    const storage = await chrome.storage.local.get(['transformationCache', 'generatedToOriginalMap', 'cachedEntries']);
    const cache = storage.transformationCache || {};
    const generatedMap = storage.generatedToOriginalMap || {};
    let cachedEntries = storage.cachedEntries || [];

    // Find the entry with this ID
    let entryToDelete = null;
    let originalUrl = null;

    for (const [url, entry] of Object.entries(cache)) {
      if (entry.id === id) {
        entryToDelete = entry;
        originalUrl = url;
        break;
      }
    }

    if (!entryToDelete) {
      debug.warn('⚠️ [Cache] Entry not found:', id);
      return false;
    }

    // ⭐ DELETE IndexedDB images if they exist
    if (entryToDelete.images && entryToDelete.storedLocally) {
      const imageIds = entryToDelete.images
        .filter(img => img.imageId)
        .map(img => img.imageId);

      if (imageIds.length > 0) {
        debug.log(`🗑️ [Cache] Deleting ${imageIds.length} IndexedDB images`);
        await deleteImages(imageIds);
      }
    }

    // Remove from cache
    delete cache[originalUrl];

    // Remove generated URL mapping if exists
    if (entryToDelete.generatedUrl) {
      delete generatedMap[entryToDelete.generatedUrl];
    }

    // Remove from cached entries list
    cachedEntries = cachedEntries.filter(url => url !== originalUrl);

    // Save back to storage
    await chrome.storage.local.set({
      transformationCache: cache,
      generatedToOriginalMap: generatedMap,
      cachedEntries
    });

    debug.log('✅ [Cache] Deleted transformation:', id);
    return true;

  } catch (error) {
    console.error('❌ [Cache] Error deleting transformation:', error);
    return false;
  }
}

/**
 * Delete cache entry by URL (for Reset Page functionality)
 */
async function deleteCacheEntryByUrl(url) {
  try {
    debug.log('🗑️ [Cache] Deleting cache entry for URL:', url);

    const storage = await chrome.storage.local.get(['transformationCache', 'generatedToOriginalMap', 'cachedEntries']);
    const cache = storage.transformationCache || {};
    const generatedMap = storage.generatedToOriginalMap || {};
    let cachedEntries = storage.cachedEntries || [];

    // Check if this is an original URL or generated URL
    let originalUrl = null;
    let entryToDelete = null;

    // First check if it's a direct match (original URL)
    if (cache[url]) {
      originalUrl = url;
      entryToDelete = cache[url];
    }
    // Otherwise check if it's a generated URL
    else if (generatedMap[url]) {
      originalUrl = generatedMap[url];
      entryToDelete = cache[originalUrl];
    }

    if (!entryToDelete) {
      debug.log('⏭️ [Cache] No cache entry found for URL:', url);
      return { success: true, found: false };
    }

    // ⭐ DELETE IndexedDB images if they exist
    if (entryToDelete.images && entryToDelete.storedLocally) {
      const imageIds = entryToDelete.images
        .filter(img => img.imageId)
        .map(img => img.imageId);

      if (imageIds.length > 0) {
        debug.log(`🗑️ [Cache] Deleting ${imageIds.length} IndexedDB images`);
        await deleteImages(imageIds);
      }
    }

    // Remove from cache
    delete cache[originalUrl];

    // Remove generated URL mapping if exists
    if (entryToDelete.generatedUrl) {
      delete generatedMap[entryToDelete.generatedUrl];
      debug.log('   🗑️ [Cache] Removed generated URL mapping:', entryToDelete.generatedUrl);
    }

    // Remove from cached entries list
    cachedEntries = cachedEntries.filter(entryUrl => entryUrl !== originalUrl);

    // Save back to storage
    await chrome.storage.local.set({
      transformationCache: cache,
      generatedToOriginalMap: generatedMap,
      cachedEntries
    });

    debug.log('✅ [Cache] Deleted cache entry for:', originalUrl);
    return { success: true, found: true };

  } catch (error) {
    console.error('❌ [Cache] Error deleting cache entry:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Clear all cached transformations
 */
async function clearAllCache() {
  try {
    // Clear IndexedDB images FIRST
    debug.log('🗑️ [Cache] Clearing all IndexedDB images...');
    await clearAllImages();
    debug.log('✅ [Cache] IndexedDB images cleared');

    // Then clear chrome.storage cache
    await chrome.storage.local.set({
      transformationCache: {},
      generatedToOriginalMap: {},
      cachedEntries: []
    });

    debug.log('✅ [Cache] All cache cleared (including IndexedDB images)');
    return true;

  } catch (error) {
    console.error('❌ [Cache] Error clearing cache:', error);
    return false;
  }
}

/**
 * Get cache statistics
 */
async function getCacheStats() {
  const storage = await chrome.storage.local.get(['transformationCache']);
  const cache = storage.transformationCache || {};

  const count = Object.keys(cache).length;

  // Calculate storage size
  const jsonString = JSON.stringify(cache);
  const bytes = new Blob([jsonString]).size;

  let sizeString;
  if (bytes < 1024) {
    sizeString = bytes + ' B';
  } else if (bytes < 1024 * 1024) {
    sizeString = (bytes / 1024).toFixed(1) + ' KB';
  } else {
    sizeString = (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  return {
    count,
    bytes,
    sizeString
  };
}

/**
 * Search and filter cached transformations
 */
async function searchCache(query, modeFilter) {
  // Clean expired entries first
  await cleanExpiredCache();

  const storage = await chrome.storage.local.get(['transformationCache', 'cachedEntries']);
  const cache = storage.transformationCache || {};
  const cachedEntries = storage.cachedEntries || [];

  const lowerQuery = (query || '').toLowerCase();

  const results = cachedEntries
    .map(url => cache[url])
    .filter(entry => {
      if (!entry) return false;

      // Filter by mode
      if (modeFilter && modeFilter !== 'all' && entry.metadata.mode !== modeFilter) {
        return false;
      }

      // Search in URLs and metadata
      if (query) {
        const searchableText = [
          entry.originalUrl,
          entry.generatedUrl || '',
          entry.metadata.topic || '',
          entry.metadata.transformPrompt || ''
        ].join(' ').toLowerCase();

        if (!searchableText.includes(lowerQuery)) {
          return false;
        }
      }

      return true;
    })
    // Sort by timestamp (newest first)
    .sort((a, b) => b.timestamp - a.timestamp);

  return results;
}

// Message listener moved to top of file (lines 21-53) to consolidate all message handling
