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
const apiKeyInput = document.getElementById('apiKey');
const textModelSelect = document.getElementById('textModel');
const imageModelSelect = document.getElementById('imageModel');
const storeImagesLocallyCheckbox = document.getElementById('storeImagesLocally');
const saveBtn = document.getElementById('saveBtn');
const statusDiv = document.getElementById('status');
const apiKeySavedIndicator = document.getElementById('apiKeySavedIndicator');
const apiKeyFormGroup = document.getElementById('apiKeyFormGroup');
const apiKeyButtonGroup = document.getElementById('apiKeyButtonGroup');
const apiKeySavedButtonGroup = document.getElementById('apiKeySavedButtonGroup');
const clearApiKeyBtn = document.getElementById('clearApiKeyBtn');

// License key elements
const licenseKeyInput = document.getElementById('licenseKey');
const toggleLicenseKeyBtn = document.getElementById('toggleLicenseKey');
const saveLicenseBtn = document.getElementById('saveLicenseBtn');
const clearLicenseBtn = document.getElementById('clearLicenseBtn');
const licenseStatusDiv = document.getElementById('licenseStatus');
const buyLicenseBtn = document.getElementById('buyLicenseBtn');
const licensedIndicator = document.getElementById('licensedIndicator');
const licenseKeyFormGroup = document.getElementById('licenseKeyFormGroup');
const licenseButtonGroup = document.getElementById('licenseButtonGroup');
const licensedButtonGroup = document.getElementById('licensedButtonGroup');
const clearLicensedBtn = document.getElementById('clearLicensedBtn');

// Cache management elements
const interceptOriginalUrlsCheckbox = document.getElementById('interceptOriginalUrls');
const interceptGeneratedUrlsCheckbox = document.getElementById('interceptGeneratedUrls');
const enableDebugLogsCheckbox = document.getElementById('enableDebugLogs');
const enableLogSavingCheckbox = document.getElementById('enableLogSaving');
const cacheCountSpan = document.getElementById('cacheCount');
const storageSizeSpan = document.getElementById('storageSize');
const cacheSearchInput = document.getElementById('cacheSearch');
const modeFilterSelect = document.getElementById('modeFilter');
const cacheListDiv = document.getElementById('cacheList');
const clearAllCacheBtn = document.getElementById('clearAllCache');

// Load saved settings on page load
loadSettings();
loadLicenseKey();
loadCacheSettings();
loadCacheList();
updateBuyLicenseVisibility();
updateApiKeyVisibility();

/**
 * Load saved settings from chrome.storage
 */
async function loadSettings() {
  try {
    const result = await chrome.storage.sync.get([
      'openaiApiKey',
      'textModel',
      'imageModel',
      'storeImagesLocally'
    ]);

    // Do not load key value into input — visibility handled by updateApiKeyVisibility()

    if (result.textModel && textModelSelect.querySelector(`option[value="${result.textModel}"]`)) {
      textModelSelect.value = result.textModel;
    }

    if (result.imageModel && imageModelSelect.querySelector(`option[value="${result.imageModel}"]`)) {
      imageModelSelect.value = result.imageModel;
    }

    // Default to true if not set
    storeImagesLocallyCheckbox.checked = result.storeImagesLocally !== undefined
      ? result.storeImagesLocally
      : true;

  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

/**
 * Save settings to chrome.storage
 */
async function saveSettings() {
  const apiKey = apiKeyInput.value.trim();

  if (!apiKey) {
    showStatus('Please enter your OpenAI API key', 'error');
    return;
  }

  if (!apiKey.startsWith('sk-')) {
    showStatus('Invalid API key format. OpenAI keys start with "sk-"', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({
      openaiApiKey: apiKey,
      textModel: textModelSelect.value,
      imageModel: imageModelSelect.value,
      storeImagesLocally: storeImagesLocallyCheckbox.checked
    });

    showStatus('Settings saved successfully!', 'success');
    updateApiKeyVisibility();

  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Failed to save settings: ' + error.message, 'error');
  }
}

/**
 * Show status message
 */
function showStatus(message, type = 'success') {
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      statusDiv.style.display = 'none';
    }, 3000);
  }
}

/**
 * Show/hide API key input vs saved indicator based on storage
 */
async function updateApiKeyVisibility() {
  try {
    const result = await chrome.storage.sync.get(['openaiApiKey']);
    const hasKey = !!result.openaiApiKey;

    apiKeyFormGroup.style.display = hasKey ? 'none' : 'block';
    apiKeySavedIndicator.style.display = hasKey ? 'flex' : 'none';
    apiKeyButtonGroup.style.display = hasKey ? 'none' : 'block';
    apiKeySavedButtonGroup.style.display = hasKey ? 'flex' : 'none';
  } catch (error) {
    console.error('Error updating API key visibility:', error);
  }
}

/**
 * Clear saved API key and return to entry state
 */
async function clearApiKey() {
  if (!confirm('Clear your API key? You will need to re-enter it to use the extension.')) return;
  try {
    await chrome.storage.sync.set({ openaiApiKey: '' });
    apiKeyInput.value = '';
    updateApiKeyVisibility();
    showStatus('API key cleared.', 'success');
  } catch (error) {
    console.error('Error clearing API key:', error);
    showStatus('Failed to clear API key: ' + error.message, 'error');
  }
}

/**
 * ============================================================================
 * LICENSE KEY FUNCTIONS
 * ============================================================================
 */

/**
 * Load saved license key from chrome.storage
 */
async function loadLicenseKey() {
  try {
    const result = await chrome.storage.sync.get(['licenseKey']);

    if (result.licenseKey) {
      licenseKeyInput.value = result.licenseKey;
    }

  } catch (error) {
    console.error('Error loading license key:', error);
  }
}

/**
 * Save license key to chrome.storage
 */
async function saveLicenseKey() {
  const licenseKey = licenseKeyInput.value.trim();

  try {
    // Empty key - clear it
    if (licenseKey === '') {
      await chrome.storage.sync.set({
        licenseKey: '',
        licenseValid: false
      });
      showLicenseStatus('License key cleared', 'success');
      return;
    }

    // Validate customer license via API
    showLicenseStatus('Validating license key...', 'info');

    // Cloudflare Worker URL for license validation
    const WORKER_URL = 'https://api.websitemodifier.com';

    try {
      const response = await fetch(`${WORKER_URL}/validate?key=${encodeURIComponent(licenseKey)}`);

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const result = await response.json();

      if (result.valid) {
        // Valid license - save it
        await chrome.storage.sync.set({
          licenseKey: licenseKey,
          licenseValid: true,
          licenseValidatedAt: Date.now()
        });
        showLicenseStatus('✅ License activated successfully!', 'success');
      } else {
        // Invalid license - don't save
        showLicenseStatus(`❌ Invalid license key: ${result.error || 'Unknown error'}`, 'error');
      }
    } catch (apiError) {
      console.error('License validation API error:', apiError);
      showLicenseStatus(`❌ Failed to validate license: ${apiError.message}. Please check your internet connection.`, 'error');
    }

  } catch (error) {
    console.error('Error saving license key:', error);
    showLicenseStatus('Failed to save license key: ' + error.message, 'error');
  }
}

/**
 * Show license status message
 */
function showLicenseStatus(message, type = 'success') {
  licenseStatusDiv.textContent = message;
  licenseStatusDiv.className = `status ${type}`;
  licenseStatusDiv.style.display = 'block';

  // Auto-hide success messages after 3 seconds
  if (type === 'success') {
    setTimeout(() => {
      licenseStatusDiv.style.display = 'none';
    }, 3000);
  }
}

/**
 * Toggle license key visibility
 */
function toggleLicenseKeyVisibility() {
  if (licenseKeyInput.type === 'password') {
    licenseKeyInput.type = 'text';
    toggleLicenseKeyBtn.textContent = '🙈';
  } else {
    licenseKeyInput.type = 'password';
    toggleLicenseKeyBtn.textContent = '👁️';
  }
}

/**
 * Clear license key (go back to unlicensed mode)
 */
async function clearLicenseKey() {
  if (!confirm('Are you sure you want to clear your license key? Watermarks will appear on all transformed pages.')) {
    return;
  }

  try {
    await chrome.storage.sync.set({
      licenseKey: '',
      licenseValid: false
    });

    licenseKeyInput.value = '';
    showLicenseStatus('License key cleared - watermarks will now appear', 'success');

  } catch (error) {
    console.error('Error clearing license key:', error);
    showLicenseStatus('Failed to clear license key: ' + error.message, 'error');
  }
}

/**
 * ============================================================================
 * CACHE MANAGEMENT FUNCTIONS
 * ============================================================================
 */

/**
 * Load cache settings (auto-intercept toggles and debug logging)
 */
async function loadCacheSettings() {
  try {
    const result = await chrome.storage.local.get([
      'autoInterceptSettings',
      'enableDebugLogs',
      'enableLogSaving'
    ]);

    const settings = result.autoInterceptSettings || {
      interceptOriginalUrls: false,
      interceptGeneratedUrls: false
    };

    // Default debug logs to FALSE (production mode)
    const enableDebugLogs = result.enableDebugLogs !== undefined ? result.enableDebugLogs : false;

    // Default log saving to FALSE
    const enableLogSaving = result.enableLogSaving !== undefined ? result.enableLogSaving : false;

    interceptOriginalUrlsCheckbox.checked = settings.interceptOriginalUrls;
    interceptGeneratedUrlsCheckbox.checked = settings.interceptGeneratedUrls;

    // Set debug logging toggle
    enableDebugLogsCheckbox.checked = enableDebugLogs;

    // Set save logs toggle and enable/disable based on parent
    enableLogSavingCheckbox.checked = enableLogSaving;
    updateSaveLogsToggle(enableDebugLogs);

  } catch (error) {
    console.error('Error loading cache settings:', error);
  }
}

/**
 * Enable/disable "Save logs" toggle based on "Enable debug logs" state
 */
function updateSaveLogsToggle(debugLogsEnabled) {
  const saveLogsLabel = document.getElementById('saveLogsLabel');

  if (debugLogsEnabled) {
    // Enable save logs toggle
    enableLogSavingCheckbox.disabled = false;
    saveLogsLabel.style.opacity = '1';
  } else {
    // Disable save logs toggle
    enableLogSavingCheckbox.disabled = true;
    saveLogsLabel.style.opacity = '0.5';
    // Note: Checkbox state is handled by the parent toggle's change event
  }
}

/**
 * Save cache settings
 */
async function saveCacheSettings() {
  try {
    await chrome.storage.local.set({
      autoInterceptSettings: {
        interceptOriginalUrls: interceptOriginalUrlsCheckbox.checked,
        interceptGeneratedUrls: interceptGeneratedUrlsCheckbox.checked
      },
      enableDebugLogs: enableDebugLogsCheckbox.checked,
      enableLogSaving: enableLogSavingCheckbox.checked
    });

    showStatus('Settings saved!', 'success');

  } catch (error) {
    console.error('Error saving cache settings:', error);
    showStatus('Failed to save settings: ' + error.message, 'error');
  }
}

/**
 * Load and display cache list
 */
async function loadCacheList() {
  try {
    // Get cache stats
    const stats = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'getCacheStats' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
    cacheCountSpan.textContent = stats.count;
    storageSizeSpan.textContent = stats.sizeString;

    // Get cached entries
    const query = cacheSearchInput.value.trim();
    const modeFilter = modeFilterSelect.value;
    const entries = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'searchCache',
        query,
        modeFilter
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });

    // Clear list
    cacheListDiv.innerHTML = '';

    // Display entries
    entries.forEach(entry => {
      const entryEl = createCacheEntryElement(entry);
      cacheListDiv.appendChild(entryEl);
    });

  } catch (error) {
    console.error('Error loading cache list:', error);
    cacheListDiv.innerHTML = `<div style="color: #ef4444; text-align: center; padding: 20px;">Error loading cache: ${error.message}<br><small>Try reloading the extension</small></div>`;
  }
}

/**
 * Create HTML element for a cache entry
 */
function createCacheEntryElement(entry) {
  const div = document.createElement('div');
  div.className = 'cache-entry';

  const modeBadgeClass = entry.metadata.mode === 'transform' ? 'mode-badge transform' : 'mode-badge';

  div.innerHTML = `
    <div class="cache-header">
      <span class="${modeBadgeClass}">${entry.metadata.mode} Mode</span>
      <span class="cache-date">${entry.metadata.date}</span>
    </div>

    <div class="cache-urls">
      <div class="url-row">
        <label>Original:</label>
        <a href="${entry.originalUrl}" target="_blank" title="${entry.originalUrl}">
          ${truncateUrl(entry.originalUrl)}
        </a>
        <button class="btn-copy" data-url="${entry.originalUrl}" title="Copy URL">📋</button>
      </div>
      ${entry.generatedUrl ? `
        <div class="url-row">
          <label>Generated:</label>
          <a href="${entry.generatedUrl}" target="_blank" title="${entry.generatedUrl}">
            ${truncateUrl(entry.generatedUrl)}
          </a>
          <button class="btn-copy" data-url="${entry.generatedUrl}" title="Copy URL">📋</button>
        </div>
      ` : ''}
    </div>

    <div class="cache-topic">
      <strong>${entry.metadata.mode === 'replace' ? 'Topic' : 'Transform Prompt'}:</strong>
      ${entry.metadata.topic || entry.metadata.transformPrompt || 'N/A'}
    </div>

    <div class="cache-actions">
      <button class="btn-view-original" data-url="${entry.originalUrl}">Visit Original</button>
      ${entry.generatedUrl ? `<button class="btn-view-generated" data-url="${entry.generatedUrl}">Visit Generated</button>` : ''}
      <button class="btn-delete" data-id="${entry.id}">Delete</button>
    </div>
  `;

  // Add event listeners
  div.querySelectorAll('.btn-copy').forEach(btn => {
    btn.addEventListener('click', () => copyToClipboard(btn.dataset.url));
  });

  div.querySelectorAll('.btn-view-original, .btn-view-generated').forEach(btn => {
    btn.addEventListener('click', () => window.open(btn.dataset.url, '_blank'));
  });

  div.querySelector('.btn-delete').addEventListener('click', async () => {
    if (confirm('Are you sure you want to delete this cached transformation?')) {
      await deleteTransformation(entry.id);
    }
  });

  return div;
}

/**
 * Truncate URL for display
 */
function truncateUrl(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    if (path.length > 60) {
      return urlObj.hostname + path.substring(0, 57) + '...';
    }
    return urlObj.hostname + path;
  } catch {
    return url.length > 60 ? url.substring(0, 57) + '...' : url;
  }
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus('URL copied to clipboard!', 'success');
  } catch (error) {
    console.error('Error copying to clipboard:', error);
  }
}

/**
 * Delete a transformation from cache
 */
async function deleteTransformation(id) {
  try {
    const success = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'deleteTransformation',
        id
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });

    if (success) {
      showStatus('Transformation deleted!', 'success');
      loadCacheList();
    } else {
      showStatus('Failed to delete transformation', 'error');
    }

  } catch (error) {
    console.error('Error deleting transformation:', error);
    showStatus('Error: ' + error.message, 'error');
  }
}

/**
 * Clear all cache
 */
async function clearCache() {
  if (!confirm('Are you sure you want to clear ALL cached transformations? This cannot be undone.')) {
    return;
  }

  try {
    const success = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: 'clearAllCache' }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });

    if (success) {
      showStatus('All cache cleared!', 'success');
      loadCacheList();
    } else {
      showStatus('Failed to clear cache', 'error');
    }

  } catch (error) {
    console.error('Error clearing cache:', error);
    showStatus('Error: ' + error.message, 'error');
  }
}

// Auto-save model settings on change
async function saveModelSettings() {
  try {
    await chrome.storage.sync.set({
      textModel: textModelSelect.value,
      imageModel: imageModelSelect.value,
      storeImagesLocally: storeImagesLocallyCheckbox.checked
    });
    debug.log('[Config] Model settings auto-saved');
  } catch (error) {
    console.error('Error auto-saving model settings:', error);
  }
}

textModelSelect.addEventListener('change', saveModelSettings);
imageModelSelect.addEventListener('change', saveModelSettings);
storeImagesLocallyCheckbox.addEventListener('change', saveModelSettings);

// Event listeners
saveBtn.addEventListener('click', saveSettings);
clearApiKeyBtn.addEventListener('click', clearApiKey);

// License key event listeners
saveLicenseBtn.addEventListener('click', saveLicenseKey);
clearLicenseBtn.addEventListener('click', clearLicenseKey);
clearLicensedBtn.addEventListener('click', clearLicenseKey); // Same function for licensed state
toggleLicenseKeyBtn.addEventListener('click', toggleLicenseKeyVisibility);
licenseKeyInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    saveLicenseKey();
  }
});

// Cache event listeners
interceptOriginalUrlsCheckbox.addEventListener('change', saveCacheSettings);
interceptGeneratedUrlsCheckbox.addEventListener('change', saveCacheSettings);

// Debug logging toggle event listeners
enableDebugLogsCheckbox.addEventListener('change', async () => {
  const enabled = enableDebugLogsCheckbox.checked;

  // Update child toggle state
  updateSaveLogsToggle(enabled);

  // IMPORTANT: If disabling debug logs, automatically uncheck and save enableLogSaving
  if (!enabled) {
    enableLogSavingCheckbox.checked = false;
  }

  // Save both settings to storage
  await chrome.storage.local.set({
    enableDebugLogs: enabled,
    enableLogSaving: enabled ? enableLogSavingCheckbox.checked : false  // Force false when parent is disabled
  });
});

// Save log saving setting when child toggle changes
enableLogSavingCheckbox.addEventListener('change', async () => {
  // Only save if parent is enabled (shouldn't be possible to change otherwise, but defensive)
  if (enableDebugLogsCheckbox.checked) {
    await chrome.storage.local.set({
      enableLogSaving: enableLogSavingCheckbox.checked
    });
  }
});

cacheSearchInput.addEventListener('input', loadCacheList);
modeFilterSelect.addEventListener('change', loadCacheList);
clearAllCacheBtn.addEventListener('click', clearCache);

// Save on Enter key
apiKeyInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    saveSettings();
  }
});

/**
 * Update buy license button and licensed indicator visibility based on license status
 */
async function updateBuyLicenseVisibility() {
  try {
    const result = await chrome.storage.sync.get(['licenseValid']);
    const isLicensed = result.licenseValid === true;

    // Toggle buy license button
    if (buyLicenseBtn) {
      buyLicenseBtn.style.display = isLicensed ? 'none' : 'flex';
    }

    // Toggle licensed indicator
    if (licensedIndicator) {
      licensedIndicator.style.display = isLicensed ? 'flex' : 'none';
    }

    // Toggle license key input field
    if (licenseKeyFormGroup) {
      licenseKeyFormGroup.style.display = isLicensed ? 'none' : 'block';
    }

    // Toggle button groups
    if (licenseButtonGroup) {
      licenseButtonGroup.style.display = isLicensed ? 'none' : 'flex';
    }

    if (licensedButtonGroup) {
      licensedButtonGroup.style.display = isLicensed ? 'flex' : 'none';
    }

    debug.log(`[Config] ${isLicensed ? 'Licensed mode active' : 'Unlicensed mode active'}`);
  } catch (error) {
    console.error('❌ [Config] Error updating buy license visibility:', error);
  }
}
