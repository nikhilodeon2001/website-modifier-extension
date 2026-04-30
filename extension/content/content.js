// Store original page content for reset functionality
let originalContent = null;
let originalUrl = window.location.href;

// Flag to indicate if auto-intercept happened
let autoIntercepted = false;

// Store watermark overlay reference for cleanup
let watermarkOverlay = null;

// Store title observer for cleanup
let titleObserver = null;
let headObserver = null;
let textObserver = null;
let desiredTitle = null;
let titleDescriptorOverridden = false;

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
// Uses console (not originalConsole) so logs get captured when log saving is enabled
const debug = {
  log: (...args) => DEBUG_MODE && console.log(...args),
  warn: (...args) => DEBUG_MODE && console.warn(...args),
  error: (...args) => console.error(...args) // Always show errors
};

// Log that content script loaded
debug.log('✅ [Website Modifier] Content script loaded on:', window.location.href);
debug.log('   Document ready state:', document.readyState);
debug.log('   Timestamp:', new Date().toISOString());

// ============================================================================
// INSTANT PAGE HIDING (Prevents flash during auto-intercept check)
// ============================================================================
// Hide page IMMEDIATELY before any async operations (storage check, etc.)
// This prevents flash of original content while we check if there's a cached transformation
// The checkAutoIntercept function will show the page if no transformation is needed
(function hidePageForAutoIntercept() {
  const style = document.createElement('style');
  style.id = 'webmod-instant-hide';
  style.textContent = `
    html, body {
      visibility: hidden !important;
      opacity: 0 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  debug.log('👁️ [Auto-Intercept] Page hidden at script start (prevents flash during storage check)');
})();

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
 * CONSOLE LOG CAPTURE FUNCTIONS
 * ============================================================================
 */

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
    logBuffer.push(`[${timestamp()}] LOG: ${args.join(' ')}`);
    originalConsole.log.apply(console, args);
  };

  console.warn = function(...args) {
    logBuffer.push(`[${timestamp()}] WARN: ${args.join(' ')}`);
    originalConsole.warn.apply(console, args);
  };

  console.error = function(...args) {
    logBuffer.push(`[${timestamp()}] ERROR: ${args.join(' ')}`);
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
 * Save captured logs to a downloadable file
 * @param {Array} backgroundLogs - Optional array of logs from background worker
 */
function saveLogsToFile(backgroundLogs = []) {
  if (!logSavingEnabled) return;

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `website-modifier-logs-${timestamp}.txt`;

    // Combine and sort all logs by timestamp
    const allLogs = [...logBuffer, ...backgroundLogs];

    // Sort logs chronologically (extract timestamp from log string)
    allLogs.sort((a, b) => {
      const timeA = a.match(/\[(.*?)\]/)?.[1] || '';
      const timeB = b.match(/\[(.*?)\]/)?.[1] || '';
      return timeA.localeCompare(timeB);
    });

    const logContent = [
      '='.repeat(80),
      'Website Modifier Extension - Console Logs',
      '='.repeat(80),
      `URL: ${window.location.href}`,
      `Generated: ${new Date().toISOString()}`,
      `Total Entries: ${allLogs.length} (Content: ${logBuffer.length}, Background: ${backgroundLogs.length})`,
      '='.repeat(80),
      '',
      ...allLogs,
      '',
      '='.repeat(80),
      'End of Logs',
      '='.repeat(80)
    ].join('\n');

    // Send logs to background script for download using Chrome downloads API
    // This is more reliable than programmatic download from content script
    chrome.runtime.sendMessage({
      action: 'downloadLogs',
      logContent: logContent,
      filename: filename
    }, (response) => {
      if (response && response.success) {
        originalConsole.log(`✅ Logs download started: ${filename} (${allLogs.length} entries)`);
      } else {
        originalConsole.error('❌ Failed to download logs:', response?.error || 'Unknown error');
      }
    });

  } catch (error) {
    originalConsole.error('❌ Failed to save logs:', error);
  }
}

/**
 * ============================================================================
 * AUTO-INTERCEPT: Check if this page should load cached transformation
 * This runs immediately at document_start before the page renders
 * ============================================================================
 */
(async function checkAutoIntercept() {
  try {
    debug.log('🔍 [Auto-Intercept] Checking for cached transformation...');
    debug.log('   Current URL:', window.location.href);

    // Get settings and check if auto-intercept is enabled
    const storage = await chrome.storage.local.get(['autoInterceptSettings', 'transformationCache', 'generatedToOriginalMap', 'pendingIntercept', 'pendingGeneratedRedirect']);

    const settings = storage.autoInterceptSettings || {
      interceptOriginalUrls: false,
      interceptGeneratedUrls: false
    };

    debug.log('   Settings:', settings);

    // If both toggles are off, skip
    if (!settings.interceptOriginalUrls && !settings.interceptGeneratedUrls) {
      debug.log('   ⏭️ [Auto-Intercept] Auto-intercept disabled');
      showPageImmediately(); // Show page since we're not transforming
      return;
    }

    const cache = storage.transformationCache || {};
    const generatedMap = storage.generatedToOriginalMap || {};
    let currentUrl = window.location.href;

    // 🔧 FIX FOR FRAMEWORK REDIRECTS: Check if we got redirected away from a generated URL
    // Handles both /404 redirects and framework/CMS redirects (e.g. ESPN → section homepage)
    if (storage.pendingIntercept) {
      const pending = storage.pendingIntercept;
      const age = Date.now() - pending.timestamp;

      if (age < 5000 && currentUrl !== pending.url) {
        // We're not on the intended generated URL — we got redirected somewhere else
        debug.log('🔧 [Auto-Intercept] Redirect detected, using pending intercept URL');
        debug.log('   Landed at:', currentUrl);
        debug.log('   Intended URL:', pending.url);
        currentUrl = pending.url; // Override with the intended generated URL

        // Clear the pending intercept so it doesn't interfere with future navigations
        chrome.storage.local.remove('pendingIntercept');
      } else if (age >= 5000) {
        debug.log('⏰ [Auto-Intercept] Pending intercept too old, ignoring');
        chrome.storage.local.remove('pendingIntercept');
      }
    }

    let cachedEntry = null;
    let isOriginalUrl = false;
    let isGeneratedUrl = false;

    // Normalize current URL for comparison
    const normalizedCurrent = normalizeUrl(currentUrl);
    debug.log('   🔗 [Auto-Intercept] Normalized current URL:', normalizedCurrent);

    // Check if current URL is an original URL (try exact match first, then normalized)
    if (cache[currentUrl]) {
      cachedEntry = cache[currentUrl];
      isOriginalUrl = true;
      debug.log('   ✓ [Auto-Intercept] Found as original URL (exact match)');
    }
    // Try normalized match for original URL
    else if (cache[normalizedCurrent]) {
      cachedEntry = cache[normalizedCurrent];
      isOriginalUrl = true;
      debug.log('   ✓ [Auto-Intercept] Found as original URL (normalized match)');
    }
    // Check if current URL is a generated URL (try exact match first)
    else if (generatedMap[currentUrl]) {
      const originalUrl = generatedMap[currentUrl];
      cachedEntry = cache[originalUrl];
      isGeneratedUrl = true;
      debug.log('   ✓ [Auto-Intercept] Found as generated URL (exact match)');
      debug.log('   → Maps to original:', originalUrl);

      // Check if we should intercept this generated URL
      if (!settings.interceptGeneratedUrls) {
        debug.log('   ⏭️ [Auto-Intercept] Interception disabled for generated URLs');
        showPageImmediately(); // Show page since we're not transforming
        return;
      }

      // AUTO-REDIRECT: Redirect to original URL first, transformation will happen there
      debug.log('   🔀 [Auto-Intercept] Redirecting to original URL to apply transformation...');
      debug.log('      From:', currentUrl);
      debug.log('      To:', originalUrl);
      await chrome.storage.local.set({ pendingGeneratedRedirect: { url: originalUrl, timestamp: Date.now() } });
      window.location.replace(originalUrl);
      // Note: Page stays hidden during redirect - will be handled by next page load
      return; // Stop execution, page will reload at original URL
    }
    // Try normalized match for generated URL
    else {
      // Find matching generated URL by comparing normalized versions
      const matchingGenerated = Object.keys(generatedMap).find(genUrl =>
        normalizeUrl(genUrl) === normalizedCurrent
      );

      if (matchingGenerated) {
        const originalUrl = generatedMap[matchingGenerated];
        cachedEntry = cache[originalUrl];
        isGeneratedUrl = true;
        debug.log('   ✓ [Auto-Intercept] Found as generated URL (normalized match)');
        debug.log('   → Generated URL in cache:', matchingGenerated);
        debug.log('   → Current URL visited:', currentUrl);
        debug.log('   → Maps to original:', originalUrl);

        // Check if we should intercept this generated URL
        if (!settings.interceptGeneratedUrls) {
          debug.log('   ⏭️ [Auto-Intercept] Interception disabled for generated URLs');
          showPageImmediately(); // Show page since we're not transforming
          return;
        }

        // AUTO-REDIRECT: Redirect to original URL first, transformation will happen there
        debug.log('   🔀 [Auto-Intercept] Redirecting to original URL to apply transformation...');
        debug.log('      From:', currentUrl);
        debug.log('      To:', originalUrl);
        await chrome.storage.local.set({ pendingGeneratedRedirect: { url: originalUrl, timestamp: Date.now() } });
        window.location.replace(originalUrl);
        // Note: Page stays hidden during redirect - will be handled by next page load
        return; // Stop execution, page will reload at original URL
      }
    }

    if (!cachedEntry) {
      debug.log('   ⏭️ [Auto-Intercept] No cached transformation found');
      showPageImmediately(); // Show page since we're not transforming
      return;
    }

    // Found a cached entry - page is already hidden from script start
    debug.log('   ✓ [Auto-Intercept] Found cached entry, page already hidden');

    // Check if we should intercept original URLs (generated URLs already checked above)
    // Also apply if we arrived here via a generated URL redirect (flag set before window.location.replace)
    const pendingRedirect = storage.pendingGeneratedRedirect;
    const cameFromGeneratedRedirect = isOriginalUrl && pendingRedirect &&
      normalizeUrl(pendingRedirect.url) === normalizedCurrent &&
      (Date.now() - pendingRedirect.timestamp) < 10000;

    if (cameFromGeneratedRedirect) {
      chrome.storage.local.remove('pendingGeneratedRedirect');
      debug.log('   🔀 [Auto-Intercept] Arrived via generated URL redirect — applying transformation');
    }

    if (isOriginalUrl && !settings.interceptOriginalUrls && !cameFromGeneratedRedirect) {
      debug.log('   ⏭️ [Auto-Intercept] Interception disabled for original URLs');
      showPageImmediately(); // Unhide since we're not transforming
      return;
    }

    // SAFETY TIMEOUT: Unhide page after 3 seconds if transformation fails
    const safetyTimeout = setTimeout(() => {
      debug.warn('   ⚠️ [Auto-Intercept] Safety timeout reached, showing page...');
      showPageImmediately();
    }, 3000);

    // APPLY CACHED TRANSFORMATION
    debug.log('   🎯 [Auto-Intercept] Applying cached transformation...');
    debug.log('      ID:', cachedEntry.id);
    debug.log('      Mode:', cachedEntry.metadata.mode);
    debug.log('      Date:', cachedEntry.metadata.date);

    // Wait for DOM to be ready (required for querySelector to find elements)
    if (document.readyState === 'loading') {
      debug.log('   ⏳ [Auto-Intercept] Waiting for DOMContentLoaded...');
      await new Promise(resolve => {
        document.addEventListener('DOMContentLoaded', resolve, { once: true });
      });
    }

    // CRITICAL: Wait for React hydration to complete on React sites
    // React hydration happens shortly after DOMContentLoaded and will revert our changes
    // if we transform before it completes. Wait for the page to settle.
    // INCREASED DELAY: 500ms to ensure all DOM elements are fully rendered (needed for nth-of-type selectors)
    debug.log('   ⏳ [Auto-Intercept] Waiting for React hydration to complete...');
    await new Promise(resolve => setTimeout(resolve, 500)); // Longer delay to ensure full DOM rendering

    debug.log('   ✅ [Auto-Intercept] DOM ready and hydrated, applying transformation...');

    // Convert stored image data to object format for replacePageContent
    const imagesForReplacement = cachedEntry.images.map(img => ({
      success: !!(img.url || img.imageId),  // Success if has URL OR imageId
      url: img.url || null,  // DALL-E URL (temporary)
      imageId: img.imageId || null,  // IndexedDB ID (local)
      storedLocally: img.storedLocally || false,  // Storage mode
      prompt: img.prompt
    }));

    // 🔍 DEBUG LOGGING
    debug.log('🔍 DEBUG - About to apply transformation');
    debug.log('🔍 DEBUG - cachedEntry:', JSON.stringify(cachedEntry, null, 2));
    debug.log('🔍 DEBUG - imagesForReplacement count:', imagesForReplacement.length);
    debug.log('🔍 DEBUG - Calling replacePageContent...');

    // Use existing replacePageContent function
    const result = await replacePageContent(
      cachedEntry.content,
      imagesForReplacement,
      cachedEntry.generatedUrl,
      false,  // Don't replace URL yet, we'll do it after
      cachedEntry.metadata?.selectedImageSelectors  // Use cached image selectors if available
    );

    // 🔍 DEBUG LOGGING
    debug.log('🔍 DEBUG - replacePageContent result:', JSON.stringify(result, null, 2));

    if (result.success) {
      debug.log('   ✅ [Auto-Intercept] Content replaced successfully');
    } else {
      console.error('   ❌ [Auto-Intercept] Content replacement failed:', result.error);
    }

    // Update URL if needed
    const actualBrowserUrl = window.location.href; // The actual URL in the browser (might be /404)

    // Case 1: We're on original URL, update to generated URL
    if (isOriginalUrl && cachedEntry.generatedUrl) {
      debug.log('   🔗 [Auto-Intercept] Updating URL (original → generated)...');
      debug.log('      From:', actualBrowserUrl);
      debug.log('      To:', cachedEntry.generatedUrl);
      window.history.replaceState({}, '', cachedEntry.generatedUrl);
    }
    // Case 2: We're on 404 but intended URL was a generated URL, fix the browser URL
    else if (actualBrowserUrl.includes('/404') && isGeneratedUrl && currentUrl !== actualBrowserUrl) {
      debug.log('   🔗 [Auto-Intercept] Fixing URL (404 → generated)...');
      debug.log('      From:', actualBrowserUrl);
      debug.log('      To:', currentUrl);
      window.history.replaceState({}, '', currentUrl);
    }

    // Clear safety timeout (transformation succeeded)
    clearTimeout(safetyTimeout);

    // Show page immediately now that transformation is complete
    showPageImmediately();

    autoIntercepted = true;
    debug.log('   ✅ [Auto-Intercept] Cached transformation applied!');

  } catch (error) {
    console.error('   ❌ [Auto-Intercept] Error:', error);
    console.error('      Stack:', error.stack);
    clearTimeout(safetyTimeout);
    showPageImmediately(); // Show page on error too
  }
})();

/**
 * Hide page immediately at document_start (before content renders)
 * This prevents any flash of original content during auto-intercept
 */
function hidePageImmediately() {
  // Inject CSS that hides both html and body instantly
  const style = document.createElement('style');
  style.id = 'webmod-instant-hide';
  style.textContent = `
    html, body {
      visibility: hidden !important;
      opacity: 0 !important;
    }
  `;
  (document.head || document.documentElement).appendChild(style);
  debug.log('   👁️ [Auto-Intercept] Page hidden via CSS injection');
}

/**
 * Show page immediately after transformation is complete
 * This reveals the already-transformed content
 */
function showPageImmediately() {
  // Remove the hiding CSS
  const style = document.getElementById('webmod-instant-hide');
  if (style) {
    style.remove();
    debug.log('   👁️ [Auto-Intercept] Page revealed');
  }

  // Also ensure body is visible (legacy compatibility)
  if (document.body) {
    document.body.style.visibility = '';
    document.body.style.opacity = '';
  }
  if (document.documentElement) {
    document.documentElement.style.visibility = '';
    document.documentElement.style.opacity = '';
  }
}

// Save original content on page load (only if not auto-intercepted)
function saveOriginalContent() {
  if (!originalContent && !autoIntercepted) {
    originalContent = {
      title: document.title,
      body: document.body.cloneNode(true),
      url: window.location.href
    };
  }
}

// Initialize after DOM loads (not needed if auto-intercepted)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', saveOriginalContent);
} else {
  saveOriginalContent();
}

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  debug.log('📨 [Content] Received message:', request.action);

  // Ping handler to test if content script is loaded and responsive
  if (request.action === 'ping') {
    debug.log('🏓 [Content] Responding to ping');
    sendResponse({ pong: true });
    return true;
  }

  if (request.action === 'analyzeContent') {
    // Start capturing logs for this transformation
    startLogCapture();

    debug.log('🔍 [Content] Starting page analysis...');
    const articleLengthLimit = request.articleLengthLimit || 1000;
    const selectedModel = request.selectedModel || 'gpt-4';
    debug.log('   📏 [Content] Article length limit:', articleLengthLimit, 'words');
    debug.log('   🤖 [Content] Selected model:', selectedModel);

    // Analyze page structure and extract content elements
    const analysis = analyzePageContent(articleLengthLimit, selectedModel);
    debug.log('✅ [Content] Analysis complete');
    sendResponse({ success: true, analysis });
    return true;
  }

  if (request.action === 'replaceContent') {
    debug.log('🔄 [Content] Starting content replacement...');
    // Replace content with generated data (async function)
    replacePageContent(
      request.content,
      request.images,
      request.generatedUrl,
      request.replaceUrl,
      request.selectedImageSelectors
    ).then(result => {
      if (result.success) {
        debug.log('✅ [Content] Content replaced successfully');
      } else {
        console.error('❌ [Content] Content replacement failed:', result.error);
      }

      // Save logs and stop capturing (include background logs from request)
      saveLogsToFile(request.backgroundLogs || []);
      stopLogCapture();

      sendResponse(result);
    }).catch(error => {
      console.error('❌ [Content] Content replacement error:', error);

      // Save logs even on error (include background logs from request)
      saveLogsToFile(request.backgroundLogs || []);
      stopLogCapture();

      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  }

  if (request.action === 'resetPage') {
    debug.log('🔄 [Content] Resetting page...');
    // Reset to original content
    resetPage();
    debug.log('✅ [Content] Page reset complete');
    sendResponse({ success: true });
    return true;
  }

  if (request.action === 'startImageSelection') {
    debug.log('🖼️ [Content] Starting image selection mode...');
    const tabId = request.tabId;

    // Start selection mode (don't wait for it to complete)
    startImageSelectionMode(tabId).then(result => {
      debug.log('✅ [Content] Image selection complete:', result);
      // Selection completed (user clicked Done/Cancel)
    }).catch(error => {
      // Error notification is already shown by showImageSelectionError
      // and error is already logged in startImageSelectionMode
      // So we don't need to log it again here
    });

    // Send immediate response to let popup close
    sendResponse({ success: true, started: true });
    return false; // Don't keep channel open
  }
});

/**
 * Smart content container selection using scoring algorithm
 * Finds the best content container by analyzing multiple signals
 * @param {string} context - Context string for logging (e.g., "Analysis" or "Replace")
 * @returns {Element} The best content container element
 */
function findBestContentContainer(context = 'Analysis') {
  debug.log(`   🎯 [${context}] Finding best content container...`);

  // Get all potential content containers - ONLY specific, reliable selectors
  // Removed [class*="article"] and [class*="story"] - too broad!
  const potentialContainers = Array.from(document.querySelectorAll(
    'article, main, [role="main"], .article-content, .article-body, .post-content, .entry-content, .story-body, .story-content'
  ));

  debug.log(`   📦 [${context}] Found`, potentialContainers.length, 'potential containers');

  let contentRoot = null;
  let bestScore = -1;

  // Get body dimensions for full-page detection
  const bodyHeight = document.body.offsetHeight || document.body.scrollHeight;
  const bodyWidth = document.body.offsetWidth || document.body.scrollWidth;

  // Score each container
  potentialContainers.forEach((container, idx) => {
    let score = 0;

    // Count paragraphs (most important signal)
    const pCount = container.querySelectorAll('p').length;
    score += pCount * 10;

    // Count text content (second most important)
    const textLength = container.textContent.trim().length;
    score += textLength * 0.1;

    // Count headings (good signal for article content)
    const h1Count = container.querySelectorAll('h1').length;
    const h2Count = container.querySelectorAll('h2').length;
    const h3Count = container.querySelectorAll('h3').length;
    score += (h1Count + h2Count + h3Count) * 5;

    // PENALTY: Ad-related classes/IDs (strong negative signal)
    const className = container.className?.toLowerCase() || '';
    const id = container.id?.toLowerCase() || '';
    const combinedAttrs = `${className} ${id}`;

    const adKeywords = ['ad-', '-ad', 'advertisement', 'promo', 'sponsored', 'banner'];
    const hasAdKeyword = adKeywords.some(keyword => combinedAttrs.includes(keyword));
    if (hasAdKeyword) {
      score -= 1000; // Heavy penalty for ad containers
    }

    // PENALTY: Container includes navigation or header (likely too broad)
    const hasNav = container.querySelector('nav') !== null;
    const hasHeader = container.querySelector('header.site-header, header.main-header, header[role="banner"]') !== null;
    if (hasNav || hasHeader) {
      score -= 500; // Penalize containers that include page navigation
      debug.log(`   ⚠️ [${context}] Container ${idx} includes navigation/header - penalized`);
    }

    // PENALTY: Container is nearly full-page size (likely a wrapper, not content)
    const containerHeight = container.offsetHeight || container.scrollHeight;
    const containerWidth = container.offsetWidth || container.scrollWidth;
    const heightRatio = containerHeight / bodyHeight;
    const widthRatio = containerWidth / bodyWidth;

    if (heightRatio > 0.9 && widthRatio > 0.9) {
      score -= 300; // Penalize containers that are >90% of page size
      debug.log(`   ⚠️ [${context}] Container ${idx} is nearly full-page (${Math.round(heightRatio * 100)}% height) - penalized`);
    }

    // BONUS: If it has an article-specific class
    const articleKeywords = ['article-body', 'story-body', 'post-body', 'entry-content'];
    const hasArticleKeyword = articleKeywords.some(keyword => combinedAttrs.includes(keyword));
    if (hasArticleKeyword) {
      score += 50;
    }

    // Log scoring for debugging (only first 5 containers or if best)
    if (idx < 5 || score > bestScore) {
      debug.log(`   📊 [${context}] Container ${idx}: ${container.tagName}.${className.substring(0, 30)}`);
      debug.log(`      Score: ${score} (${pCount}p, ${textLength}chars, ${h1Count + h2Count + h3Count}h)`);
    }

    // Update best container
    if (score > bestScore) {
      bestScore = score;
      contentRoot = container;
    }
  });

  // Use best container even if score is negative (better than document.body)
  // Only fall back to body if NO container was found at all
  if (!contentRoot) {
    debug.log(`   ℹ️ [${context}] No content container found, using document.body`);
    contentRoot = document.body;
  } else if (bestScore < 0) {
    debug.log(`   ⚠️ [${context}] Best container has negative score (${bestScore}), but using it anyway (better than document.body)`);
    debug.log('      Tag:', contentRoot.tagName);
    debug.log('      Class:', contentRoot.className.substring(0, 50));
  } else {
    debug.log(`   ✅ [${context}] Selected best container with score:`, bestScore);
    debug.log('      Tag:', contentRoot.tagName);
    debug.log('      Class:', contentRoot.className.substring(0, 50));
    debug.log('      Text length:', contentRoot.textContent.trim().length, 'chars');
    debug.log('      Paragraphs:', contentRoot.querySelectorAll('p').length);
    debug.log('      Headings:', contentRoot.querySelectorAll('h1, h2, h3').length);
  }

  return contentRoot;
}

/**
 * Extract text from an element, preserving spacing between child elements
 * @param {Element} element - The DOM element to extract text from
 * @returns {string} The extracted text with proper spacing
 */
function extractTextWithSpacing(element) {
  // Safety check: ensure element exists
  if (!element) {
    return '';
  }

  // Get all direct child elements (not text nodes)
  const children = Array.from(element.children).filter(child =>
    child.textContent && child.textContent.trim().length > 0
  );

  // If element has multiple children, extract from each and join with space
  // This handles cases like: <time><span>Feb. 22, 2026</span><span>Updated 4:50 p.m. ET</span></time>
  if (children.length > 0) {
    return children
      .map(child => (child.innerText || child.textContent || '').trim())
      .filter(text => text.length > 0)
      .join(' ');
  }

  // Fallback to innerText or textContent for simple elements
  // Use textContent as fallback since innerText may be undefined on some elements
  return (element.innerText || element.textContent || '').trim();
}

/**
 * Analyze the current page and extract content structure
 * @param {number} articleLengthLimit - Maximum article length in words
 * @param {string} selectedModel - The AI model being used (affects max word limit)
 */
function analyzePageContent(articleLengthLimit = 1000, selectedModel = 'gpt-4') {
  debug.log('   🔎 [Analysis] Scanning DOM for elements...');

  // Use smart container selection
  const contentRoot = findBestContentContainer('Analysis');

  // Find main content headings (filter out navigation)
  const allH1 = contentRoot.querySelectorAll('h1').length;
  const allH2 = contentRoot.querySelectorAll('h2').length;
  const allH3 = contentRoot.querySelectorAll('h3').length;

  const h1Elements = Array.from(contentRoot.querySelectorAll('h1')).filter(h => {
    const isNav = isNavigationElement(h);
    if (isNav && allH1 <= 2) {
      debug.log('   🚫 [Filter] Filtered H1:', h.textContent.substring(0, 50));
    }
    return !isNav;
  });
  const h2Elements = Array.from(contentRoot.querySelectorAll('h2')).filter(h => {
    const isNav = isNavigationElement(h);
    if (isNav && allH2 <= 5) {
      debug.log('   🚫 [Filter] Filtered H2:', h.textContent.substring(0, 50));
    }
    return !isNav;
  });
  const h3Elements = Array.from(contentRoot.querySelectorAll('h3')).filter(h => !isNavigationElement(h));

  debug.log(`   📊 [Analysis] Found headings: ${h1Elements.length}/${allH1} H1, ${h2Elements.length}/${allH2} H2, ${h3Elements.length}/${allH3} H3`);

  // Find article deck/subheader (summary text below headline, common in news sites)
  // Search entire document since deck is often in hero section outside contentRoot
  const articleDeckSelectors = [
    '[data-testid="article-dek"]',       // NBC News
    '.article-dek',                       // Common pattern
    '.article-subhead',                   // Common pattern
    '.article-summary',                   // Common pattern
    '[class*="article-dek"]',             // Partial match
    '[class*="articleDek"]',              // CSS modules style (e.g., styles_articleDek__hash)
    '[class*="subheadline"]',             // Partial match
    '[class*="deck"]',                    // Partial match
    'p.dek',                              // Some sites use <p class="dek">
    '.standfirst'                         // Guardian, BBC
  ];

  let articleDeck = null;
  for (const selector of articleDeckSelectors) {
    const found = document.querySelector(selector);
    if (found && found.textContent.trim().length > 20 && !isNavigationElement(found)) {
      articleDeck = found;
      debug.log(`   📰 [Analysis] Found article deck with selector: ${selector}`);
      debug.log(`   📰 [Analysis] Deck text: ${found.textContent.trim().substring(0, 100)}...`);
      break;
    }
  }

  if (!articleDeck) {
    debug.log('   ℹ️ [Analysis] No article deck/subheader found');
  }

  // Find paragraphs - try article-specific selectors FIRST for accuracy
  const allPTags = contentRoot.querySelectorAll('p').length;

  // Priority 1: Try article-specific selectors (ESPN, Reuters, CNN, etc.)
  const articleTextSelectors = [
    '.article-body p',                 // ESPN, many news sites
    '[data-testid="paragraph"]',       // Reuters
    '.story-body p',                   // BBC, common pattern
    '.story-content p',                // Common pattern
    '[class*="article-body"] p',       // Partial class match
    '[class*="ArticleBody"] p',        // Pascal case variant
    '[class*="story-content"] p',      // Story content variant
    '[class*="post-content"] p',       // Blog/post pattern
    '[class*="entry-content"] p',      // WordPress, blog pattern
    '[class*="paragraph"]'             // Generic paragraph class
  ];

  let paragraphs = [];
  for (const selector of articleTextSelectors) {
    const found = Array.from(contentRoot.querySelectorAll(selector)).filter(el => {
      const text = el.textContent.trim();
      return text.length > 30 && !isNavigationElement(el);
    });
    if (found.length > 0) {
      debug.log(`   ✅ [Analysis] Found ${found.length} paragraphs with article-specific selector: ${selector}`);
      paragraphs = found;
      break;
    }
  }

  // Priority 2: Fall back to generic <p> tags only if no article-specific selectors worked
  if (paragraphs.length === 0) {
    debug.log('   ℹ️ [Analysis] No article-specific selectors worked, trying generic <p> tags...');

    // Get author/byline/date elements to exclude from paragraphs (we skip these in replacement)
    const authorElements = document.querySelectorAll('[class*="author"], [class*="byline"], [itemprop="author"]');
    const dateElements = document.querySelectorAll('time, [class*="date"], [class*="published"]');
    const metadataElements = new Set([...authorElements, ...dateElements]);

    paragraphs = Array.from(contentRoot.querySelectorAll('p')).filter(p => {
      const text = p.textContent.trim();
      const tooShort = text.length <= 30;
      const isNav = isNavigationElement(p);

      // Exclude paragraphs inside figcaption elements (those are captions, not article text)
      const isInsideCaption = p.closest('figcaption') !== null;

      // Exclude author/byline/date elements (these are metadata, not article paragraphs)
      const isMetadata = metadataElements.has(p);

      // Also exclude paragraphs that are inside author/byline containers
      // NYT structure: <div class="byline"><a>Authors</a></div><p>Author names</p>
      const isInsideAuthorContainer = p.closest('[class*="author"], [class*="byline"]') !== null;

      // Also exclude paragraphs that start with "By" and contain only author names/links
      // This catches byline paragraphs like: <p>By <a>Author 1</a>, <a>Author 2</a></p>
      const startsWithBy = text.startsWith('By ');
      const hasOnlyAuthorLinks = p.querySelectorAll('a').length >= 2 && p.querySelectorAll('a').length === text.split(/,|\sand\s/).length;
      const isAuthorByline = startsWithBy && (hasOnlyAuthorLinks || text.length < 200);

      // Also check for "Reporting from" paragraphs which are part of byline metadata
      const isReportingFrom = text.startsWith('Reporting from') && text.length < 100;

      if ((tooShort || isNav || isInsideCaption || isMetadata || isInsideAuthorContainer || isAuthorByline || isReportingFrom) && allPTags <= 10) {
        debug.log(`   🚫 [Filter] Filtered <p> (${text.length} chars):`, text.substring(0, 80),
                    tooShort ? '(too short)' : isNav ? '(navigation)' : isInsideCaption ? '(inside caption)' : isMetadata ? '(metadata)' : isInsideAuthorContainer ? '(inside author container)' : isAuthorByline ? '(author byline)' : '(reporting from)');
      }

      return text.length > 30 && !isNav && !isInsideCaption && !isMetadata && !isInsideAuthorContainer && !isAuthorByline && !isReportingFrom;
    });
    debug.log(`   ✅ [Analysis] Using generic <p> selector, found ${paragraphs.length} paragraphs`);
  }

  debug.log(`   📄 [Analysis] Final paragraph count: ${paragraphs.length}/${allPTags} total <p> tags`);

  // Find images (filter out small icons/logos)
  const allImages = contentRoot.querySelectorAll('img').length;
  const images = Array.from(contentRoot.querySelectorAll('img')).filter(img => {
    const computedStyle = window.getComputedStyle(img);
    const width = parseInt(computedStyle.width) || 0;
    const height = parseInt(computedStyle.height) || 0;
    const isVisible = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';
    const wasLazy = img.hasAttribute('loading') || img.hasAttribute('data-src') || img.hasAttribute('data-srcset');
    return ((width > 100 && height > 100 && isVisible) || (wasLazy && isVisible)) && !isNavigationElement(img);
  });
  debug.log(`   🖼️ [Analysis] Found ${images.length}/${allImages} valid images (computed size >100x100px or lazy-loaded)`);

  // Find image captions (treat as transformable content, not just image metadata)
  debug.log('   📷 [Analysis] Finding image captions...');
  const captionSelectors = [
    'figcaption',                          // Standard HTML5
    '[data-testid*="Caption"]',            // NYT and test-driven sites
    '[data-testid*="caption"]',            // Lowercase variant
    '[class*="ImageCaption"]',             // NYT specific
    '[class*="imageCaption"]',             // Camel case variant
    '[class*="image-caption"]',            // Kebab case
    '[class*="photo-caption"]',            // Photo variant
    '[class*="caption"]'                   // Generic (last resort)
  ];

  const allCaptionElements = [];
  for (const selector of captionSelectors) {
    const found = Array.from(contentRoot.querySelectorAll(selector));
    found.forEach(el => {
      // Avoid duplicates
      if (!allCaptionElements.includes(el)) {
        allCaptionElements.push(el);
      }
    });
  }

  // Filter captions: must have substantial text (not just photo credits)
  const captions = allCaptionElements.filter(caption => {
    // Try to get ONLY the main caption text, excluding credits
    // Look for specific caption text elements first (matching replacement logic at line 1601)
    const mainCaptionEl = caption.querySelector('[class*="jevhma"], [class*="caption-text"], span:first-child');
    const text = mainCaptionEl ? mainCaptionEl.textContent.trim() : caption.textContent.trim();

    // Must be at least 30 chars and not navigation
    if (text.length < 30 || isNavigationElement(caption)) {
      return false;
    }
    // Exclude if it's ONLY a photo credit (contains only "Credit", "Photo by", etc.)
    const creditKeywords = ['credit', 'photo by', 'image by', 'getty images', 'ap photo'];
    const lowerText = text.toLowerCase();
    const isOnlyCredit = creditKeywords.some(keyword => lowerText.includes(keyword)) && text.length < 100;
    return !isOnlyCredit;
  });

  debug.log(`   📷 [Analysis] Found ${captions.length} image captions to transform`);
  if (captions.length > 0) {
    captions.slice(0, 2).forEach((cap, idx) => {
      // Show the extracted main caption text (not including credits)
      const mainCaptionEl = cap.querySelector('[class*="jevhma"], [class*="caption-text"], span:first-child');
      const text = mainCaptionEl ? mainCaptionEl.textContent.trim() : cap.textContent.trim();
      const preview = text.substring(0, 60);
      debug.log(`      Caption ${idx + 1}: ${preview}...`);
    });
  }

  // Find author/byline elements
  const authorElements = Array.from(document.querySelectorAll('[class*="author"], [class*="byline"], [itemprop="author"]'));
  debug.log(`   ✍️ [Analysis] Found ${authorElements.length} author elements`);

  // Find date elements
  const dateElements = Array.from(document.querySelectorAll('time, [class*="date"], [class*="published"]'));
  debug.log(`   📅 [Analysis] Found ${dateElements.length} date elements`);

  // Extract full article text for context-aware transformations
  debug.log('   📝 [Analysis] Extracting full article text...');
  debug.log('      H1 array length:', h1Elements.length);
  debug.log('      Article deck:', articleDeck ? 'found' : 'none');
  debug.log('      H2 array length:', h2Elements.length);
  debug.log('      H3 array length:', h3Elements.length);
  debug.log('      Paragraphs array length:', paragraphs.length);
  debug.log('      Images array length:', images.length);
  debug.log('      Captions array length:', captions.length);
  const fullArticleText = extractArticleText(h1Elements, articleDeck, h2Elements, h3Elements, paragraphs, images, captions, articleLengthLimit, selectedModel);
  debug.log(`   📰 [Analysis] Extracted article text (${fullArticleText.length} chars)`);
  if (fullArticleText.length < 500) {
    debug.warn('   ⚠️ [Analysis] Article text seems too short! First 200 chars:');
    debug.warn('  ', fullArticleText.substring(0, 200));
  }

  return {
    headings: {
      h1: h1Elements.map(h => ({
        text: h.textContent.trim(),
        element: h
      })),
      h2: h2Elements.map(h => ({
        text: h.textContent.trim(),
        element: h
      })),
      h3: h3Elements.map(h => ({
        text: h.textContent.trim(),
        element: h
      }))
    },
    articleDeck: articleDeck ? {
      text: articleDeck.textContent.trim(),
      element: articleDeck
    } : null,
    paragraphs: paragraphs.map(p => ({
      text: p.textContent.trim(),
      element: p
    })),
    images: images.map(img => ({
      src: img.src,
      alt: img.alt,
      element: img
    })),
    captions: captions.map(cap => ({
      text: cap.textContent.trim(),
      element: cap
    })),
    authors: authorElements.map(el => ({
      text: el.textContent.trim(),
      element: el
    })),
    dates: dateElements.map(el => ({
      text: extractTextWithSpacing(el),
      element: el
    })),
    title: document.title,
    fullArticleText: fullArticleText
  };
}

/**
 * Extract full article text content for context-aware transformations
 * @param {Array} h1Elements - H1 heading elements
 * @param {Element} articleDeck - Article deck/subheader element
 * @param {Array} h2Elements - H2 heading elements
 * @param {Array} h3Elements - H3 heading elements
 * @param {Array} paragraphs - Paragraph elements
 * @param {Array} images - Image elements with alt texts
 * @param {Array} captions - Image caption elements
 * @param {number} wordLimit - Maximum words (from slider)
 * @param {string} model - Selected AI model
 */
function extractArticleText(h1Elements, articleDeck, h2Elements, h3Elements, paragraphs, images, captions, wordLimit = 1000, model = 'gpt-4') {
  let text = '';

  debug.log('   📝 [Extract] Starting text extraction...');
  debug.log('      Inputs received:');
  debug.log('         H1 elements:', h1Elements ? h1Elements.length : 'null');
  debug.log('         Article deck:', articleDeck ? 'yes' : 'no');
  debug.log('         H2 elements:', h2Elements ? h2Elements.length : 'null');
  debug.log('         H3 elements:', h3Elements ? h3Elements.length : 'null');
  debug.log('         Paragraphs:', paragraphs ? paragraphs.length : 'null');
  debug.log('         Images:', images ? images.length : 'null');
  debug.log('         Captions:', captions ? captions.length : 'null');

  // Add title
  if (document.title) {
    text += `TITLE: ${document.title}\n\n`;
    debug.log('      ✓ Added title:', document.title.substring(0, 50));
  }

  // Add H1 headings (h1Elements is array of DOM elements)
  let h1Count = 0;
  if (h1Elements && Array.isArray(h1Elements)) {
    h1Elements.forEach(h1 => {
      if (h1 && h1.textContent) {
        const h1Text = h1.textContent.trim();
        if (h1Text.length > 0) {
          text += `# ${h1Text}\n\n`;
          h1Count++;
        }
      }
    });
  }
  debug.log('      ✓ Added', h1Count, 'H1 headings');

  // Add article deck/subheader if present (appears right after headline)
  if (articleDeck && articleDeck.textContent) {
    const deckText = articleDeck.textContent.trim();
    if (deckText.length > 0) {
      text += `DECK: ${deckText}\n\n`;
      debug.log('      ✓ Added article deck:', deckText.substring(0, 50));
    }
  }

  // Build article content with headings and paragraphs in order
  // Try to maintain document order by getting all content elements
  // Note: These are DOM elements, not wrapped objects
  const contentElements = [];

  debug.log('   📦 [Extract] Building content elements array...');

  // Validate and add H2 elements
  let h2Added = 0;
  if (h2Elements && Array.isArray(h2Elements)) {
    h2Elements.forEach((h2, idx) => {
      if (h2 && h2.nodeType === Node.ELEMENT_NODE && h2.textContent) {
        contentElements.push({ type: 'h2', element: h2 });
        h2Added++;
      }
    });
  }
  debug.log('      ✓ Added', h2Added, 'H2 elements to array');

  // Validate and add H3 elements
  let h3Added = 0;
  if (h3Elements && Array.isArray(h3Elements)) {
    h3Elements.forEach((h3, idx) => {
      if (h3 && h3.nodeType === Node.ELEMENT_NODE && h3.textContent) {
        contentElements.push({ type: 'h3', element: h3 });
        h3Added++;
      }
    });
  }
  debug.log('      ✓ Added', h3Added, 'H3 elements to array');

  // Validate and add paragraph elements
  let pAdded = 0;
  if (paragraphs && Array.isArray(paragraphs)) {
    paragraphs.forEach((p, idx) => {
      if (p && p.nodeType === Node.ELEMENT_NODE && p.textContent) {
        const pText = p.textContent.trim();
        if (pText.length > 0) {
          contentElements.push({ type: 'p', element: p });
          pAdded++;
          // Log first few paragraphs for debugging
          if (pAdded <= 3) {
            debug.log(`      ✓ Paragraph ${pAdded}:`, pText.substring(0, 60) + '...');
          }
        }
      }
    });
  } else {
    console.error('      ✗ Paragraphs is not an array!', typeof paragraphs);
  }
  debug.log('      ✓ Added', pAdded, 'paragraph elements to array');

  // Validate and add caption elements
  let captionAdded = 0;
  if (captions && Array.isArray(captions)) {
    captions.forEach((caption, idx) => {
      if (caption && caption.nodeType === Node.ELEMENT_NODE && caption.textContent) {
        const captionText = caption.textContent.trim();
        if (captionText.length > 0) {
          contentElements.push({ type: 'caption', element: caption });
          captionAdded++;
          // Log first few captions for debugging
          if (captionAdded <= 2) {
            debug.log(`      ✓ Caption ${captionAdded}:`, captionText.substring(0, 60) + '...');
          }
        }
      }
    });
  }
  debug.log('      ✓ Added', captionAdded, 'caption elements to array');

  // Validate and add image alt text elements
  let altAdded = 0;
  if (images && Array.isArray(images)) {
    images.forEach((img, idx) => {
      if (img && img.nodeType === Node.ELEMENT_NODE && img.alt) {
        const altText = img.alt.trim();
        if (altText.length > 0) {
          contentElements.push({ type: 'alt', element: img });
          altAdded++;
          // Log first few alt texts for debugging
          if (altAdded <= 2) {
            debug.log(`      ✓ Image Alt ${altAdded}:`, altText.substring(0, 60) + '...');
          }
        }
      }
    });
  }
  debug.log('      ✓ Added', altAdded, 'image alt text elements to array');
  debug.log('   📊 [Extract] Total content elements:', contentElements.length);

  // Sort by DOM position (only if elements exist)
  if (contentElements.length > 0) {
    debug.log('   🔄 [Extract] Sorting elements by DOM position...');
    try {
      contentElements.sort((a, b) => {
        if (!a.element || !b.element) return 0;
        try {
          const position = a.element.compareDocumentPosition(b.element);
          return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
        } catch (err) {
          debug.warn('      ⚠️ [Extract] DOM position comparison failed:', err.message);
          return 0; // Keep original order if comparison fails
        }
      });
      debug.log('      ✓ Sorting complete');
    } catch (sortError) {
      console.error('      ✗ Sorting failed:', sortError.message);
      debug.log('      → Continuing with unsorted elements');
    }
  }

  // Build text with proper formatting
  debug.log('   📝 [Extract] Building text from', contentElements.length, 'elements...');
  let textAdded = 0;
  contentElements.forEach((item, idx) => {
    try {
      if (!item.element || !item.element.textContent) {
        debug.log(`      ℹ️ [Extract] Element ${idx} has no textContent (likely removed during DOM sorting)`);
        return;
      }

      const elementText = item.element.textContent.trim();
      if (elementText.length === 0) {
        return; // Skip empty elements
      }

      if (item.type === 'h2') {
        text += `\n## ${elementText}\n\n`;
        textAdded++;
      } else if (item.type === 'h3') {
        text += `\n### ${elementText}\n\n`;
        textAdded++;
      } else if (item.type === 'p') {
        text += `${elementText}\n\n`;
        textAdded++;
      } else if (item.type === 'caption') {
        // Extract ONLY main caption text, excluding credits (matching analysis logic)
        const mainCaptionEl = item.element.querySelector('[class*="jevhma"], [class*="caption-text"], span:first-child');
        const captionText = mainCaptionEl ? mainCaptionEl.textContent.trim() : elementText;
        text += `IMAGE CAPTION: ${captionText}\n\n`;
        textAdded++;
      } else if (item.type === 'alt') {
        // Extract alt text from image element
        const altText = item.element.alt.trim();
        text += `IMAGE ALT: ${altText}\n\n`;
        textAdded++;
      }
    } catch (err) {
      console.error(`      ✗ [Extract] Error processing element ${idx}:`, err.message);
    }
  });
  debug.log('      ✓ Successfully added text from', textAdded, 'elements');
  debug.log('   📏 [Extract] Text length before truncation:', text.length, 'chars');

  // FALLBACK: If we have paragraphs but failed to extract text, use simple concatenation
  if (text.length < 500 && paragraphs && paragraphs.length > 0) {
    debug.warn('   ⚠️ [Extract] Text seems too short, trying fallback extraction...');
    debug.log('      Current text length:', text.length);
    debug.log('      Available paragraphs:', paragraphs.length);

    let fallbackText = text; // Keep what we have
    let fallbackAdded = 0;

    // Simply concatenate all paragraph text without sorting
    paragraphs.forEach((p, idx) => {
      try {
        if (p && p.nodeType === Node.ELEMENT_NODE && p.textContent) {
          const pText = p.textContent.trim();
          if (pText.length > 30) { // Only add substantial paragraphs
            fallbackText += `${pText}\n\n`;
            fallbackAdded++;
            if (fallbackAdded <= 2) {
              debug.log(`      ✓ Fallback paragraph ${fallbackAdded}:`, pText.substring(0, 60) + '...');
            }
          }
        }
      } catch (err) {
        console.error(`      ✗ [Fallback] Error with paragraph ${idx}:`, err.message);
      }
    });

    if (fallbackAdded > 0) {
      debug.log('   ✅ [Fallback] Added', fallbackAdded, 'paragraphs via fallback');
      debug.log('   📏 [Fallback] New text length:', fallbackText.length, 'chars');
      text = fallbackText;
    } else {
      console.error('   ❌ [Fallback] Fallback extraction also failed!');
    }
  }

  // Apply word limit (user choice AND model limit, whichever is smaller)
  const modelMaxWords = {
    'gpt-4-turbo': 90000,
    'gpt-4-turbo-preview': 90000,
    'gpt-4o': 90000,
    'gpt-3.5-turbo': 11000,
    'gpt-4': 5000
  };

  const modelLimit = modelMaxWords[model] || 5000;
  const effectiveLimit = Math.min(wordLimit, modelLimit);

  // Count words in the article text
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;

  debug.log(`   📊 [Analysis] Article word count: ${wordCount}`);
  debug.log(`   📊 [Analysis] User limit: ${wordLimit} words`);
  debug.log(`   📊 [Analysis] Model limit: ${modelLimit} words (${model})`);
  debug.log(`   📊 [Analysis] Effective limit: ${effectiveLimit} words`);

  if (wordCount > effectiveLimit) {
    debug.log(`   ⚠️ [Analysis] Truncating article from ${wordCount} to ${effectiveLimit} words`);

    // Truncate to first N words (top to bottom, sequential)
    const truncatedWords = words.slice(0, effectiveLimit);
    text = truncatedWords.join(' ');

    // Add truncation notice
    text += '\n\n[Article truncated to fit length limit]';

    debug.log(`   ✅ [Analysis] Article truncated to ${effectiveLimit} words (${text.length} chars)`);
  } else {
    debug.log(`   ✅ [Analysis] Article within limit (${wordCount} / ${effectiveLimit} words)`);
  }

  return text;
}

/**
 * Check if element is likely navigation/footer content
 * Works across different website structures
 */
function isNavigationElement(element, debugLog = false) {
  // Check the element itself and all ancestors up to 5 levels
  let current = element;
  let depth = 0;
  const maxDepth = 5;

  while (current && depth < maxDepth) {
    // Check tag name - but 'header' tag is okay if it contains the article title
    const tagName = current.tagName?.toLowerCase() || '';
    if (['nav', 'footer', 'aside'].includes(tagName)) {
      if (debugLog) {
        debug.log(`         ⚠️ [Nav-Debug] Excluded due to tag: <${tagName}>`);
      }
      return true;
    }

    // Check classes and IDs
    const className = current.className?.toLowerCase() || '';
    const id = current.id?.toLowerCase() || '';
    const combinedAttrs = `${className} ${id}`;

    // Keywords that should match whole words only (to avoid false positives like "hasSidebars")
    const wordBoundaryKeywords = [
      'navigation', 'navbar', 'site-nav',
      'main-menu',
      'footer', 'site-footer',
      'sidebar', 'widget',
      'cookie', 'gdpr',
      'subscribe', 'newsletter', 'signup',
      'share-button',
      'promo', 'advertisement', 'ad-container', 'ad-slot',
      'banner', 'popup', 'modal',
      'breadcrumb', 'pagination',
      'search-form', 'search-box',
      'toolbar', 'masthead',
      'site-header', 'global-nav', 'utility-nav'
    ];

    // Keywords that should match as substrings (for patterns like "nav-menu", "menu-primary")
    const substringKeywords = [
      'nav-menu',
      'menu-', '-menu',
      'social-', 'related-', 'trending-', 'popular-', 'recommended-',
      'skip-to-', 'skip-link'
    ];

    // Check word-boundary keywords first (more precise)
    const wordBoundaryMatch = wordBoundaryKeywords.find(keyword => {
      const regex = new RegExp(`\\b${keyword}\\b`, 'i');
      return regex.test(combinedAttrs);
    });

    if (wordBoundaryMatch) {
      if (debugLog) {
        debug.log(`         ⚠️ [Nav-Debug] Excluded due to keyword (word-boundary): "${wordBoundaryMatch}"`);
        debug.log(`         ⚠️ [Nav-Debug] Found in: class="${current.className}" id="${current.id}"`);
      }
      return true;
    }

    // Check substring keywords (for hyphenated patterns)
    const substringMatch = substringKeywords.find(keyword => combinedAttrs.includes(keyword));
    if (substringMatch) {
      if (debugLog) {
        debug.log(`         ⚠️ [Nav-Debug] Excluded due to keyword (substring): "${substringMatch}"`);
        debug.log(`         ⚠️ [Nav-Debug] Found in: class="${current.className}" id="${current.id}"`);
      }
      return true;
    }

    // Check ARIA roles
    const role = current.getAttribute('role');
    const navRoles = ['navigation', 'complementary', 'contentinfo', 'search'];
    if (role && navRoles.includes(role.toLowerCase())) {
      if (debugLog) {
        debug.log(`         ⚠️ [Nav-Debug] Excluded due to ARIA role: "${role}"`);
      }
      return true;
    }

    // Move up to parent
    current = current.parentElement;
    depth++;
  }

  // Check for very short navigation-like text
  const text = element.textContent.trim();
  const words = text.split(/\s+/);
  if (words.length <= 2 && text.length < 30) {
    // Single/double word headings like "Browse World", "Latest News"
    const singleWordNavPatterns = [
      'browse', 'menu', 'search', 'login', 'signup', 'subscribe',
      'home', 'about', 'contact', 'privacy', 'terms', 'help',
      'latest', 'trending', 'popular', 'more', 'sponsored'
    ];
    if (singleWordNavPatterns.some(pattern => text.toLowerCase().includes(pattern))) {
      return true;
    }
  }

  return false;
}

/**
 * ============================================================================
 * LICENSE KEY VALIDATION
 * ============================================================================
 */

/**
 * Check if license is unlocked (either via admin key or valid customer license)
 */
async function isLicenseUnlocked() {
  try {
    const result = await chrome.storage.sync.get(['licenseKey', 'licenseValid']);

    // Check if license was validated via API
    if (result.licenseValid === true) {
      debug.log('✅ [License] Valid license key detected');
      return true;
    }

    debug.log('🔒 [License] No valid license - showing watermark');
    return false;
  } catch (error) {
    console.error('❌ [License] Error checking license:', error);
    return false; // Default to locked on error
  }
}

/**
 * Add watermark overlay to the page (only if license is not unlocked)
 */
async function addWatermarkOverlay() {
  // Check if already licensed
  const unlocked = await isLicenseUnlocked();
  if (unlocked) {
    debug.log('   ✅ [Watermark] License unlocked - skipping watermark');
    return;
  }

  debug.log('   🔒 [Watermark] Adding watermark overlay...');

  // Remove existing watermark if present
  const existing = document.getElementById('webmod-watermark-overlay');
  if (existing) {
    existing.remove();
  }

  // Create watermark overlay
  const overlay = document.createElement('div');
  overlay.id = 'webmod-watermark-overlay';
  overlay.innerHTML = `
    <style>
      #webmod-watermark-overlay {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        background: rgba(0, 0, 0, 0.95) !important;
        color: #ffffff !important;
        padding: 16px 20px !important;
        border-radius: 8px !important;
        border: 2px solid #00d4ff !important;
        z-index: 2147483646 !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        font-size: 13px !important;
        text-align: center !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1) inset !important;
        pointer-events: auto !important;
        line-height: 1.5 !important;
        max-width: 280px !important;
        cursor: pointer !important;
        transition: all 0.2s ease !important;
        backdrop-filter: blur(10px) !important;
      }

      #webmod-watermark-overlay:hover {
        background: rgba(0, 0, 0, 0.98) !important;
        border-color: #33ddff !important;
        box-shadow: 0 6px 28px rgba(0, 0, 0, 0.6), 0 0 20px rgba(0, 212, 255, 0.4) !important;
        transform: translateY(-2px) !important;
      }

      #webmod-watermark-overlay strong {
        display: block !important;
        font-size: 14px !important;
        font-weight: bold !important;
        margin-bottom: 6px !important;
        color: #ffffff !important;
      }

      #webmod-watermark-overlay small {
        display: block !important;
        font-size: 11px !important;
        color: #93c5fd !important;
        margin-top: 4px !important;
      }

      .webmod-altered-warning {
        display: block !important;
        text-align: center !important;
        padding: 12px 20px !important;
        margin: 20px auto !important;
        background: #fff3cd !important;
        border: 2px solid #ffc107 !important;
        border-radius: 6px !important;
        color: #856404 !important;
        font-weight: bold !important;
        font-size: 14px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        max-width: 500px !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1) !important;
      }
    </style>
    <div>
      <strong>⚠️ THIS ARTICLE HAS BEEN ALTERED</strong>
      <small>Click to purchase license</small>
    </div>
  `;

  // Append to body
  document.body.appendChild(overlay);

  // Add click handler to open Stripe purchase page
  overlay.addEventListener('click', () => {
    window.open('https://buy.stripe.com/fZu6oG6203vJgAI4Jaao800', '_blank');
  });

  // Store reference for cleanup
  watermarkOverlay = overlay;

  debug.log('   ✅ [Watermark] Watermark overlay added (clickable)');
}

/**
 * ============================================================================
 * CONTENT REPLACEMENT
 * ============================================================================
 */

/**
 * Replace page content with generated content
 */
async function replacePageContent(content, images, generatedUrl, replaceUrl, selectedImageSelectors) {
  try {
    // ⭐ Capture original URL BEFORE any modifications (for cache storage)
    const originalUrlBeforeChange = window.location.href;
    debug.log('   📍 [Replace] Captured original URL before modification:', originalUrlBeforeChange);

    // Replace URL first if requested
    if (replaceUrl && generatedUrl) {
      debug.log('   🔗 [Replace] Replacing URL...');
      debug.log('      Current URL:', window.location.href);
      debug.log('      Generated URL:', generatedUrl);
      debug.log('      replaceUrl flag:', replaceUrl);
      debug.log('      generatedUrl value:', generatedUrl);
      debug.log('      generatedUrl type:', typeof generatedUrl);

      try {
        const oldUrl = window.location.href;
        window.history.replaceState({}, '', generatedUrl);
        const newUrl = window.location.href;

        debug.log('   ✅ [Replace] history.replaceState() called');
        debug.log('      URL before:', oldUrl);
        debug.log('      URL after:', newUrl);
        debug.log('      Changed?', oldUrl !== newUrl);

        if (oldUrl === newUrl) {
          debug.warn('   ⚠️ [Replace] URL did not change! May be a relative path issue.');
        }
      } catch (urlError) {
        console.error('   ❌ [Replace] URL replacement failed:', urlError);
        console.error('   📍 [Replace] Error name:', urlError.name);
        console.error('   📍 [Replace] Error message:', urlError.message);
        console.error('   📍 [Replace] Error stack:', urlError.stack);
        // Continue anyway - URL replacement is optional
      }
    } else {
      debug.log('   ⏭️ [Replace] URL replacement skipped');
      debug.log('      replaceUrl:', replaceUrl);
      debug.log('      generatedUrl:', generatedUrl);
    }

    debug.log('   🔄 [Replace] Updating page title...');
    if (content.mainHeadline) {
      desiredTitle = content.mainHeadline;

      // Disconnect any lingering observers
      if (titleObserver) { titleObserver.disconnect(); titleObserver = null; }
      if (headObserver) { headObserver.disconnect(); headObserver = null; }

      // Signal the desired title via a DOM attribute (used by MAIN world lockTitle as backup)
      document.documentElement.setAttribute('data-ext-desired-title', desiredTitle);

      // Set title directly — content scripts share the DOM, identical to a DevTools Elements edit
      document.title = desiredTitle;
      titleDescriptorOverridden = true;
      debug.log(`   ✅ [Replace] Title set: "${desiredTitle}"`);

      // Watch <title> element for any subsequent resets (e.g. React Helmet re-run)
      const titleEl = document.querySelector('title');
      if (titleEl) {
        let isRestoringTitle = false;
        titleObserver = new MutationObserver(() => {
          if (isRestoringTitle) return;
          const desired = document.documentElement.getAttribute('data-ext-desired-title');
          if (desired && document.title !== desired) {
            isRestoringTitle = true;
            document.title = desired;
            isRestoringTitle = false;
            debug.log(`   🛡️ [TitleObserver] Restored title: "${desired.substring(0, 50)}"`);
          }
        });
        titleObserver.observe(titleEl, { childList: true, characterData: true, subtree: true });
        debug.log('   ✅ [TitleObserver] Title protection active');
      }

      // Watch <head> in case the <title> element itself is replaced
      headObserver = new MutationObserver((mutations) => {
        for (const m of mutations) {
          for (const node of m.addedNodes) {
            if (node.nodeName === 'TITLE') {
              const desired = document.documentElement.getAttribute('data-ext-desired-title');
              if (desired) document.title = desired;
              if (titleObserver) titleObserver.disconnect();
              let isRestoringTitle = false;
              titleObserver = new MutationObserver(() => {
                if (isRestoringTitle) return;
                const des = document.documentElement.getAttribute('data-ext-desired-title');
                if (des && document.title !== des) {
                  isRestoringTitle = true;
                  document.title = des;
                  isRestoringTitle = false;
                }
              });
              titleObserver.observe(node, { childList: true, characterData: true, subtree: true });
            }
          }
        }
      });
      headObserver.observe(document.head, { childList: true });

      // Also ask background to lock document.title in page context (blocks JS setter calls)
      chrome.runtime.sendMessage({ action: 'lockTitle', title: desiredTitle });
    }

    debug.log('   🏷️ [Replace] Updating meta tags...');
    // Update meta tags
    updateMetaTags(content);

    debug.log('   📝 [Replace] Replacing headings...');

    // Find content container ONCE for all heading/paragraph replacements
    // This ensures we only replace content within the article, not navigation/sidebar elements
    const contentRoot = findBestContentContainer('Replace');

    // Replace H1 headings — scope to contentRoot to avoid nav/sidebar h1s
    const h1Elements = (contentRoot || document).querySelectorAll('h1');
    if (h1Elements.length > 0 && content.mainHeadline) {
      h1Elements[0].textContent = content.mainHeadline;
      debug.log(`   ✅ [Replace] Updated H1: "${content.mainHeadline.substring(0, 50)}..."`);
    }

    // Replace article deck/subheader if present
    if (content.articleDeck) {
      const articleDeckSelectors = [
        '[data-testid="article-dek"]',
        '.article-dek',
        '.article-subhead',
        '.article-summary',
        '[class*="article-dek"]',
        '[class*="articleDek"]',         // CSS modules style (e.g., styles_articleDek__hash)
        '[class*="subheadline"]',
        '[class*="deck"]',
        'p.dek',
        '.standfirst'
      ];

      let deckElement = null;
      for (const selector of articleDeckSelectors) {
        deckElement = document.querySelector(selector);
        if (deckElement) {
          deckElement.textContent = content.articleDeck;
          debug.log(`   ✅ [Replace] Updated article deck: "${content.articleDeck.substring(0, 50)}..."`);
          break;
        }
      }

      if (!deckElement) {
        debug.log('   ℹ️ [Replace] Article deck in content but no element found on page to replace');
      }
    }

    // Replace H2 headings (within content container only)
    const h2Elements = contentRoot.querySelectorAll('h2');
    let h2Count = 0;
    content.subHeadlines.forEach((headline, index) => {
      if (h2Elements[index]) {
        h2Elements[index].textContent = headline;
        h2Count++;
      }
    });
    debug.log(`   ✅ [Replace] Updated ${h2Count} H2 headings`);

    // Replace H3 headings (within content container only)
    const h3Elements = contentRoot.querySelectorAll('h3');
    let h3Count = 0;
    content.sectionHeadings.forEach((heading, index) => {
      if (h3Elements[index]) {
        h3Elements[index].textContent = heading;
        h3Count++;
      }
    });
    debug.log(`   ✅ [Replace] Updated ${h3Count} H3 headings`);

    debug.log('   📄 [Replace] Replacing paragraphs...');

    // contentRoot already found above for heading replacement - reuse it
    const allPTags = contentRoot.querySelectorAll('p').length;

    // Priority 1: Try article-specific selectors FIRST (same order as analysis)
    const articleTextSelectors = [
      '.article-body p',                 // ESPN, many news sites
      '[data-testid="paragraph"]',       // Reuters
      '.story-body p',                   // BBC, common pattern
      '.story-content p',                // Common pattern
      '[class*="article-body"] p',       // Partial class match
      '[class*="ArticleBody"] p',        // Pascal case variant
      '[class*="story-content"] p',      // Story content variant
      '[class*="post-content"] p',       // Blog/post pattern
      '[class*="entry-content"] p',      // WordPress, blog pattern
      '[class*="paragraph"]'             // Generic paragraph class
    ];

    let paragraphs = [];
    for (const selector of articleTextSelectors) {
      const found = Array.from(contentRoot.querySelectorAll(selector)).filter(el => {
        const text = el.textContent.trim();
        return text.length > 30 && !isNavigationElement(el);
      });
      if (found.length > 0) {
        debug.log(`   ✅ [Replace] Found ${found.length} paragraphs with article-specific selector: ${selector}`);
        paragraphs = found;
        break;
      }
    }
    
    let imgElements = [];
    let captionElements = [];

    // Priority 2: Fall back to generic <p> tags only if no article-specific selectors worked
    if (paragraphs.length === 0) {
      debug.log('   ℹ️ [Replace] No article-specific selectors worked, trying generic <p> tags...');

      // Get author/byline/date elements to exclude from paragraphs (we skip these in replacement)
      const authorElements = document.querySelectorAll('[class*="author"], [class*="byline"], [itemprop="author"]');
      const dateElements = document.querySelectorAll('time, [class*="date"], [class*="published"]');
      const metadataElements = new Set([...authorElements, ...dateElements]);
      debug.log(`   🔍 [Replace] Excluding ${metadataElements.size} metadata elements (${authorElements.length} author, ${dateElements.length} date)`);

      // Debug: log what we're excluding
      if (metadataElements.size > 0 && metadataElements.size <= 5) {
        metadataElements.forEach(el => {
          debug.log(`   🚫 [Replace] Excluding metadata: <${el.tagName.toLowerCase()}> "${el.textContent.trim().substring(0, 60)}..."`);
        });
      }

      // Track filter statistics for debugging
      let excludedCount = 0;
      const filterStats = {
        tooShort: 0,
        navigation: 0,
        caption: 0,
        metadata: 0,
        authorContainer: 0,
        byline: 0,
        reportingFrom: 0
      };

      paragraphs = Array.from(contentRoot.querySelectorAll('p')).filter(p => {
        const text = p.textContent.trim();
        // Exclude paragraphs inside figcaption elements (those are captions, not article text)
        const isInsideCaption = p.closest('figcaption') !== null;
        // Exclude author/byline/date elements (these are metadata, not article paragraphs)
        const isMetadata = metadataElements.has(p);

        // Also exclude paragraphs that are inside author/byline containers
        // NYT structure: <div class="byline"><a>Authors</a></div><p>Author names</p>
        const isInsideAuthorContainer = p.closest('[class*="author"], [class*="byline"]') !== null;

        // Also exclude paragraphs that start with "By" and contain only author names/links
        // This catches byline paragraphs like: <p>By <a>Author 1</a>, <a>Author 2</a></p>
        const startsWithBy = text.startsWith('By ');
        const hasOnlyAuthorLinks = p.querySelectorAll('a').length >= 2 && p.querySelectorAll('a').length === text.split(/,|\sand\s/).length;
        const isAuthorByline = startsWithBy && (hasOnlyAuthorLinks || text.length < 200);

        // Also check for "Reporting from" paragraphs which are part of byline metadata
        const isReportingFrom = text.startsWith('Reporting from') && text.length < 100;

        // Check all conditions
        const tooShort = text.length <= 30;
        const isNav = !tooShort && isNavigationElement(p, excludedCount < 5); // Enable debug log for first 5

        const passes = !tooShort && !isNav && !isInsideCaption && !isMetadata && !isInsideAuthorContainer && !isAuthorByline && !isReportingFrom;

        // Debug logging for first 5 excluded paragraphs
        if (!passes) {
          excludedCount++;

          // Update filter stats
          if (tooShort) filterStats.tooShort++;
          else if (isNav) filterStats.navigation++;
          else if (isInsideCaption) filterStats.caption++;
          else if (isMetadata) filterStats.metadata++;
          else if (isInsideAuthorContainer) filterStats.authorContainer++;
          else if (isAuthorByline) filterStats.byline++;
          else if (isReportingFrom) filterStats.reportingFrom++;

          if (excludedCount <= 5) {
            debug.log(`   🚫 [Filter] Excluded paragraph ${excludedCount}: "${text.substring(0, 50)}..."`);
            debug.log(`      - Too short (≤30 chars): ${tooShort} [length=${text.length}]`);
            debug.log(`      - Is navigation: ${isNav}`);
            debug.log(`      - Inside caption: ${isInsideCaption}`);
            debug.log(`      - Is metadata: ${isMetadata}`);
            debug.log(`      - Inside author container: ${isInsideAuthorContainer}`);
            if (isInsideAuthorContainer) {
              const ancestorWithAuthor = p.closest('[class*="author"], [class*="byline"]');
              debug.log(`      - Ancestor class: "${ancestorWithAuthor?.className}"`);
            }
            debug.log(`      - Is author byline: ${isAuthorByline}`);
            debug.log(`      - Is reporting from: ${isReportingFrom}`);
          }
        }

        return passes;
      });

      // Log filter statistics
      debug.log(`   📊 [Filter] Exclusion summary:`);
      debug.log(`      - Too short: ${filterStats.tooShort}`);
      debug.log(`      - Navigation: ${filterStats.navigation}`);
      debug.log(`      - Caption: ${filterStats.caption}`);
      debug.log(`      - Metadata: ${filterStats.metadata}`);
      debug.log(`      - Author container: ${filterStats.authorContainer}`);
      debug.log(`      - Byline: ${filterStats.byline}`);
      debug.log(`      - Reporting from: ${filterStats.reportingFrom}`);
      debug.log(`      - Total excluded: ${excludedCount}`);

      debug.log(`   ✅ [Replace] Using generic <p> selector, found ${paragraphs.length} paragraphs (excluding metadata)`);
    }

    debug.log(`   📊 [Replace] Final paragraph count to replace: ${paragraphs.length}/${allPTags} total <p> tags`);

    // Check if license is unlocked
    const unlocked = await isLicenseUnlocked();

    let pCount = 0;
    content.paragraphs.forEach((paragraph, index) => {
      if (paragraphs[index]) {
        paragraphs[index].textContent = paragraph;
        pCount++;

        // Insert warning text every 3-4 paragraphs if unlicensed
        if (!unlocked && index > 0 && index % 3 === 0) {
          const warning = document.createElement('div');
          warning.className = 'webmod-altered-warning';
          warning.textContent = '[THIS ARTICLE HAS BEEN ALTERED]';
          paragraphs[index].insertAdjacentElement('afterend', warning);
          debug.log(`   🔒 [Replace] Inserted warning after paragraph ${index}`);
        }
      }
    });
    debug.log(`   ✅ [Replace] Updated ${pCount} paragraphs`);

    // Replace image captions (ALWAYS, whether images are generated or not)
    debug.log('   📷 [Replace] Replacing image captions...');
    if (content.imageCaptions && content.imageCaptions.length > 0) {
      // Find caption elements using same logic as analysis
      const captionSelectors = [
        'figcaption',
        '[data-testid*="Caption"]',
        '[data-testid*="caption"]',
        '[class*="ImageCaption"]',
        '[class*="imageCaption"]',
        '[class*="image-caption"]',
        '[class*="photo-caption"]',
        '[class*="caption"]'
      ];

      const allCaptionElements = [];
      for (const selector of captionSelectors) {
        const found = Array.from(document.querySelectorAll(selector));
        found.forEach(el => {
          if (!allCaptionElements.includes(el)) {
            allCaptionElements.push(el);
          }
        });
      }

      // Filter to match analysis criteria (matching analysis logic at line 779)
      captionElements = allCaptionElements.filter(caption => {
        // Try to get ONLY the main caption text, excluding credits (same as analysis)
        const mainCaptionEl = caption.querySelector('[class*="jevhma"], [class*="caption-text"], span:first-child');
        const text = mainCaptionEl ? mainCaptionEl.textContent.trim() : caption.textContent.trim();

        if (text.length < 30 || isNavigationElement(caption)) {
          return false;
        }
        const creditKeywords = ['credit', 'photo by', 'image by', 'getty images', 'ap photo'];
        const lowerText = text.toLowerCase();
        const isOnlyCredit = creditKeywords.some(keyword => lowerText.includes(keyword)) && text.length < 100;
        return !isOnlyCredit;
      });

      debug.log(`   📊 [Replace] Found ${captionElements.length} caption elements to replace`);
      debug.log(`   📊 [Replace] Have ${content.imageCaptions.length} transformed captions from LLM`);

      let captionCount = 0;
      content.imageCaptions.forEach((transformedCaption, index) => {
        // Validate that transformedCaption is a string
        if (!transformedCaption || typeof transformedCaption !== 'string') {
          debug.warn(`   ⚠️ [Replace] Caption ${index + 1} is not a valid string:`, typeof transformedCaption);
          return;
        }

        if (captionElements[index]) {
          // Try to preserve photo credits
          const originalText = captionElements[index].textContent;
          const creditMatch = originalText.match(/(credit[:\s]+.+|photo by[:\s]+.+)/i);

          // Find the main caption text element (usually first child or specific class)
          const mainCaptionEl = captionElements[index].querySelector('[class*="jevhma"], [class*="caption-text"], span:first-child') || captionElements[index];

          // Replace main caption text
          if (mainCaptionEl === captionElements[index]) {
            // If we're replacing the whole caption, append credit if it exists
            captionElements[index].textContent = transformedCaption + (creditMatch ? `\n\n${creditMatch[0]}` : '');
          } else {
            // If we found a specific caption text element, only replace that
            mainCaptionEl.textContent = transformedCaption;
          }

          captionCount++;
          const preview = transformedCaption.length > 60 ? transformedCaption.substring(0, 60) + '...' : transformedCaption;
          debug.log(`   ✅ [Replace] Updated caption ${index + 1}:`, preview);
        }
      });

      debug.log(`   ✅ [Replace] Updated ${captionCount} image captions`);
    } else {
      debug.log('   ℹ️ [Replace] No captions to replace');
    }

    // Replace images
    debug.log('   🖼️ [Replace] Replacing images...');
    if (images && images.length > 0) {
      debug.log('   📊 [Replace] Received', images.length, 'images from generation');
      images.forEach((img, idx) => {
        if (img.success) {
          const imageRef = img.storedLocally
            ? `IndexedDB: ${img.imageId}`
            : `URL: ${(img.url || '').substring(0, 50)}...`;
          debug.log(`   📷 [Replace] Image ${idx}: SUCCESS -`, imageRef);
        } else {
          debug.log(`   📷 [Replace] Image ${idx}: FAILED -`, img.error);
        }
      });
      imgElements = [];
      let videoItems = []; // video replacement items, populated below if user selected videos

      // If user manually selected images/videos, use those selectors
      if (selectedImageSelectors && selectedImageSelectors.length > 0) {
        // Split: image selectors vs video selectors (encoded as __VIDEO__:w:h:cssSelector)
        const imageOnlySelectors = selectedImageSelectors.filter(s => !s.startsWith('__VIDEO__'));
        videoItems = selectedImageSelectors
          .filter(s => s.startsWith('__VIDEO__'))
          .map(s => {
            const payload = s.slice('__VIDEO__:'.length);
            const parts = payload.split(':');
            const width = parseInt(parts[0]);
            const height = parseInt(parts[1]);
            const selector = parts.slice(2).join(':');
            return { width, height, selector };
          });
        debug.log('   🎯 [Replace] Using manually selected images:', imageOnlySelectors.length, '+ videos:', videoItems.length);
        debug.log('   📋 [Replace] Image selectors:', imageOnlySelectors);
        debug.log('   🎬 [Replace] Video items:', videoItems);
        imgElements = imageOnlySelectors
          .map((selector, idx) => {
            let img = document.querySelector(selector);
            if (!img) {
              debug.warn(`   ⚠️ [Replace] Selector ${idx} not found: ${selector}`);

              // 🔍 DEBUG: Log DOM state to help diagnose selector failures
              debug.log('   🔍 [Replace] Debugging selector failure:');
              debug.log('      Document ready state:', document.readyState);
              debug.log('      Total elements in document:', document.querySelectorAll('*').length);

              // 🔧 FUZZY FALLBACK: Try to find similar elements
              const parts = selector.split('>').map(p => p.trim());
              const lastPart = parts[parts.length - 1];
              debug.log('      Looking for similar elements with tag:', lastPart);
              const similarElements = document.querySelectorAll(lastPart);
              debug.log('      Found', similarElements.length, 'elements matching', lastPart);

              // If the selector was for a picture element and we found some, use the first one
              if (lastPart === 'picture' && similarElements.length > 0) {
                debug.log('   🔧 [Replace] Using fuzzy fallback: selecting first', lastPart, 'element');
                img = similarElements[idx] || similarElements[0]; // Try to use same index, or first one
              }
            } else {
              debug.log(`   ✓ [Replace] Selector ${idx} matched:`, selector);
            }
            return img;
          })
          .filter(img => img !== null);  // Filter out any that don't exist
        debug.log(`   ✓ [Replace] Found ${imgElements.length} selected images on page`);
      }
      // Otherwise, auto-detect images (fallback)
      else {
        debug.log('   🔍 [Replace] Auto-detecting images...');
        imgElements = Array.from(document.querySelectorAll('img')).filter(img => {
          // Use computed style dimensions instead of naturalWidth/naturalHeight
          const computedStyle = window.getComputedStyle(img);
          const width = parseInt(computedStyle.width) || 0;
          const height = parseInt(computedStyle.height) || 0;
          const isVisible = computedStyle.display !== 'none' && computedStyle.visibility !== 'hidden';

          // Also accept images that were lazy-loaded (might not have dimensions yet)
          const wasLazy = img.hasAttribute('loading') || img.hasAttribute('data-src') || img.hasAttribute('data-srcset');

          // Accept if: (has proper size AND visible) OR (was lazy-loaded AND visible)
          return (width > 100 && height > 100 && isVisible) || (wasLazy && isVisible);
        });
        debug.log(`   ✓ [Replace] Auto-detected ${imgElements.length} images`);
      }

      let imgCount = 0;
      for (let index = 0; index < images.length; index++) {
        const imageData = images[index];
        if (imgElements[index] && imageData.success) {
          let img = imgElements[index];

          // Safety check: ensure we have an actual img element
          // If selector matched a wrapper (picture, div, etc), find the img inside it
          if (img.tagName !== 'IMG') {
            debug.log(`   🔍 [Replace] Selector ${index} matched ${img.tagName}, searching for img inside...`);

            // First try: look for img inside the element
            let imgInside = img.querySelector('img');

            // Second try: if it's a PICTURE element, check siblings
            if (!imgInside && img.tagName === 'PICTURE') {
              debug.log(`   🔍 [Replace] No img inside PICTURE, checking siblings...`);
              let sibling = img.nextElementSibling;
              while (sibling && !imgInside) {
                if (sibling.tagName === 'IMG') {
                  imgInside = sibling;
                  debug.log(`   ✓ [Replace] Found img as next sibling of PICTURE`);
                  break;
                }
                sibling = sibling.nextElementSibling;
              }
            }

            if (imgInside) {
              img = imgInside;
              debug.log(`   ✓ [Replace] Using img element found via ${img.tagName}`);
            } else {
              console.error(`   ❌ [Replace] No img found for ${img.tagName}, skipping`);
              continue;
            }
          }

          const oldSrc = img.src || '';

          // Get image URL (either blob URL from IndexedDB or temporary DALL-E URL)
          let newUrl;
          if (imageData.storedLocally && imageData.imageId) {
            // Retrieve blob URL from IndexedDB
            debug.log(`   💾 [Replace] Retrieving local image: ${imageData.imageId}`);
            try {
              const response = await chrome.runtime.sendMessage({
                action: 'getImageBlobUrl',
                imageId: imageData.imageId
              });

              if (response && response.blobUrl) {
                newUrl = response.blobUrl;
                debug.log(`   ✅ [Replace] Retrieved data URL from IndexedDB (${(newUrl.length / 1024).toFixed(1)} KB)`);
              } else {
                console.error(`   ❌ [Replace] Failed to retrieve image from IndexedDB`);
                debug.log(`   ⏭️ [Replace] Skipping image ${index + 1}`);
                continue;
              }
            } catch (error) {
              console.error(`   ❌ [Replace] Error retrieving image:`, error);
              debug.log(`   ⏭️ [Replace] Skipping image ${index + 1}`);
              continue;
            }
          } else {
            // Use temporary DALL-E URL
            newUrl = imageData.url || '';
          }

          debug.log(`   🔄 [Replace] Changing image ${index}:`, oldSrc.substring(0, Math.min(60, oldSrc.length)) + (oldSrc.length > 60 ? '...' : ''));
          debug.log(`   🔄 [Replace] New URL:`, newUrl.substring(0, Math.min(60, newUrl.length)) + (newUrl.length > 60 ? '...' : ''));

          // Capture rendered dimensions before swapping src so layout is preserved
          const origComputedStyle = window.getComputedStyle(img);
          const origWidth = parseInt(origComputedStyle.width) || 0;
          const origHeight = parseInt(origComputedStyle.height) || 0;

          // Try multiple methods to update the image
          img.src = newUrl;
          img.setAttribute('src', newUrl);
          img.srcset = ''; // Clear srcset to prevent it from overriding
          img.removeAttribute('srcset');

          // Remove lazy loading attributes to prevent reversion when scrolled into view
          img.removeAttribute('data-src');        // Lazy load source URL
          img.removeAttribute('data-srcset');     // Lazy load srcset URLs
          img.removeAttribute('loading');         // loading="lazy" attribute
          img.removeAttribute('data-sizes');      // Lazy load sizes
          img.removeAttribute('data-original');   // Another lazy load variant
          // Remove common lazy loading classes
          img.classList.remove('lazy', 'lazyload', 'lazyloaded', 'lazy-load-pending');

          // If inside a picture element, update source elements too
          const picture = img.closest('picture');
          if (picture) {
            debug.log(`   📸 [Replace] Image is in <picture>, removing <source> elements`);
            picture.querySelectorAll('source').forEach(source => source.remove());
          }

          img.alt = imageData.prompt || content.mainHeadline;

          // Constrain replacement image to original dimensions (DALL-E is 1024x1024)
          if (origWidth > 0 && origHeight > 0) {
            img.style.width = origWidth + 'px';
            img.style.height = origHeight + 'px';
            img.style.objectFit = 'cover';
          }

          // Caption replacement is handled separately above (lines 1547-1621)
          // to ensure ALL captions are replaced regardless of image replacement

          imgCount++;

          const finalSrc = img.src || '';
          debug.log(`   ✅ [Replace] Updated image ${index + 1}/${images.length}, new src:`, finalSrc.substring(0, Math.min(60, finalSrc.length)) + (finalSrc.length > 60 ? '...' : ''));
        } else if (imageData && !imageData.success) {
          debug.log(`   ⚠️ [Replace] Skipped image ${index + 1} (generation failed)`);
        } else if (!imgElements[index]) {
          debug.log(`   ⚠️ [Replace] No image element found at index ${index}`);
        }
      }
      debug.log(`   ✅ [Replace] Replaced ${imgCount}/${images.length} images`);

      // Replace selected video elements with AI-generated images
      if (videoItems.length > 0) {
        const videoImageOffset = imgElements.length;
        for (let idx = 0; idx < videoItems.length; idx++) {
          const item = videoItems[idx];
          const videoEl = document.querySelector(item.selector);
          if (!videoEl) {
            debug.warn(`   ⚠️ [Replace] Video selector not found: ${item.selector}`);
            continue;
          }
          const imageData = images[videoImageOffset + idx] || images[idx % images.length];
          if (!imageData?.success) {
            debug.warn(`   ⚠️ [Replace] No image data for video slot ${idx}`);
            continue;
          }
          let newUrl;
          if (imageData.storedLocally && imageData.imageId) {
            try {
              const response = await chrome.runtime.sendMessage({ action: 'getImageBlobUrl', imageId: imageData.imageId });
              if (response && response.blobUrl) {
                newUrl = response.blobUrl;
              } else {
                debug.warn(`   ⚠️ [Replace] Failed to retrieve video image from IndexedDB`);
                continue;
              }
            } catch (error) {
              debug.warn(`   ⚠️ [Replace] Error retrieving video image:`, error);
              continue;
            }
          } else {
            newUrl = imageData.url || '';
          }
          const img = document.createElement('img');
          img.src = newUrl;
          img.setAttribute('src', newUrl);
          img.style.cssText = `width:${item.width}px;height:${item.height}px;object-fit:cover;display:block;`;
          img.alt = content?.mainHeadline || 'article image';
          videoEl.replaceWith(img);
          imgCount++;
          debug.log(`   ✅ [Replace] Video ${idx} replaced with image at ${item.width}x${item.height}`);
        }
      }
    } else {
      debug.log('   ⏭️ [Replace] No images to replace');
    }

    // Skip author and date replacement - these are metadata that never change
    // The original DOM preserves links, formatting, and spacing better than replacement
    debug.log('   ⏭️ [Replace] Skipping author and date (metadata preserved from original)');

    // Set up MutationObserver to prevent page JavaScript from reverting our changes
    debug.log('   🔍 [Replace] Setting up MutationObserver to protect replacements...');
    setupContentProtectionObserver(imgElements, images, captionElements, content.imageCaptions);

    // Protect replaced text (headings + paragraphs) from React re-renders
    const protectedText = new Map();
    if (h1Elements[0] && content.mainHeadline) {
      protectedText.set(h1Elements[0], content.mainHeadline);
    }
    content.subHeadlines.forEach((headline, i) => {
      if (h2Elements[i]) protectedText.set(h2Elements[i], headline);
    });
    content.sectionHeadings.forEach((heading, i) => {
      if (h3Elements[i]) protectedText.set(h3Elements[i], heading);
    });
    content.paragraphs.forEach((text, i) => {
      if (paragraphs[i]) protectedText.set(paragraphs[i], text);
    });

    if (protectedText.size > 0 && contentRoot) {
      if (textObserver) textObserver.disconnect();
      let isRestoringText = false;
      textObserver = new MutationObserver(() => {
        if (isRestoringText) return;
        isRestoringText = true;
        protectedText.forEach((text, el) => {
          if (document.contains(el) && el.textContent !== text) {
            debug.log(`   🛡️ [Observer] Restored text: "${text.substring(0, 40)}..."`);
            el.textContent = text;
          }
        });
        isRestoringText = false;
      });
      textObserver.observe(contentRoot, { subtree: true, childList: true, characterData: true });
      debug.log(`   ✅ [Observer] Text protection active for ${protectedText.size} elements`);
    }

    // Add watermark overlay if unlicensed
    await addWatermarkOverlay();

    debug.log('   ✅ [Replace] Content replacement complete');

    // ⭐ Return original URL so background script can save it correctly to cache
    return {
      success: true,
      originalUrl: originalUrlBeforeChange
    };

  } catch (error) {
    console.error('   ❌ [Replace] Error replacing content:', error);
    console.error('   📍 [Replace] Error details:', error.message);
    console.error('   📚 [Replace] Stack trace:', error.stack);
    return { success: false, error: error.message || error.toString() || 'Unknown error' };
  }
}

/**
 * Set up MutationObserver to protect replaced content from being reverted by page JavaScript
 */
function setupContentProtectionObserver(imgElements, images, captionElements, imageCaptions) {
  // Store the replaced values for each element
  const protectedElements = new Map();

  // Track images
  if (imgElements && images) {
    images.forEach((imageData, index) => {
      if (imgElements[index] && imageData.success) {
        let img = imgElements[index];

        // Find actual img element (same logic as replacement)
        if (img.tagName !== 'IMG') {
          const imgInside = img.querySelector('img');
          if (imgInside) {
            img = imgInside;
          }
        }

        if (img.tagName === 'IMG') {
          // Watch the parent container (picture/figure) for child replacements
          const parent = img.closest('picture, figure') || img.parentElement;

          protectedElements.set(parent, {
            type: 'image-container',
            img: img,
            src: img.src,  // Read actual src from DOM (works for both local IndexedDB and temporary DALL-E URLs)
            alt: imageData.prompt || ''
          });
        }
      }
    });
  }

  // Track captions
  if (captionElements && imageCaptions) {
    imageCaptions.forEach((captionText, index) => {
      if (captionElements[index]) {
        const captionEl = captionElements[index];
        const mainCaptionEl = captionEl.querySelector('[class*="jevhma"], [class*="caption-text"], span:first-child');
        const targetEl = mainCaptionEl || captionEl;

        protectedElements.set(targetEl, {
          type: 'caption',
          text: captionText
        });
      }
    });
  }

  debug.log(`   ✅ [Observer] Protecting ${protectedElements.size} elements from reversion`);

  // Create observer to watch for changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      const target = mutation.target;

      // Check if this is a protected element, or if the target is a child of a protected element
      let protection = null;
      let protectedElement = null;

      if (protectedElements.has(target)) {
        protection = protectedElements.get(target);
        protectedElement = target;
      } else {
        // Check if target is a child of a protected element (for img inside picture)
        let parent = target.parentElement;
        while (parent) {
          if (protectedElements.has(parent)) {
            protection = protectedElements.get(parent);
            protectedElement = parent;
            break;
          }
          parent = parent.parentElement;
        }
      }

      if (protection) {
        if (protection.type === 'image-container') {
          // Check if img was replaced or its attributes changed
          if (mutation.type === 'childList') {
            // Image element might have been removed/replaced
            const currentImg = protectedElement.querySelector('img');
            if (currentImg && currentImg.src !== protection.src) {
              debug.log('   🔒 [Observer] Restoring replaced image');
              currentImg.src = protection.src;
              currentImg.setAttribute('src', protection.src);
              currentImg.srcset = '';
              currentImg.removeAttribute('srcset');
              currentImg.alt = protection.alt;
              // Remove any <source> elements that might have been re-added
              const picture = currentImg.closest('picture');
              if (picture) {
                picture.querySelectorAll('source').forEach(source => source.remove());
              }
            }
          } else if (mutation.type === 'attributes') {
            // NYT is modifying srcset/src on the existing img element
            const currentImg = target.tagName === 'IMG' ? target : protectedElement.querySelector('img');
            if (currentImg) {
              if (currentImg.getAttribute('srcset') !== null && currentImg.getAttribute('srcset') !== '') {
                debug.log('   🔒 [Observer] Removing re-added srcset attribute');
                currentImg.srcset = '';
                currentImg.removeAttribute('srcset');
              }
              if (currentImg.src !== protection.src) {
                debug.log('   🔒 [Observer] Restoring reverted src attribute');
                currentImg.src = protection.src;
                currentImg.setAttribute('src', protection.src);
              }
              if (currentImg.alt !== protection.alt) {
                debug.log('   🔒 [Observer] Restoring reverted alt attribute');
                currentImg.alt = protection.alt;
              }

              // Also remove lazy loading attributes if NYT tries to re-add them
              if (currentImg.hasAttribute('data-src') || currentImg.hasAttribute('data-srcset')) {
                debug.log('   🔒 [Observer] Removing re-added lazy loading attributes');
                currentImg.removeAttribute('data-src');
                currentImg.removeAttribute('data-srcset');
                currentImg.removeAttribute('data-sizes');
                currentImg.removeAttribute('data-original');
                currentImg.removeAttribute('loading');
              }
            }
          }
        } else if (protection.type === 'caption') {
          // Check if caption text was reverted (can be characterData OR childList mutation)
          if (mutation.type === 'characterData' || mutation.type === 'childList') {
            const currentText = target.textContent.trim();
            if (currentText !== protection.text) {
              debug.log('   🔒 [Observer] Restoring reverted caption text');
              target.textContent = protection.text;
            }
          }
        }
      }

      // Also check children of protected elements
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            // Check if any protected element is being replaced
            protectedElements.forEach((protection, element) => {
              if (!document.contains(element)) {
                debug.log('   ⚠️ [Observer] Protected element removed from DOM, reattaching not supported');
              }
            });
          }
        });
      }
    });
  });

  // Observe each protected element
  protectedElements.forEach((protection, element) => {
    if (protection.type === 'image-container') {
      observer.observe(element, {
        attributes: true,         // Watch attribute changes on descendants
        attributeFilter: ['src', 'srcset'],  // Only watch these attributes for performance
        childList: true,          // Watch for img removal/replacement
        subtree: true             // Watch descendants (the actual img element)
      });
    } else if (protection.type === 'caption') {
      observer.observe(element, {
        attributes: false,
        characterData: true,
        childList: true,
        subtree: true
      });
    }
  });

  debug.log('   ✅ [Observer] MutationObserver active and monitoring');
}

/**
 * Update meta tags with new content
 */
function updateMetaTags(content) {
  // Update description meta tag
  const descriptionMeta = document.querySelector('meta[name="description"]');
  if (descriptionMeta && content.paragraphs[0]) {
    descriptionMeta.setAttribute('content', content.paragraphs[0].substring(0, 160));
  }

  // Update Open Graph tags
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle) {
    ogTitle.setAttribute('content', content.mainHeadline);
  }

  const ogDescription = document.querySelector('meta[property="og:description"]');
  if (ogDescription && content.paragraphs[0]) {
    ogDescription.setAttribute('content', content.paragraphs[0].substring(0, 200));
  }

  // Update Twitter card tags
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle) {
    twitterTitle.setAttribute('content', content.mainHeadline);
  }

  const twitterDescription = document.querySelector('meta[name="twitter:description"]');
  if (twitterDescription && content.paragraphs[0]) {
    twitterDescription.setAttribute('content', content.paragraphs[0].substring(0, 200));
  }
}

/**
 * Add a visual watermark to indicate transformed content
 */
function addWatermark(topic) {
  // Remove existing watermark if present
  const existing = document.getElementById('webmod-watermark');
  if (existing) {
    existing.remove();
  }

  // Create watermark element
  const watermark = document.createElement('div');
  watermark.id = 'webmod-watermark';
  watermark.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: linear-gradient(135deg, #00d4ff 0%, #0ea5e9 100%);
      color: #0a0e17;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(0, 212, 255, 0.3);
      z-index: 999999;
      cursor: pointer;
    " title="Click to remove">
      ✨ AI-Transformed: ${topic.substring(0, 40)}${topic.length > 40 ? '...' : ''}
    </div>
  `;

  // Click to remove
  watermark.addEventListener('click', () => {
    watermark.remove();
  });

  document.body.appendChild(watermark);
}

/**
 * Reset page to original content
 */
function resetPage() {
  if (originalContent) {
    debug.log('🔙 [Reset] Restoring original content...');

    // Restore original URL if it was changed
    if (window.location.href !== originalContent.url) {
      debug.log('   🔗 [Reset] Restoring original URL...');
      debug.log('      Current:', window.location.href);
      debug.log('      Original:', originalContent.url);
      try {
        window.history.replaceState({}, '', originalContent.url);
        debug.log('   ✅ [Reset] URL restored');
      } catch (error) {
        console.error('   ⚠️ [Reset] URL restoration failed:', error.message);
      }
    }

    // Disconnect title observers before restoring
    if (titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
      debug.log('   🛡️ [Reset] Title observer disconnected');
    }
    if (headObserver) {
      headObserver.disconnect();
      headObserver = null;
      debug.log('   🛡️ [Reset] Head observer disconnected');
    }
    if (textObserver) {
      textObserver.disconnect();
      textObserver = null;
      debug.log('   🛡️ [Reset] Text protection observer disconnected');
    }

    // Restore original document.title descriptor so React Helmet resumes control
    if (titleDescriptorOverridden) {
      document.documentElement.removeAttribute('data-ext-desired-title');
      chrome.runtime.sendMessage({ action: 'unlockTitle' }); // fire-and-forget
      titleDescriptorOverridden = false;
      desiredTitle = null;
      debug.log('   🛡️ [Reset] Title lock removed');
    }

    document.title = originalContent.title;
    document.body.replaceWith(originalContent.body.cloneNode(true));

    debug.log('   ✅ [Reset] Content restored');

    // Remove watermark overlay if present
    if (watermarkOverlay && watermarkOverlay.parentNode) {
      watermarkOverlay.remove();
      watermarkOverlay = null;
      debug.log('   🗑️ [Reset] Watermark removed');
    }

    // Also check for and remove any orphaned watermark
    const orphanedWatermark = document.getElementById('webmod-watermark-overlay');
    if (orphanedWatermark) {
      orphanedWatermark.remove();
      debug.log('   🗑️ [Reset] Orphaned watermark removed');
    }

    // Remove any warning text elements
    const warnings = document.querySelectorAll('.webmod-altered-warning');
    warnings.forEach(warning => warning.remove());
    if (warnings.length > 0) {
      debug.log(`   🗑️ [Reset] Removed ${warnings.length} warning text elements`);
    }

    // Re-save original content after reset
    saveOriginalContent();
  }
}

/**
 * ============================================================================
 * IMAGE SELECTION MODE
 * Allow user to manually select which images to replace
 * ============================================================================
 */

let imageSelectionState = {
  active: false,
  selectedImages: [],
  overlay: null,
  topBar: null,
  overlayProtector: null,
  videoClickInterceptor: null,
  styleTag: null,
  bodyPaddingGuard: null,
  imagePrompts: new Map(),       // el → custom prompt string
  useModifiedDesc: new Map(),    // el → boolean
  disabledPointerActions: null,  // elements with pointer-events disabled during selection
};

// WeakMap to store wrapper click handlers so they can be removed during cleanup
const wrapperClickHandlers = new WeakMap();

/**
 * Start interactive image selection mode
 */
async function startImageSelectionMode(tabId) {
  return new Promise(async (resolve, reject) => {
    try {
      debug.log('   🎨 [ImageSelect] Initializing overlay...');
      debug.log('   📍 [ImageSelect] Tab ID:', tabId);

      // Filter out non-content images: data: URI placeholders and truly invisible (0x0) images
      const filterImages = (imgs) => imgs.filter(img => {
        const src = img.getAttribute('src') || '';
        if (src.startsWith('data:')) return false;
        const r = img.getBoundingClientRect();
        const w = r.width || img.naturalWidth;
        const h = r.height || img.naturalHeight;
        if (w === 0 && h === 0) return false;
        return true;
      });

      // Find all images on the page with retry logic for dynamically loaded content
      let allImages = filterImages(Array.from(document.querySelectorAll('img')));
      debug.log(`   📸 [ImageSelect] Found ${allImages.length} images (initial scan)`);

      // Retry if no images found (handles lazy-loaded images)
      if (allImages.length === 0) {
        debug.log('   ⏳ [ImageSelect] No images found, waiting 500ms for dynamic content...');
        await new Promise(resolve => setTimeout(resolve, 500));
        allImages = filterImages(Array.from(document.querySelectorAll('img')));
        debug.log(`   📸 [ImageSelect] Found ${allImages.length} images (after retry)`);
      }

      // Detect div-based video containers (ESPN, JW Player, video.js, etc.) + native <video>/<iframe>
      // Avoid overly broad class patterns — use specific framework classes only
      const VIDEO_DIV_SELECTOR = [
        '[class*="Media--video"]',    // ESPN legacy
        '[class*="VideoPlayer"]',     // generic React/Vue player components (also matches WatchVideoPlayer)
        '[class*="WebPlayerContainer"]', // ESPN disney-web-player wrapper div
        'disney-web-player',          // ESPN disney-web-player custom element
        '[class*="ClipsPlayer"]',     // ESPN clips
        '.video-js',                  // Video.js
        '.jwplayer',                  // JW Player
      ].join(', ');

      // Find all candidates (div containers + native video/iframe)
      const videoCandidates = Array.from(document.querySelectorAll(
        VIDEO_DIV_SELECTOR + ', video, iframe[src*="youtube"], iframe[src*="youtu.be"], iframe[src*="vimeo"]'
      )).filter(el => {
        const r = el.getBoundingClientRect();
        // Custom elements (e.g. disney-web-player) may have 0 getBoundingClientRect if
        // the outer wrapper has no intrinsic height — fall back to offsetWidth/offsetHeight
        const w = r.width || el.offsetWidth;
        const h = r.height || el.offsetHeight;
        if (w < 200 || h < 100) return false;
        if (el.tagName === 'IFRAME') return w / h > 1.0;
        return true;
      });

      // Deduplicate: prefer div containers over native <video>/<iframe> for overlay injection.
      // <video> elements can't have child divs injected into them, so when a wrapping div
      // candidate also exists, keep the div and discard the video/iframe.
      const candidateSet = new Set(videoCandidates);
      const videoContainers = videoCandidates.filter(el => {
        const isNativeMedia = el.tagName === 'VIDEO' || el.tagName === 'IFRAME';
        if (isNativeMedia) {
          // Discard native media element if any div candidate wraps it
          return !Array.from(candidateSet).some(
            other => other !== el && other.contains(el) &&
                     other.tagName !== 'VIDEO' && other.tagName !== 'IFRAME'
          );
        } else {
          // For div containers: discard if another div candidate is nested inside (keep innermost div)
          return !Array.from(candidateSet).some(
            other => other !== el && el.contains(other) &&
                     other.tagName !== 'VIDEO' && other.tagName !== 'IFRAME'
          );
        }
      });

      // Disable pointer-actions custom elements (ESPN's click-intercepting shadow DOM overlay)
      // so they don't capture clicks that should go to our selection overlays.
      const pointerActionEls = Array.from(document.querySelectorAll('pointer-actions'));
      pointerActionEls.forEach(pa => {
        pa._webmodOrigPointerEvents = pa.style.pointerEvents;
        pa.style.setProperty('pointer-events', 'none', 'important');
      });
      imageSelectionState.disabledPointerActions = pointerActionEls;

      // For each video container, inject a transparent intercepting overlay div.
      // Use position:fixed overlays appended to document.body — this bypasses z-index
      // stacking issues with shadow DOM players (e.g. disney-web-player / pointer-actions)
      // and avoids problems with containers that have overflow:hidden or 0 intrinsic height.
      // transform:translateZ(0) forces a compositing layer above video hardware layers.
      const videoOverlayEntries = []; // { overlay, el } for scroll repositioning

      videoContainers.forEach((el, idx) => {
        const r = el.getBoundingClientRect();
        const w = r.width || el.offsetWidth;
        const h = r.height || el.offsetHeight;
        el.dataset.webmodType = 'video';
        el.dataset.webmodVideoWidth = Math.round(w);
        el.dataset.webmodVideoHeight = Math.round(h);
        el.dataset.webmodImageIndex = allImages.length + idx;
        el.classList.add('webmod-selectable-image');

        const interceptOverlay = document.createElement('div');
        interceptOverlay.className = 'webmod-video-intercept';
        interceptOverlay.style.cssText =
          `position:fixed;top:${r.top}px;left:${r.left}px;width:${w}px;height:${h}px;` +
          'z-index:2147483647;cursor:pointer;background:rgba(0,0,0,0.01);transform:translateZ(0);';

        const handleVideoClick = (e) => {
          e.stopPropagation();
          e.preventDefault();
          const container = el;
          const isSelected = container.classList.contains('selected');
          if (isSelected) {
            container.classList.remove('selected');
            // Remove checkmark overlay from body
            document.querySelectorAll('.webmod-image-checkmark').forEach(ck => {
              if (ck.dataset.webmodContainerIndex === container.dataset.webmodImageIndex) ck.remove();
            });
            imageSelectionState.selectedImages = imageSelectionState.selectedImages.filter(s => s !== container);
          } else {
            container.classList.add('selected');
            // Append checkmark as a fixed-position body element aligned to this overlay
            const checkmark = document.createElement('div');
            checkmark.className = 'webmod-image-checkmark';
            checkmark.innerHTML = '✓';
            checkmark.dataset.webmodImageIndex = container.dataset.webmodImageIndex;
            checkmark.dataset.webmodContainerIndex = container.dataset.webmodImageIndex;
            checkmark.style.cssText =
              `position:fixed;top:${r.top + 4}px;left:${r.left + 4}px;z-index:2147483647;` +
              'pointer-events:none;transform:translateZ(0);';
            document.body.appendChild(checkmark);
            imageSelectionState.selectedImages.push(container);
          }
          updateSelectedCount();
        };

        interceptOverlay.addEventListener('click', handleVideoClick);
        interceptOverlay.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); });
        interceptOverlay.addEventListener('mousedown', (e) => { e.stopPropagation(); e.preventDefault(); });

        document.body.appendChild(interceptOverlay);
        videoOverlayEntries.push({ overlay: interceptOverlay, el });
      });

      // Reposition fixed overlays on scroll so they track their video containers
      const videoScrollHandler = () => {
        videoOverlayEntries.forEach(({ overlay, el }) => {
          const rect = el.getBoundingClientRect();
          overlay.style.top = rect.top + 'px';
          overlay.style.left = rect.left + 'px';
        });
      };
      window.addEventListener('scroll', videoScrollHandler, { passive: true, capture: true });
      imageSelectionState.videoClickInterceptor = videoScrollHandler;

      debug.log(`   🎬 [ImageSelect] Found ${videoContainers.length} video containers`);

      // allSelectables is images only — video containers handled via intercept overlays
      const allSelectables = [...allImages];

      // Final check - if still no selectables, show error notification
      if (allImages.length === 0 && videoContainers.length === 0) {
        console.error('   ❌ [ImageSelect] No images or videos found on this page');
        showImageSelectionError('No images or videos found on this page. Content may be loading - please wait and try again.');
        reject(new Error('No images found on this page'));
        return;
      }

      // Inject CSS into <head> for image selection styles + compact bottom-right widget
      const styleTag = document.createElement('style');
      styleTag.id = 'webmod-image-selector-styles';
      styleTag.textContent = `
        #webmod-selector-widget {
          position: fixed !important;
          bottom: 24px !important;
          right: 24px !important;
          top: auto !important;
          left: auto !important;
          width: 280px !important;
          background: linear-gradient(135deg, #0a0e17 0%, #151b2b 100%) !important;
          border: 2px solid #00d4ff !important;
          border-radius: 12px !important;
          padding: 12px 16px !important;
          display: flex !important;
          flex-direction: column !important;
          align-items: stretch !important;
          gap: 8px !important;
          z-index: 2147483647 !important;
          box-shadow: 0 4px 24px rgba(0, 212, 255, 0.3) !important;
          pointer-events: auto !important;
          margin: 0 !important;
          transform: none !important;
          box-sizing: border-box !important;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        }
        #webmod-selector-info {
          color: #e2e8f0;
          font-size: 13px;
          white-space: nowrap;
        }
        #webmod-selector-info strong {
          color: #00d4ff;
          font-size: 15px;
        }
        #webmod-selector-buttons {
          display: flex;
          gap: 8px;
        }
        .webmod-selector-btn {
          padding: 8px 14px;
          border: none;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        .webmod-selector-btn-done {
          background: #00d4ff;
          color: #0a0e17;
        }
        .webmod-selector-btn-done:hover { background: #0ea5e9; }
        .webmod-selector-btn-clear {
          background: rgba(251, 191, 36, 0.2);
          color: #fbbf24;
          border: 1px solid rgba(251, 191, 36, 0.4);
        }
        .webmod-selector-btn-clear:hover { background: rgba(251, 191, 36, 0.35); }
        .webmod-selector-btn-cancel {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border: 1px solid rgba(239, 68, 68, 0.4);
        }
        .webmod-selector-btn-cancel:hover { background: rgba(239, 68, 68, 0.35); }
        .webmod-selectable-image {
          cursor: pointer !important;
          transition: outline 0.15s ease !important;
          pointer-events: all !important;
          z-index: 1000001 !important;
        }
        .webmod-image-wrapper {
          cursor: pointer !important;
          pointer-events: all !important;
          position: relative !important;
          z-index: 1000000 !important;
        }
        .webmod-selectable-image:hover {
          outline: 3px solid #00d4ff !important;
          outline-offset: 3px !important;
        }
        .webmod-selectable-image.selected {
          outline: 4px solid #00d4ff !important;
          outline-offset: 3px !important;
          box-shadow: 0 0 16px rgba(0, 212, 255, 0.5) !important;
        }
        .webmod-image-checkmark {
          position: absolute;
          top: 6px;
          right: 6px;
          width: 28px;
          height: 28px;
          background: #00d4ff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          color: #0a0e17;
          font-weight: bold;
          box-shadow: 0 2px 8px rgba(0, 212, 255, 0.5);
          z-index: 1000002;
          pointer-events: none;
        }
        [data-webmod-type="video"].webmod-selectable-image {
          outline: 3px solid #00d4ff !important;
          outline-offset: 3px !important;
          cursor: pointer !important;
        }
        [data-webmod-type="video"].webmod-selectable-image.selected {
          outline: 4px solid #00d4ff !important;
          box-shadow: 0 0 16px rgba(0, 212, 255, 0.5) !important;
        }
        #webmod-image-list {
          max-height: 240px;
          overflow-y: auto;
          width: 100%;
          margin: 4px 0;
          scrollbar-width: thin;
          scrollbar-color: #00d4ff33 transparent;
        }
        .webmod-image-item {
          border-top: 1px solid rgba(255,255,255,0.1);
          padding: 7px 0 4px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .webmod-item-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .webmod-item-label {
          font-weight: 600;
          color: #00d4ff;
          font-size: 11px;
          white-space: nowrap;
        }
        .webmod-moddesc-label {
          display: flex;
          align-items: center;
          gap: 4px;
          font-size: 10px;
          color: #aaa;
          cursor: pointer;
          white-space: nowrap;
        }
        .webmod-moddesc-label input[type="checkbox"] {
          cursor: pointer;
          accent-color: #00d4ff;
        }
        .webmod-prompt-input {
          width: 100%;
          box-sizing: border-box;
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 4px;
          color: #fff;
          font-size: 11px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          padding: 4px 6px;
          resize: vertical;
          min-height: 32px;
          max-height: 72px;
        }
        .webmod-prompt-input:disabled {
          opacity: 0.3;
          cursor: not-allowed;
        }
        .webmod-prompt-input::placeholder { color: #666; }
      `;
      document.head.appendChild(styleTag);
      imageSelectionState.styleTag = styleTag;

      // Compact floating widget — bottom-right corner, won't trigger ESPN's top-padding detection
      const topbar = document.createElement('div');
      topbar.id = 'webmod-selector-widget';
      topbar.innerHTML = `
        <div id="webmod-selector-info">
          <strong id="webmod-selected-count">0 images</strong> selected
        </div>
        <div id="webmod-image-list"></div>
        <div id="webmod-selector-buttons" style="display:flex;gap:8px;justify-content:flex-end;">
          <button class="webmod-selector-btn webmod-selector-btn-clear" id="webmod-btn-clear">Clear</button>
          <button class="webmod-selector-btn webmod-selector-btn-cancel" id="webmod-btn-cancel">Cancel</button>
          <button class="webmod-selector-btn webmod-selector-btn-done" id="webmod-btn-done">Done ✓</button>
        </div>
      `;
      document.body.appendChild(topbar);
      debug.log('   ✅ [ImageSelect] Widget appended bottom-right');

      imageSelectionState.overlay = topbar;
      imageSelectionState.topBar = null;
      imageSelectionState.selectedImages = [];
      imageSelectionState.active = true;

      // Add selectable class and click handlers to all images and video elements
      allSelectables.forEach((img, index) => {
        img.classList.add('webmod-selectable-image');
        img.dataset.webmodImageIndex = index;

        // Add click handler to the image itself
        img.addEventListener('click', handleImageClick, true); // Use capture phase

        // Also add wrapper class and click handlers to parent containers
        // This handles cases where the image is wrapped in <a>, <picture>, <figure>, etc.
        const parent = img.parentElement;
        if (parent && parent.tagName !== 'BODY') {
          parent.classList.add('webmod-image-wrapper');

          // Create handler function and store it so we can remove it later
          const wrapperHandler = (e) => {
            // Only trigger if the click is on the wrapper, not a different child
            if (e.target === parent || e.target === img) {
              handleImageClick.call(img, e);
            }
          };

          // Store the handler in WeakMap for cleanup
          wrapperClickHandlers.set(parent, wrapperHandler);

          // Add the event listener
          parent.addEventListener('click', wrapperHandler, true);

          debug.log(`   🔗 [ImageSelect] Added wrapper handler for ${parent.tagName} containing image ${index}`);
        }
      });

      // Check for existing selections and restore visual state
      if (tabId) {
        try {
          const key = `imageSelections_${tabId}`;
          const result = await chrome.storage.local.get([key]);
          const data = result[key];

          if (data && data.selectors && data.selectors.length > 0) {
            debug.log(`   🔄 [ImageSelect] Restoring ${data.selectors.length} previous selections`);

            data.selectors.forEach(selector => {
              const img = document.querySelector(selector);
              if (img) {
                // Add selected class
                img.classList.add('selected');

                // Add checkmark (matching selection logic at lines 2441-2448)
                const checkmark = document.createElement('div');
                checkmark.className = 'webmod-image-checkmark';
                checkmark.innerHTML = '✓';
                checkmark.dataset.webmodImageIndex = img.dataset.webmodImageIndex; // Track which image this belongs to

                // Use same parent-finding logic as selection
                const wrapper = img.closest('.webmod-image-wrapper') || img.parentElement;
                wrapper.style.position = 'relative';
                wrapper.appendChild(checkmark);

                // Add to state array
                imageSelectionState.selectedImages.push(img);
              }
            });

            // Update counter
            updateSelectedCount();
          }
        } catch (error) {
          console.error('   ⚠️ [ImageSelect] Error restoring selections:', error);
        }
      }

      // Button handlers
      const doneBtn = topbar.querySelector('#webmod-btn-done');
      const cancelBtn = topbar.querySelector('#webmod-btn-cancel');
      const clearBtn = topbar.querySelector('#webmod-btn-clear');

      doneBtn.addEventListener('click', async () => {
        debug.log(`   ✅ [ImageSelect] User confirmed ${imageSelectionState.selectedImages.length} images`);

        const generateCSSPath = (element) => {
          if (element.tagName === 'BODY') return 'body';
          const parent = element.parentElement;
          if (!parent) return element.tagName.toLowerCase();
          const siblings = Array.from(parent.children).filter(e => e.tagName === element.tagName);
          const index = siblings.indexOf(element) + 1;
          const selector = siblings.length > 1
            ? `${element.tagName.toLowerCase()}:nth-of-type(${index})`
            : element.tagName.toLowerCase();
          return `${generateCSSPath(parent)} > ${selector}`;
        };

        // Image selectors first (using src/alt/path), then video selectors (encoded with dimensions)
        const imageSelectors = imageSelectionState.selectedImages
          .filter(el => el.dataset.webmodType !== 'video')
          .map(el => {
            const src = el.getAttribute('src');
            if (src) return `img[src="${src}"]`;
            if (el.alt) return `img[alt="${el.alt}"]`;
            return generateCSSPath(el);
          });

        const videoSelectors = imageSelectionState.selectedImages
          .filter(el => el.dataset.webmodType === 'video')
          .map(el => {
            const w = el.dataset.webmodVideoWidth;
            const h = el.dataset.webmodVideoHeight;
            return `__VIDEO__:${w}:${h}:${generateCSSPath(el)}`;
          });

        const selectors = [...imageSelectors, ...videoSelectors];
        const prompts = imageSelectionState.selectedImages.map(el =>
          imageSelectionState.imagePrompts.get(el) || null
        );
        const useModifiedDesc = imageSelectionState.selectedImages.map(el =>
          imageSelectionState.useModifiedDesc.get(el) || false
        );

        // Save selections directly to storage
        if (selectors.length > 0 && tabId) {
          try {
            const key = `imageSelections_${tabId}`;
            await chrome.storage.local.set({
              [key]: {
                selectors,
                prompts,
                useModifiedDesc,
                timestamp: Date.now()
              }
            });
            debug.log(`   💾 [ImageSelect] Saved ${selectors.length} selections to storage`);
          } catch (error) {
            console.error('   ❌ [ImageSelect] Error saving to storage:', error);
          }
        }

        cleanup();

        // Show success message
        showSelectionCompleteMessage(selectors.length);

        resolve({
          success: true,
          count: selectors.length,
          selectors,
          prompts,
          useModifiedDesc
        });
      });

      clearBtn.addEventListener('click', async () => {
        debug.log('   🗑️ [ImageSelect] Clear All clicked');

        // Remove selection state from all images
        imageSelectionState.selectedImages.forEach(img => {
          img.classList.remove('selected');
          const checkmark = img.parentElement.querySelector('.webmod-image-checkmark');
          if (checkmark) checkmark.remove();
        });

        // Clear array and prompt maps
        imageSelectionState.selectedImages = [];
        imageSelectionState.imagePrompts = new Map();
        imageSelectionState.useModifiedDesc = new Map();

        // Update counter
        updateSelectedCount();

        // Save empty selection to storage so popup shows 0 selected
        if (tabId) {
          try {
            const key = `imageSelections_${tabId}`;
            await chrome.storage.local.set({
              [key]: {
                selectors: [],
                timestamp: Date.now()
              }
            });
            debug.log('   💾 [ImageSelect] Saved cleared selections to storage');
          } catch (error) {
            console.error('   ❌ [ImageSelect] Error saving to storage:', error);
          }
        }
      });

      cancelBtn.addEventListener('click', () => {
        debug.log('   ❌ [ImageSelect] User cancelled selection');
        cleanup();
        resolve({
          success: true,
          count: 0,
          selectors: []
        });
      });

      // ESC key to cancel
      document.addEventListener('keydown', handleEscapeKey);

      debug.log('   ✅ [ImageSelect] Overlay ready');

    } catch (error) {
      console.error('   ❌ [ImageSelect] Error:', error);
      reject(error);
    }
  });
}

/**
 * Handle image click in selection mode
 */
function handleImageClick(e) {
  e.preventDefault();
  e.stopPropagation();

  const img = e.currentTarget;
  const isSelected = img.classList.contains('selected');

  if (isSelected) {
    // Deselect
    img.classList.remove('selected');

    // Find and remove checkmark - it might be in the wrapper or parent
    const wrapper = img.closest('.webmod-image-wrapper') || img.parentElement;
    const checkmark = wrapper.querySelector(`.webmod-image-checkmark[data-webmod-image-index="${img.dataset.webmodImageIndex}"]`);
    if (checkmark) {
      checkmark.remove();
    }

    imageSelectionState.selectedImages = imageSelectionState.selectedImages.filter(i => i !== img);
    debug.log(`   ➖ [ImageSelect] Deselected image (${imageSelectionState.selectedImages.length} total)`);
  } else {
    // Select
    img.classList.add('selected');

    // Add checkmark - find the wrapper or use parent
    const checkmark = document.createElement('div');
    checkmark.className = 'webmod-image-checkmark';
    checkmark.innerHTML = '✓';
    checkmark.dataset.webmodImageIndex = img.dataset.webmodImageIndex; // Track which image this belongs to

    const wrapper = img.closest('.webmod-image-wrapper') || img.parentElement;
    wrapper.style.position = 'relative';
    wrapper.appendChild(checkmark);

    imageSelectionState.selectedImages.push(img);
    debug.log(`   ➕ [ImageSelect] Selected image (${imageSelectionState.selectedImages.length} total)`);
  }

  // Update counter
  updateSelectedCount();
}

/**
 * Update the selection widget: count + per-image prompt/checkbox list
 */
function updateSelectedCount() {
  const countEl = document.querySelector('#webmod-selected-count');
  const count = imageSelectionState.selectedImages.length;
  if (countEl) countEl.textContent = `${count} image${count !== 1 ? 's' : ''}`;

  const listEl = document.querySelector('#webmod-image-list');
  if (!listEl) return;
  listEl.innerHTML = '';

  imageSelectionState.selectedImages.forEach((el, idx) => {
    const isVideo = el.dataset.webmodType === 'video';
    const label = isVideo ? `Video ${idx + 1}` : `Image ${idx + 1}`;
    const savedPrompt = imageSelectionState.imagePrompts.get(el) || '';
    const savedUseDesc = imageSelectionState.useModifiedDesc.get(el) || false;

    const item = document.createElement('div');
    item.className = 'webmod-image-item';
    // Use textContent for textarea to avoid XSS from saved prompt
    item.innerHTML = `
      <div class="webmod-item-header">
        <span class="webmod-item-label">${label}</span>
        <label class="webmod-moddesc-label">
          <input type="checkbox" class="webmod-moddesc-check" ${savedUseDesc ? 'checked' : ''}>
          Use article description
        </label>
      </div>
      <textarea class="webmod-prompt-input" placeholder="Custom prompt (optional)"${savedUseDesc ? ' disabled' : ''}></textarea>
    `;
    item.querySelector('.webmod-prompt-input').value = savedPrompt;

    item.querySelector('.webmod-moddesc-check').addEventListener('change', (e) => {
      imageSelectionState.useModifiedDesc.set(el, e.target.checked);
      item.querySelector('.webmod-prompt-input').disabled = e.target.checked;
    });
    item.querySelector('.webmod-prompt-input').addEventListener('input', (e) => {
      imageSelectionState.imagePrompts.set(el, e.target.value);
    });

    listEl.appendChild(item);
  });
}

/**
 * Handle ESC key to cancel selection
 */
function handleEscapeKey(e) {
  if (e.key === 'Escape' && imageSelectionState.active) {
    debug.log('   ⌨️ [ImageSelect] ESC pressed, cancelling...');
    document.querySelector('#webmod-btn-cancel')?.click();
  }
}

/**
 * Cleanup selection mode
 */
function cleanup() {
  // Remove video intercept overlays (body-appended fixed-position) and scroll handler
  document.querySelectorAll('.webmod-video-intercept').forEach(el => el.remove());
  if (imageSelectionState.videoClickInterceptor) {
    window.removeEventListener('scroll', imageSelectionState.videoClickInterceptor, { capture: true });
    imageSelectionState.videoClickInterceptor = null;
  }

  // Remove widget and injected style tag
  if (imageSelectionState.overlay) {
    imageSelectionState.overlay.remove();
  }
  if (imageSelectionState.styleTag) {
    imageSelectionState.styleTag.remove();
    imageSelectionState.styleTag = null;
  }

  // Remove classes, handlers, and data from images and video containers
  document.querySelectorAll('.webmod-selectable-image').forEach(el => {
    el.classList.remove('webmod-selectable-image', 'selected');
    el.removeEventListener('click', handleImageClick, true);
    delete el.dataset.webmodImageIndex;
    delete el.dataset.webmodType;
    delete el.dataset.webmodVideoWidth;
    delete el.dataset.webmodVideoHeight;
  });

  // Remove wrapper classes and handlers
  document.querySelectorAll('.webmod-image-wrapper').forEach(wrapper => {
    // Remove the stored event handler
    const handler = wrapperClickHandlers.get(wrapper);
    if (handler) {
      wrapper.removeEventListener('click', handler, true);
      wrapperClickHandlers.delete(wrapper);
    }
    wrapper.classList.remove('webmod-image-wrapper');
  });

  // Remove checkmarks
  document.querySelectorAll('.webmod-image-checkmark').forEach(checkmark => {
    checkmark.remove();
  });

  // Remove ESC listener
  document.removeEventListener('keydown', handleEscapeKey);

  // Restore pointer-events on any disabled pointer-actions elements
  if (imageSelectionState.disabledPointerActions) {
    imageSelectionState.disabledPointerActions.forEach(pa => {
      pa.style.pointerEvents = pa._webmodOrigPointerEvents || '';
      delete pa._webmodOrigPointerEvents;
    });
    imageSelectionState.disabledPointerActions = null;
  }

  imageSelectionState.active = false;
  imageSelectionState.selectedImages = [];
  imageSelectionState.overlay = null;
  imageSelectionState.imagePrompts = new Map();
  imageSelectionState.useModifiedDesc = new Map();
}

/**
 * Show error message when image selection fails
 */
function showImageSelectionError(message) {
  const banner = document.createElement('div');
  banner.id = 'webmod-selection-error-banner';
  banner.innerHTML = `
    <style>
      #webmod-selection-error-banner {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #1a0a0a 0%, #2b1515 100%);
        border: 2px solid #ef4444;
        border-radius: 12px;
        padding: 20px 30px;
        z-index: 10000000;
        box-shadow: 0 8px 32px rgba(239, 68, 68, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: slideDown 0.3s ease;
        max-width: 500px;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      #webmod-selection-error-banner .message {
        color: #fee2e2;
        font-size: 15px;
        margin: 0;
        text-align: center;
      }

      #webmod-selection-error-banner .icon {
        color: #ef4444;
        font-size: 18px;
        font-weight: bold;
      }
    </style>
    <div class="message">
      <span class="icon">❌</span> ${message}
    </div>
  `;

  document.body.appendChild(banner);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    banner.style.animation = 'slideDown 0.3s ease reverse';
    setTimeout(() => {
      banner.remove();
    }, 300);
  }, 5000);
}

/**
 * Show completion message after image selection
 */
function showSelectionCompleteMessage(count) {
  // Create notification banner
  const banner = document.createElement('div');
  banner.id = 'webmod-selection-complete-banner';
  banner.innerHTML = `
    <style>
      #webmod-selection-complete-banner {
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: linear-gradient(135deg, #0a0e17 0%, #151b2b 100%);
        border: 2px solid #00d4ff;
        border-radius: 12px;
        padding: 20px 30px;
        z-index: 10000000;
        box-shadow: 0 8px 32px rgba(0, 212, 255, 0.3);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: slideDown 0.3s ease;
      }

      @keyframes slideDown {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(-20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      #webmod-selection-complete-banner .message {
        color: #e2e8f0;
        font-size: 15px;
        margin: 0;
        text-align: center;
      }

      #webmod-selection-complete-banner .count {
        color: #00d4ff;
        font-weight: bold;
        font-size: 16px;
      }

      #webmod-selection-complete-banner .instruction {
        color: #94a3b8;
        font-size: 13px;
        margin-top: 8px;
      }
    </style>
    <div class="message">
      ✓ <span class="count">${count} image${count !== 1 ? 's' : ''}</span> selected
    </div>
    <div class="instruction">
      Reopen the extension to continue
    </div>
  `;

  document.body.appendChild(banner);

  // Auto-remove after 4 seconds
  setTimeout(() => {
    banner.style.animation = 'slideDown 0.3s ease reverse';
    setTimeout(() => {
      banner.remove();
    }, 300);
  }, 4000);
}
