/**
 * IndexedDB helper module for storing DALL-E images locally
 * Provides persistent storage for generated images so they never expire
 *
 * NOTE: This file is imported into background.js via importScripts(),
 * so it shares the same global scope. The debug and originalConsole objects
 * are already defined in background.js - no need to redefine them here.
 */

const DB_NAME = 'transformationImages';
const DB_VERSION = 1;
const STORE_NAME = 'images';

/**
 * Open IndexedDB connection
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('❌ [IndexedDB] Failed to open database:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = db.createObjectStore(STORE_NAME, { autoIncrement: true });
        objectStore.createIndex('timestamp', 'timestamp', { unique: false });
        debug.log('✅ [IndexedDB] Created object store:', STORE_NAME);
      }
    };
  });
}

/**
 * Save image blob to IndexedDB
 * @param {Blob} blob - The image blob to store
 * @returns {Promise<string>} - Unique image ID
 */
async function saveImageBlob(blob) {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      // Store blob with metadata
      const imageData = {
        blob: blob,
        timestamp: Date.now(),
        size: blob.size,
        type: blob.type
      };

      const request = store.add(imageData);

      request.onsuccess = () => {
        const imageId = 'img_' + request.result;
        debug.log(`✅ [IndexedDB] Saved image: ${imageId} (${(blob.size / 1024).toFixed(1)} KB)`);
        resolve(imageId);
      };

      request.onerror = () => {
        console.error('❌ [IndexedDB] Failed to save image:', request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('❌ [IndexedDB] Error saving image blob:', error);
    throw error;
  }
}

/**
 * Get image data URL from IndexedDB
 * @param {string} imageId - The image ID (e.g., 'img_123')
 * @returns {Promise<string>} - Data URL for use in <img src=""> (data:image/png;base64,...)
 */
async function getImageBlobUrl(imageId) {
  try {
    const db = await openDB();
    const key = parseInt(imageId.replace('img_', ''));

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => {
        const imageData = request.result;

        if (!imageData) {
          console.error(`❌ [IndexedDB] Image not found: ${imageId}`);
          reject(new Error(`Image not found: ${imageId}`));
          return;
        }

        // Convert blob to data URL (works across all contexts)
        const reader = new FileReader();
        reader.onload = () => {
          debug.log(`✅ [IndexedDB] Retrieved image: ${imageId} (${(imageData.size / 1024).toFixed(1)} KB)`);
          resolve(reader.result);  // Returns data:image/png;base64,...
        };
        reader.onerror = () => {
          console.error(`❌ [IndexedDB] Failed to read blob for ${imageId}:`, reader.error);
          reject(new Error('Failed to read blob'));
        };
        reader.readAsDataURL(imageData.blob);
      };

      request.onerror = () => {
        console.error(`❌ [IndexedDB] Failed to retrieve image ${imageId}:`, request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error(`❌ [IndexedDB] Error getting image data URL for ${imageId}:`, error);
    throw error;
  }
}

/**
 * Delete single image from IndexedDB
 * @param {string} imageId - The image ID to delete
 * @returns {Promise<boolean>} - True if deleted successfully
 */
async function deleteImage(imageId) {
  try {
    const db = await openDB();
    const key = parseInt(imageId.replace('img_', ''));

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onsuccess = () => {
        debug.log(`✅ [IndexedDB] Deleted image: ${imageId}`);
        resolve(true);
      };

      request.onerror = () => {
        console.error(`❌ [IndexedDB] Failed to delete image ${imageId}:`, request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error(`❌ [IndexedDB] Error deleting image ${imageId}:`, error);
    return false;
  }
}

/**
 * Delete multiple images from IndexedDB
 * @param {string[]} imageIds - Array of image IDs to delete
 * @returns {Promise<number>} - Number of images deleted
 */
async function deleteImages(imageIds) {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      let deletedCount = 0;
      let errorCount = 0;

      imageIds.forEach(imageId => {
        const key = parseInt(imageId.replace('img_', ''));
        const request = store.delete(key);

        request.onsuccess = () => {
          deletedCount++;
        };

        request.onerror = () => {
          errorCount++;
          console.error(`❌ [IndexedDB] Failed to delete image ${imageId}:`, request.error);
        };
      });

      transaction.oncomplete = () => {
        debug.log(`✅ [IndexedDB] Deleted ${deletedCount}/${imageIds.length} images`);
        if (errorCount > 0) {
          debug.warn(`⚠️ [IndexedDB] ${errorCount} deletion(s) failed`);
        }
        db.close();
        resolve(deletedCount);
      };

      transaction.onerror = () => {
        console.error('❌ [IndexedDB] Transaction failed:', transaction.error);
        reject(transaction.error);
      };
    });
  } catch (error) {
    console.error('❌ [IndexedDB] Error deleting multiple images:', error);
    return 0;
  }
}

/**
 * Clear all images from IndexedDB
 * @returns {Promise<boolean>} - True if cleared successfully
 */
async function clearAllImages() {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        debug.log('✅ [IndexedDB] Cleared all images');
        resolve(true);
      };

      request.onerror = () => {
        console.error('❌ [IndexedDB] Failed to clear images:', request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('❌ [IndexedDB] Error clearing all images:', error);
    return false;
  }
}

/**
 * Get storage statistics
 * @returns {Promise<{count: number, totalSize: number}>}
 */
async function getStorageStats() {
  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const images = request.result;
        const count = images.length;
        const totalSize = images.reduce((sum, img) => sum + (img.size || 0), 0);

        debug.log(`📊 [IndexedDB] Stats: ${count} images, ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        resolve({ count, totalSize });
      };

      request.onerror = () => {
        console.error('❌ [IndexedDB] Failed to get stats:', request.error);
        reject(request.error);
      };

      transaction.oncomplete = () => {
        db.close();
      };
    });
  } catch (error) {
    console.error('❌ [IndexedDB] Error getting storage stats:', error);
    return { count: 0, totalSize: 0 };
  }
}
