// Capture original console before any modifications
const originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error
};

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
  // Listen for license validation changes
  if (area === 'sync' && changes.licenseValid) {
    updateBuyLicenseVisibility();
  }
});

// Debug-aware console wrapper - only logs when DEBUG_MODE is true
const debug = {
  log: (...args) => DEBUG_MODE && originalConsole.log(...args),
  warn: (...args) => DEBUG_MODE && originalConsole.warn(...args),
  error: (...args) => originalConsole.error(...args) // Always show errors
};

// DOM elements
const topicInput = document.getElementById('topic');
const transformPromptInput = document.getElementById('transformPrompt');
const transformBtn = document.getElementById('transformBtn');
const resetBtn = document.getElementById('resetBtn');
const statusDiv = document.getElementById('status');
const configLink = document.getElementById('configLink');
const generateImagesCheckbox = document.getElementById('generateImages');
const imageCountSelect = document.getElementById('imageCount');
const replaceUrlCheckbox = document.getElementById('replaceUrl');
const modeRadios = document.querySelectorAll('input[name="mode"]');
const replaceTopicGroup = document.getElementById('replaceTopicGroup');
const transformPromptGroup = document.getElementById('transformPromptGroup');
const interceptOriginalUrlsCheckbox = document.getElementById('interceptOriginalUrls');
const interceptGeneratedUrlsCheckbox = document.getElementById('interceptGeneratedUrls');
const autoInterceptPermNote = document.getElementById('autoInterceptPermNote');
const selectImagesBtn = document.getElementById('selectImagesBtn');
const selectedCountSpan = document.getElementById('selectedCount');
const clearFormLink = document.getElementById('clearFormLink');
const resetMenu = document.getElementById('resetMenu');
const resetTempBtn = document.getElementById('resetTempBtn');
const resetPermanentBtn = document.getElementById('resetPermanentBtn');
const articleLengthLimitSlider = document.getElementById('articleLengthLimit');
const articleLengthValueSpan = document.getElementById('articleLengthValue');
const buyLicenseLink = document.getElementById('buyLicenseLink');
const progressIndicator = document.getElementById('progressIndicator');
const progressText = document.getElementById('progressText');
const imageOptionsRow = document.querySelector('.image-options-row');

// Image selection state
let selectedImageSelectors = [];
let selectedImagePrompts = [];
let selectedUseModifiedDesc = [];
let currentTabId = null;

/**
 * Ensure content script is injected into the given tab.
 * Pings first; injects only if not already present.
 */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/content.js']
    });
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}

// Default form values
const DEFAULT_VALUES = {
  mode: 'transform',
  topic: '',
  transformPrompt: '',
  generateImages: false,
  imageCount: 3,
  replaceUrl: true,
  interceptOriginalUrls: false,
  interceptGeneratedUrls: false,
  articleLengthLimit: 1000  // This is the word count (slider position 50 = 1000 words)
};

/**
 * Convert slider position (0-100) to word count with logarithmic scale
 * - 0% slider = 500 words
 * - 50% slider = 1,000 words (linear growth in first half)
 * - 100% slider = 10,000 words (exponential growth in second half)
 */
function sliderToWordCount(sliderValue) {
  if (sliderValue <= 50) {
    // Linear: 500 to 1000 in first half
    return Math.round(500 + (sliderValue / 50) * 500);
  } else {
    // Exponential: 1000 to 10000 in second half
    const t = (sliderValue - 50) / 50; // 0 to 1
    return Math.round(1000 * Math.pow(10, t));
  }
}

/**
 * Convert word count back to slider position (0-100)
 */
function wordCountToSlider(wordCount) {
  // Clamp to valid range
  wordCount = Math.max(500, Math.min(10000, wordCount));

  if (wordCount <= 1000) {
    // Reverse linear: 500-1000 → 0-50
    return Math.round(((wordCount - 500) / 500) * 50);
  } else {
    // Reverse exponential: 1000-10000 → 50-100
    return Math.round(50 + (Math.log10(wordCount / 1000) * 50));
  }
}

// Status display functions
function showStatus(message, type = 'info') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}

function hideStatus() {
  statusDiv.style.display = 'none';
}

function setLoading(isLoading) {
  const btnText = transformBtn.querySelector('.btn-text');
  const loader = transformBtn.querySelector('.loader');

  if (isLoading) {
    transformBtn.disabled = true;
    btnText.textContent = 'Transforming...';
    loader.style.display = 'inline-block';
    progressIndicator.style.display = 'flex';
  } else {
    transformBtn.disabled = false;
    btnText.textContent = 'Transform Page';
    loader.style.display = 'none';
    progressIndicator.style.display = 'none';
  }
}

function updateProgress(message) {
  progressText.textContent = message;
}

// Check if API key is configured
async function checkApiKey() {
  const result = await chrome.storage.sync.get(['openaiApiKey']);
  if (!result.openaiApiKey) {
    showStatus('Please configure your OpenAI API key first', 'error');
    return false;
  }
  return true;
}

// Mode switching handler
modeRadios.forEach(radio => {
  radio.addEventListener('change', (e) => {
    const mode = e.target.value;
    debug.log('🔄 [Popup] Mode changed to:', mode);

    if (mode === 'replace') {
      // Copy transform prompt value to topic input if topic is empty
      if (transformPromptInput.value.trim() && !topicInput.value.trim()) {
        topicInput.value = transformPromptInput.value;
      }

      replaceTopicGroup.style.display = 'block';
      transformPromptGroup.style.display = 'none';
      topicInput.focus();
    } else {
      // Copy topic value to transform prompt input if transform prompt is empty
      if (topicInput.value.trim() && !transformPromptInput.value.trim()) {
        transformPromptInput.value = topicInput.value;
      }

      replaceTopicGroup.style.display = 'none';
      transformPromptGroup.style.display = 'block';
      transformPromptInput.focus();
    }

    // Save form data when mode changes
    if (currentTabId) {
      saveFormData(currentTabId);
    }
  });
});

// Auto-save form data on input changes (debounced for text inputs)
topicInput.addEventListener('input', () => {
  if (currentTabId) debouncedSaveFormData(currentTabId);
});

transformPromptInput.addEventListener('input', () => {
  if (currentTabId) debouncedSaveFormData(currentTabId);
});

// Auto-save immediately for checkboxes and dropdowns (no debounce needed)
generateImagesCheckbox.addEventListener('change', () => {
  if (currentTabId) saveFormData(currentTabId);
});

imageCountSelect.addEventListener('change', () => {
  if (imageCountSelect.value !== '') {
    // A specific Max was chosen — clear any manual image selections
    if (currentTabId) clearImageSelections(currentTabId);
  }
  if (currentTabId) saveFormData(currentTabId);
});

replaceUrlCheckbox.addEventListener('change', () => {
  if (currentTabId) saveFormData(currentTabId);
});

interceptOriginalUrlsCheckbox.addEventListener('change', () => {
  if (currentTabId) saveFormData(currentTabId);
});

interceptGeneratedUrlsCheckbox.addEventListener('change', () => {
  if (currentTabId) saveFormData(currentTabId);
});

// Article length slider - update display and save (with logarithmic scale)
articleLengthLimitSlider.addEventListener('input', () => {
  const sliderValue = parseInt(articleLengthLimitSlider.value);
  const wordCount = sliderToWordCount(sliderValue);
  articleLengthValueSpan.textContent = wordCount.toLocaleString() + ' words';
});

articleLengthLimitSlider.addEventListener('change', () => {
  if (currentTabId) saveFormData(currentTabId);
});

// Get selected mode
function getSelectedMode() {
  const selectedRadio = document.querySelector('input[name="mode"]:checked');
  return selectedRadio ? selectedRadio.value : 'replace';
}

// Transform button click handler
transformBtn.addEventListener('click', async () => {
  debug.log('🎯 [Popup] Transform button clicked');

  const mode = getSelectedMode();
  debug.log('📋 [Popup] Mode:', mode);

  let topic = '';
  let transformPrompt = '';

  if (mode === 'replace') {
    topic = topicInput.value.trim();
    if (!topic) {
      debug.warn('⚠️ [Popup] No topic entered');
      showStatus('Please enter a topic', 'error');
      return;
    }
    debug.log('📝 [Popup] Topic:', topic);
  } else {
    transformPrompt = transformPromptInput.value.trim();
    if (!transformPrompt) {
      debug.warn('⚠️ [Popup] No transformation prompt entered');
      showStatus('Please enter transformation instructions', 'error');
      return;
    }
    debug.log('📝 [Popup] Transform Prompt:', transformPrompt);
  }

  const hasApiKey = await checkApiKey();
  if (!hasApiKey) {
    console.error('❌ [Popup] API key check failed');
    return;
  }

  hideStatus();
  setLoading(true);

  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    debug.log('📄 [Popup] Active tab:', tab.url);

    const config = {
      action: 'transformPage',
      mode: mode,
      topic: topic,
      transformPrompt: transformPrompt,
      tabId: tab.id,
      generateImages: generateImagesCheckbox.checked,
      imageCount: imageCountSelect.value !== '' ? parseInt(imageCountSelect.value) : null,
      replaceUrl: replaceUrlCheckbox.checked,
      selectedImageSelectors: selectedImageSelectors,
      selectedImagePrompts: selectedImagePrompts,
      selectedUseModifiedDesc: selectedUseModifiedDesc,
      articleLengthLimit: sliderToWordCount(parseInt(articleLengthLimitSlider.value))
    };

    debug.log('📤 [Popup] Sending transformation request:', config);

    // Send message to background script to start transformation
    chrome.runtime.sendMessage(config, (response) => {
      // Check for connection errors
      if (chrome.runtime.lastError) {
        console.error('❌ [Popup] Connection error:', chrome.runtime.lastError.message);
        setLoading(false);
        showStatus('Extension error: Please reload the extension and refresh this page', 'error');
        return;
      }

      debug.log('📥 [Popup] Received response:', response);
      setLoading(false);

      if (response && response.success) {
        debug.log('✅ [Popup] Transformation successful!');

        // Clear all saved data after successful transformation
        clearImageSelections(tab.id);
        clearFormData(tab.id);

        // Check if there were image generation warnings
        if (response.warning) {
          debug.warn('⚠️ [Popup] Warning:', response.warning);
          showStatus(`Success! (Warning: ${response.warning})`, 'success');
          setTimeout(() => {
            window.close();
          }, 3000); // Give more time to read the warning
        } else {
          showStatus('Page transformed successfully!', 'success');
          setTimeout(() => {
            window.close();
          }, 1500);
        }
      } else {
        console.error('❌ [Popup] Transformation failed:', response?.error);
        showStatus(response?.error || 'Failed to transform page', 'error');
      }
    });

  } catch (error) {
    console.error('❌ [Popup] Error:', error);
    console.error('📚 [Popup] Stack trace:', error.stack);
    setLoading(false);
    showStatus('Error: ' + error.message, 'error');
  }
});

// Reset button click handler - toggles dropdown
resetBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  resetMenu.classList.toggle('show');
});

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  if (!resetBtn.contains(e.target) && !resetMenu.contains(e.target)) {
    resetMenu.classList.remove('show');
  }
});

// Reset Temporarily - restores page but keeps cache
resetTempBtn.addEventListener('click', async () => {
  debug.log('↺ [Popup] Reset Temporarily clicked');
  resetMenu.classList.remove('show');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    debug.log('📄 [Popup] Resetting tab (temporary):', tab.url);

    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'resetPage' }, (response) => {
      // Check for connection errors
      if (chrome.runtime.lastError) {
        console.error('❌ [Popup] Connection error:', chrome.runtime.lastError.message);
        showStatus('Cannot reset page: Please refresh the page and try again', 'error');
        return;
      }

      debug.log('📥 [Popup] Reset response:', response);

      if (response && response.success) {
        debug.log('✅ [Popup] Page reset temporarily (cache kept)');
        showStatus('Page reset (cache kept)', 'success');
        setTimeout(() => {
          window.close();
        }, 1000);
      } else {
        console.error('❌ [Popup] Reset failed');
        showStatus('Failed to reset page', 'error');
      }
    });

  } catch (error) {
    console.error('❌ [Popup] Reset error:', error);
    showStatus('Error: ' + error.message, 'error');
  }
});

// Reset & Clear Cache - restores page and deletes cache
resetPermanentBtn.addEventListener('click', async () => {
  debug.log('🗑️ [Popup] Reset & Clear Cache clicked');
  resetMenu.classList.remove('show');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    debug.log('📄 [Popup] Resetting tab (permanent):', tab.url);

    await ensureContentScript(tab.id);
    chrome.tabs.sendMessage(tab.id, { action: 'resetPage' }, async (response) => {
      // Check for connection errors
      if (chrome.runtime.lastError) {
        console.error('❌ [Popup] Connection error:', chrome.runtime.lastError.message);
        showStatus('Cannot reset page: Please refresh the page and try again', 'error');
        return;
      }

      debug.log('📥 [Popup] Reset response:', response);

      if (response && response.success) {
        debug.log('✅ [Popup] Page reset successfully');

        // Clear cache for this URL so transformation doesn't reapply on reload
        debug.log('🗑️ [Popup] Clearing cache for URL:', tab.url);
        chrome.runtime.sendMessage({
          action: 'deleteCacheEntry',
          url: tab.url
        }, (deleteResponse) => {
          if (chrome.runtime.lastError) {
            console.error('❌ [Popup] Error clearing cache:', chrome.runtime.lastError.message);
          } else if (deleteResponse && deleteResponse.success) {
            debug.log('✅ [Popup] Cache cleared successfully');
          }
        });

        showStatus('Page reset & cache cleared', 'success');
        setTimeout(() => {
          window.close();
        }, 1000);
      } else {
        console.error('❌ [Popup] Reset failed');
        showStatus('Failed to reset page', 'error');
      }
    });

  } catch (error) {
    console.error('❌ [Popup] Reset error:', error);
    showStatus('Error: ' + error.message, 'error');
  }
});

// Config link click handler
configLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Clear Form button click handler
clearFormLink.addEventListener('click', async (e) => {
  e.preventDefault();

  debug.log('🗑️ [Popup] Clear Form clicked');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Reset all fields to defaults
    topicInput.value = DEFAULT_VALUES.topic;
    transformPromptInput.value = DEFAULT_VALUES.transformPrompt;
    generateImagesCheckbox.checked = DEFAULT_VALUES.generateImages;
    imageCountSelect.value = DEFAULT_VALUES.imageCount;
    replaceUrlCheckbox.checked = DEFAULT_VALUES.replaceUrl;
    interceptOriginalUrlsCheckbox.checked = DEFAULT_VALUES.interceptOriginalUrls;
    interceptGeneratedUrlsCheckbox.checked = DEFAULT_VALUES.interceptGeneratedUrls;

    // Reset mode to Replace
    const replaceRadio = document.querySelector('input[name="mode"][value="replace"]');
    replaceRadio.checked = true;
    replaceRadio.dispatchEvent(new Event('change'));

    // Clear storage
    await clearFormData(tab.id);
    await clearImageSelections(tab.id);

    // Reset UI state
    selectedImageSelectors = [];
    updateSelectedCountDisplay();
    imageCountSelect.disabled = !DEFAULT_VALUES.generateImages;
    selectImagesBtn.disabled = !DEFAULT_VALUES.generateImages;

    // Show confirmation
    showStatus('Form reset to defaults', 'success');
    setTimeout(() => hideStatus(), 2000);

    // Focus topic input
    topicInput.focus();

  } catch (error) {
    console.error('❌ [Popup] Error clearing form:', error);
    showStatus('Error: ' + error.message, 'error');
  }
});

// Enable/disable image count and select images button based on checkbox
// Also show/hide the image options row
generateImagesCheckbox.addEventListener('change', () => {
  const enabled = generateImagesCheckbox.checked;

  // Show/hide the options row
  if (enabled) {
    imageOptionsRow.style.display = 'flex';
  } else {
    imageOptionsRow.style.display = 'none';
  }

  imageCountSelect.disabled = !enabled;
  selectImagesBtn.disabled = !enabled;

  // Clear selection if disabled
  if (!enabled) {
    selectedImageSelectors = [];
    updateSelectedCountDisplay();
    // Also clear from storage so selections don't persist
    if (currentTabId) {
      clearImageSelections(currentTabId);
    }
  }
});

// Select Images button click handler
selectImagesBtn.addEventListener('click', async () => {
  debug.log('🖼️ [Popup] Select Images button clicked');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    currentTabId = tab.id;

    debug.log('📤 [Popup] Sending startImageSelection message to tab:', tab.id);
    debug.log('📄 [Popup] Tab URL:', tab.url);

    await ensureContentScript(tab.id);
    // Send message to content script to start selection mode with tabId
    chrome.tabs.sendMessage(tab.id, {
      action: 'startImageSelection',
      tabId: tab.id
    }, (response) => {
      debug.log('📥 [Popup] Received response:', response);

      if (chrome.runtime.lastError) {
        console.error('❌ [Popup] Connection error:', chrome.runtime.lastError.message);
        showStatus('Cannot select images: Please refresh the page and try again', 'error');
        return;
      }

      if (response && response.success === false) {
        console.error('❌ [Popup] Selection failed:', response.error);
        showStatus('Error: ' + response.error, 'error');
        return;
      }

      // Selection mode started successfully
      debug.log('✅ [Popup] Image selection mode started');

      // Close popup after message is sent and received
      window.close();
    });

  } catch (error) {
    console.error('❌ [Popup] Error:', error);
    showStatus('Error: ' + error.message, 'error');
  }
});

/**
 * Update the selected count display
 */
function updateSelectedCountDisplay() {
  const count = selectedImageSelectors.length;
  if (count > 0) {
    selectedCountSpan.textContent = `(${count} selected)`;
    selectedCountSpan.style.display = 'inline';
    imageCountSelect.value = '';  // images selected → blank Max
  } else {
    selectedCountSpan.style.display = 'none';
    // leave Max as-is when images are cleared
  }
}

/**
 * Save image selections to storage (per tab)
 */
async function saveImageSelections(tabId, selectors) {
  try {
    const key = `imageSelections_${tabId}`;
    await chrome.storage.local.set({
      [key]: {
        selectors: selectors,
        timestamp: Date.now()
      }
    });
    debug.log('✅ [Popup] Saved image selections for tab:', tabId);
  } catch (error) {
    console.error('❌ [Popup] Error saving image selections:', error);
  }
}

/**
 * Load image selections from storage (per tab)
 */
async function loadImageSelections(tabId) {
  try {
    const key = `imageSelections_${tabId}`;
    const result = await chrome.storage.local.get([key]);
    const data = result[key];

    if (data && data.selectors) {
      // Check if selections are less than 1 hour old
      const oneHourAgo = Date.now() - 3600000;
      if (data.timestamp > oneHourAgo) {
        selectedImageSelectors = data.selectors;
        selectedImagePrompts = data.prompts || [];
        selectedUseModifiedDesc = data.useModifiedDesc || [];
        updateSelectedCountDisplay();
        debug.log('✅ [Popup] Loaded', selectedImageSelectors.length, 'image selections for tab:', tabId);
      } else {
        // Clear expired selections
        await clearImageSelections(tabId);
        debug.log('⏭️ [Popup] Cleared expired image selections');
      }
    }
  } catch (error) {
    console.error('❌ [Popup] Error loading image selections:', error);
  }
}

/**
 * Clear image selections from storage
 */
async function clearImageSelections(tabId) {
  try {
    const key = `imageSelections_${tabId}`;
    await chrome.storage.local.remove([key]);
    selectedImageSelectors = [];
    updateSelectedCountDisplay();
    debug.log('✅ [Popup] Cleared image selections for tab:', tabId);
  } catch (error) {
    console.error('❌ [Popup] Error clearing image selections:', error);
  }
}

/**
 * Debounce helper
 */
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/**
 * Save form data to storage (per tab)
 */
async function saveFormData(tabId) {
  try {
    const formData = {
      mode: getSelectedMode(),
      topic: topicInput.value,
      transformPrompt: transformPromptInput.value,
      generateImages: generateImagesCheckbox.checked,
      imageCount: imageCountSelect.value !== '' ? parseInt(imageCountSelect.value) : null,
      replaceUrl: replaceUrlCheckbox.checked,
      interceptOriginalUrls: interceptOriginalUrlsCheckbox.checked,
      interceptGeneratedUrls: interceptGeneratedUrlsCheckbox.checked,
      articleLengthLimit: sliderToWordCount(parseInt(articleLengthLimitSlider.value)),
      timestamp: Date.now()
    };

    const key = `popupFormData_${tabId}`;
    await chrome.storage.local.set({ [key]: formData });
    debug.log('💾 [Popup] Form data saved for tab:', tabId);
  } catch (error) {
    console.error('❌ [Popup] Error saving form data:', error);
  }
}

/**
 * Load form data from storage (per tab)
 */
async function loadFormData(tabId) {
  try {
    const key = `popupFormData_${tabId}`;
    const result = await chrome.storage.local.get([key]);
    const data = result[key];

    if (!data) return;

    // Check if data is less than 1 hour old
    const oneHourAgo = Date.now() - 3600000;
    if (data.timestamp < oneHourAgo) {
      await clearFormData(tabId);
      debug.log('⏭️ [Popup] Cleared expired form data');
      return;
    }

    // Restore values
    topicInput.value = data.topic || '';
    transformPromptInput.value = data.transformPrompt || '';
    generateImagesCheckbox.checked = data.generateImages ?? DEFAULT_VALUES.generateImages;
    imageCountSelect.value = data.imageCount ? String(data.imageCount) : '';
    replaceUrlCheckbox.checked = data.replaceUrl ?? DEFAULT_VALUES.replaceUrl;
    interceptOriginalUrlsCheckbox.checked = data.interceptOriginalUrls ?? DEFAULT_VALUES.interceptOriginalUrls;
    interceptGeneratedUrlsCheckbox.checked = data.interceptGeneratedUrls ?? DEFAULT_VALUES.interceptGeneratedUrls;

    // Restore article length limit
    const articleLengthLimit = data.articleLengthLimit || DEFAULT_VALUES.articleLengthLimit;
    const sliderPosition = wordCountToSlider(articleLengthLimit);
    articleLengthLimitSlider.value = sliderPosition;
    articleLengthValueSpan.textContent = articleLengthLimit.toLocaleString() + ' words';

    // Set mode and trigger display update
    const modeRadio = document.querySelector(`input[name="mode"][value="${data.mode}"]`);
    if (modeRadio) {
      modeRadio.checked = true;
      modeRadio.dispatchEvent(new Event('change'));
    }

    // Update dependent UI
    imageCountSelect.disabled = !generateImagesCheckbox.checked;
    selectImagesBtn.disabled = !generateImagesCheckbox.checked;

    // Update image options row visibility based on checkbox state
    if (generateImagesCheckbox.checked) {
      imageOptionsRow.style.display = 'flex';
    } else {
      imageOptionsRow.style.display = 'none';
    }

    debug.log('✅ [Popup] Loaded form data for tab:', tabId);
  } catch (error) {
    console.error('❌ [Popup] Error loading form data:', error);
  }
}

/**
 * Clear form data from storage
 */
async function clearFormData(tabId) {
  try {
    const key = `popupFormData_${tabId}`;
    await chrome.storage.local.remove([key]);
    debug.log('✅ [Popup] Cleared form data for tab:', tabId);
  } catch (error) {
    console.error('❌ [Popup] Error clearing form data:', error);
  }
}

// Debounced save function
const debouncedSaveFormData = debounce((tabId) => saveFormData(tabId), 300);

// Initialize popup
async function initializePopup() {
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  // Load any existing image selections for this tab
  await loadImageSelections(tab.id);

  // Load any existing form data for this tab
  await loadFormData(tab.id);

  // Enforce mutual exclusivity: images win over Max
  if (selectedImageSelectors.length > 0) {
    imageCountSelect.value = '';  // images loaded → blank Max
  } else if (imageCountSelect.value === '') {
    imageCountSelect.value = '3'; // both blank (e.g. images expired) → restore default
  }

  // Persist the enforced state so storage always reflects what's shown
  await saveFormData(tab.id);

  // Auto-focus topic input
  topicInput.focus();

  // Check API key on load
  checkApiKey();

  // Load auto-intercept settings
  loadAutoInterceptSettings();

  // Update buy license link visibility
  updateBuyLicenseVisibility();
}

// Run initialization
initializePopup();

/**
 * Load auto-intercept settings from storage
 */
async function loadAutoInterceptSettings() {
  try {
    const result = await chrome.storage.local.get(['autoInterceptSettings']);
    const settings = result.autoInterceptSettings || {
      interceptOriginalUrls: false,
      interceptGeneratedUrls: false
    };

    interceptOriginalUrlsCheckbox.checked = settings.interceptOriginalUrls;
    interceptGeneratedUrlsCheckbox.checked = settings.interceptGeneratedUrls;

    // If saved as enabled but optional host permission not yet granted, reset to off.
    // The user must re-enable the toggle to trigger the permission request.
    if (interceptOriginalUrlsCheckbox.checked || interceptGeneratedUrlsCheckbox.checked) {
      const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      if (!granted) {
        interceptOriginalUrlsCheckbox.checked = false;
        interceptGeneratedUrlsCheckbox.checked = false;
        await saveAutoInterceptSettings();
      }
    }

    await updatePermissionNote();

  } catch (error) {
    console.error('❌ [Popup] Error loading auto-intercept settings:', error);
  }
}

/**
 * Save auto-intercept settings to storage
 */
async function saveAutoInterceptSettings() {
  try {
    await chrome.storage.local.set({
      autoInterceptSettings: {
        interceptOriginalUrls: interceptOriginalUrlsCheckbox.checked,
        interceptGeneratedUrls: interceptGeneratedUrlsCheckbox.checked
      }
    });

    debug.log('✅ [Popup] Auto-intercept settings saved');

  } catch (error) {
    console.error('❌ [Popup] Error saving auto-intercept settings:', error);
  }
}

// Auto-intercept toggle event listeners
async function updatePermissionNote() {
  const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  autoInterceptPermNote.style.display = granted ? 'none' : 'block';
}

// Requests optional host permission the first time either toggle is enabled
async function handleAutoInterceptChange() {
  const eitherEnabled = interceptOriginalUrlsCheckbox.checked || interceptGeneratedUrlsCheckbox.checked;

  if (eitherEnabled) {
    const alreadyGranted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    if (!alreadyGranted) {
      const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
      if (!granted) {
        interceptOriginalUrlsCheckbox.checked = false;
        interceptGeneratedUrlsCheckbox.checked = false;
        showStatus('Host permission required for auto-intercept', 'error');
        setTimeout(hideStatus, 3000);
        return;
      }
    }
  }

  await saveAutoInterceptSettings();
  await updatePermissionNote();
}

interceptOriginalUrlsCheckbox.addEventListener('change', handleAutoInterceptChange);
interceptGeneratedUrlsCheckbox.addEventListener('change', handleAutoInterceptChange);

/**
 * Update buy license link visibility based on license status
 */
async function updateBuyLicenseVisibility() {
  try {
    const result = await chrome.storage.sync.get(['licenseValid']);
    const isLicensed = result.licenseValid === true;

    if (buyLicenseLink) {
      buyLicenseLink.style.display = isLicensed ? 'none' : 'block';
    }

    debug.log(`[Popup] Buy license link ${isLicensed ? 'hidden' : 'visible'}`);
  } catch (error) {
    console.error('❌ [Popup] Error updating buy license visibility:', error);
  }
}

/**
 * Listen for progress updates from background script
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'progressUpdate') {
    updateProgress(request.message);
  }
});
