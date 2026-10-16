// server/workshop-watcher.js — Hot reload watcher for workshop directory changes
import chokidar from 'chokidar';
import path from 'path';

/**
 * Create a file system watcher for workshop directory that triggers hot reload on changes.
 * 
 * @param {string} workshopDir - Path to workshop directory
 * @param {Object} options
 * @param {Function} options.onReload - Callback when reload is triggered, receives { modId, path, event }
 * @param {Object} [options.log] - Logger instance
 * @returns {{ start: Function, stop: Function, watcher: Object }}
 */
export function createWorkshopWatcher(workshopDir, { onReload, log = null }) {
  let watcher = null;
  let debounceTimers = new Map();
  
  const start = () => {
    if (watcher) {
      log?.warn?.('[WORKSHOP-WATCHER] Already started');
      return;
    }
    
    log?.info?.(`[WORKSHOP-WATCHER] Starting watch on ${workshopDir}`);
    
    watcher = chokidar.watch([
      path.join(workshopDir, '*/pack.json'),
      path.join(workshopDir, '*/chess.json'),
      path.join(workshopDir, '*/items.json'),
      path.join(workshopDir, '*/status.json'),
      path.join(workshopDir, '*/kits/*.js'),
    ], {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });
    
    const handleChange = (event, filePath) => {
      const relativePath = path.relative(workshopDir, filePath);
      const modId = relativePath.split(path.sep)[0];
      
      // Debounce: 如果同一个模组在 1 秒内多次变化，只触发一次重载
      if (debounceTimers.has(modId)) {
        clearTimeout(debounceTimers.get(modId));
      }
      
      debounceTimers.set(modId, setTimeout(() => {
        debounceTimers.delete(modId);
        log?.info?.(`[WORKSHOP-WATCHER] ${event}: ${relativePath} → reloading ${modId}`);
        
        try {
          onReload({ modId, path: filePath, event });
        } catch (err) {
          log?.error?.(`[WORKSHOP-WATCHER] Reload callback failed:`, err);
        }
      }, 1000));
    };
    
    watcher
      .on('add', (path) => handleChange('add', path))
      .on('change', (path) => handleChange('change', path))
      .on('unlink', (path) => handleChange('unlink', path))
      .on('error', (error) => {
        log?.error?.(`[WORKSHOP-WATCHER] Error:`, error);
      })
      .on('ready', () => {
        log?.info?.('[WORKSHOP-WATCHER] Ready, watching for changes');
      });
    
    return watcher;
  };
  
  const stop = () => {
    if (!watcher) return;
    
    log?.info?.('[WORKSHOP-WATCHER] Stopping...');
    
    // Clear all pending debounce timers
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
    
    watcher.close();
    watcher = null;
  };
  
  return { start, stop, get watcher() { return watcher; } };
}
