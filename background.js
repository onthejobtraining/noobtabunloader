/**
 * Tab Unloader - Background Script
 * Handles all non-UI logic for the extension, including:
 * - Listening for browser events (startup, tab creation).
 * - Managing auto-unload alarms.
 * - Processing commands from the popup and keyboard shortcuts.
 * - Applying the "unloaded" state and icon to tabs.
 * - Updating the addon's badge count.
 */
class TabUnloaderBackground {
  constructor() {
    // Default settings ensure the addon works even before the user opens the popup.
    this.defaultSettings = {
      preventStartupLoad: true,
      autoUnload: false,
      unloadMinutes: 30,
      autoUnloadCount: 0, // 0 means this feature is disabled
      excludePinned: true,
      whitelist: 'get-it-done.com\nmusic.youtube.com',
    };

    // Current settings, loaded from storage.
    this.settings = {};
    
    // Constants for consistency.
    this.ALARM_PREFIX = 'unload-tab-';
    this.UNLOADED_FAVICON_URI = "data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3e%3cpath fill='%23e0e0e0' d='M1.5,1A.5.5,0,0,0,1,1.5v12A.5.5,0,0,0,1.5,14h13a.5.5,0,0,0,.5-.5v-12A.5.5,0,0,0,14.5,1Z' opacity='0.6'/%3e%3cpath fill='%23888' d='M1,2.5V1.5A.5.5,0,0,1,1.5,1h13a.5.5,0,0,1,.5.5V2.5Z'/%3e%3ctext fill='%23555' font-size='7.5' font-family='Arial,sans-serif' font-weight='bold' x='3' y='11.5'%3eZzz%3c/text%3e%3c/svg%3e";

    this.init();
  }

  /**
   * Initializes the background script by loading settings and setting up listeners.
   */
  async init() {
    await this.loadSettings();
    this.setupListeners();
    this.updateBadge();
  }

  /**
   * Loads settings from browser.storage.local, falling back to defaults.
   */
  async loadSettings() {
    this.settings = await browser.storage.local.get(this.defaultSettings);
  }

  /**
   * Sets up all necessary event listeners for the addon's functionality.
   */
  setupListeners() {
    // --- Browser Event Listeners ---
    browser.runtime.onStartup.addListener(() => this.handleStartup());
    browser.tabs.onCreated.addListener(() => this.handleTabCountChange());
    browser.tabs.onRemoved.addListener(() => this.updateBadge());
    browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
      // Update badge if a tab is reloaded (no longer discarded)
      if (changeInfo.discarded === false) this.updateBadge();
      // Reset auto-unload timer if a tab finishes loading
      if (changeInfo.status === 'complete') this.resetTabAlarm(tabId);
    });
    browser.tabs.onActivated.addListener(activeInfo => this.handleTabActivation(activeInfo.tabId));
    browser.alarms.onAlarm.addListener(alarm => this.handleAlarm(alarm));
    
    // --- Command & Message Listeners ---
    browser.commands.onCommand.addListener(command => this.handleCommand(command));
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sendResponse);
      return true; // Indicates we will respond asynchronously.
    });
  }

  /**
   * Handles incoming messages from the popup script.
   */
  async handleMessage(message, sendResponse) {
    switch (message.action) {
      case 'updateSettings':
        await this.loadSettings();
        this.startOrStopAutoUnload();
        break;
      case 'executeCommand':
        const unloadedIds = await this.handleCommand(message.command);
        sendResponse(unloadedIds);
        break;
      case 'reloadTabs':
        await Promise.all(message.tabIds.map(id => browser.tabs.reload(id)));
        this.updateBadge();
        break;
      case 'unloadTab':
        await this.unloadAndDecorateTab(message.tabId);
        break;
    }
  }

  // --- Core Feature Logic ---

  /**
   * On browser startup, unloads all non-active tabs if the setting is enabled.
   */
  async handleStartup() {
    await this.loadSettings();
    if (!this.settings.preventStartupLoad) return;

    const tabs = await browser.tabs.query({});
    for (const tab of tabs) {
      if (!tab.active && !this.isExempt(tab)) {
        this.unloadAndDecorateTab(tab.id);
      }
    }
  }

  /**
   * When a tab is created or removed, checks if the total count exceeds the user's limit.
   * If it does, it unloads the least recently used tab.
   */
  async handleTabCountChange() {
    await this.loadSettings();
    if (this.settings.autoUnloadCount <= 0) return;

    const tabs = await browser.tabs.query({ windowType: 'normal' });
    if (tabs.length > this.settings.autoUnloadCount) {
      const eligibleTabs = tabs.filter(t => !t.active && !this.isExempt(t));
      if (eligibleTabs.length > 0) {
        eligibleTabs.sort((a, b) => a.lastAccessed - b.lastAccessed);
        this.unloadAndDecorateTab(eligibleTabs[0].id);
      }
    }
  }

  /**
   * Processes commands from the popup or keyboard shortcuts.
   * @returns {Promise<number[]>} An array of tab IDs that were unloaded.
   */
  async handleCommand(command) {
    let query = {};
    switch(command) {
        case 'unload-current-tab': query = { active: true, currentWindow: true }; break;
        case 'unload-others':      query = { active: false, currentWindow: true }; break;
        case 'unload-all':         query = { currentWindow: true }; break;
        default: return [];
    }

    const tabs = await browser.tabs.query(query);
    const unloadedTabIds = [];

    for (const tab of tabs) {
      if (command === 'unload-all' && tab.active) continue; // Never unload the active tab on 'unload-all'
      if (!this.isExempt(tab)) {
        unloadedTabIds.push(tab.id);
      }
    }
    
    for (const id of unloadedTabIds) {
        await this.unloadAndDecorateTab(id);
    }
    
    return unloadedTabIds; // Return for the 'Undo' feature
  }

  // --- Auto-Unload Alarm Management ---
  
  handleTabActivation(activeTabId) {
    this.clearTabAlarm(activeTabId);
    this.setupAllTabAlarms(); // Re-evaluate alarms for other tabs
  }
  
  async handleAlarm(alarm) {
    if (alarm.name.startsWith(this.ALARM_PREFIX)) {
      const tabId = parseInt(alarm.name.substring(this.ALARM_PREFIX.length), 10);
      try {
        const tab = await browser.tabs.get(tabId);
        if (!tab.active && !this.isExempt(tab)) {
          await this.unloadAndDecorateTab(tabId);
        }
      } catch (e) { /* Tab was likely closed, which is fine */ }
    }
  }
  
  async startOrStopAutoUnload() {
    await browser.alarms.clear();
    if (this.settings.autoUnload) {
      this.setupAllTabAlarms();
    }
  }

  async setupAllTabAlarms() {
    if (!this.settings.autoUnload) return;
    const tabs = await browser.tabs.query({ windowType: 'normal' });
    for (const tab of tabs) {
      if (!tab.active) {
        this.resetTabAlarm(tab.id);
      }
    }
  }

  async resetTabAlarm(tabId) {
    this.clearTabAlarm(tabId);
    if (!this.settings.autoUnload) return;
    try {
      const tab = await browser.tabs.get(tabId);
      if (this.isExempt(tab)) return;
      browser.alarms.create(this.ALARM_PREFIX + tabId, { delayInMinutes: this.settings.unloadMinutes });
    } catch (e) { /* Tab might have been closed */ }
  }

  clearTabAlarm(tabId) {
    return browser.alarms.clear(this.ALARM_PREFIX + tabId);
  }

  // --- Helper Functions ---
  
  /**
   * Checks if a tab should be exempt from unloading based on current settings.
   * @param {browser.tabs.Tab} tab - The tab object to check.
   * @returns {boolean} True if the tab should be exempt.
   */
  isExempt(tab) {
    if (tab.discarded) return true;
    if (this.settings.excludePinned && tab.pinned) return true;
    if (!tab.url || tab.url.startsWith('about:') || tab.url.startsWith('moz-extension:')) return true;

    // Process the whitelist string on-the-fly for immediate updates.
    const whitelistDomains = this.settings.whitelist.split('\n').map(d => d.trim()).filter(Boolean);
    if(whitelistDomains.length === 0) return false;

    try {
        const hostname = new URL(tab.url).hostname;
        return whitelistDomains.some(domain => hostname.includes(domain));
    } catch (e) {
        return true; // Treat invalid URLs as exempt
    }
  }
  
  /**
   * The core action: discards a tab, applies the custom icon, and updates the badge.
   */
  async unloadAndDecorateTab(tabId) {
    try {
        await browser.tabs.discard(tabId);
        // Using update with a delay can be more reliable on some systems
        setTimeout(async () => {
            await browser.tabs.update(tabId, { favIconUrl: this.UNLOADED_FAVICON_URI });
        }, 100);
        this.updateBadge();
    } catch (e) {
        console.warn(`Could not unload or decorate tab ${tabId}:`, e.message);
    }
  }

  /**
   * Updates the number shown on the addon's toolbar icon.
   */
  async updateBadge() {
    const unloadedTabs = await browser.tabs.query({ discarded: true });
    const count = unloadedTabs.length;
    browser.browserAction.setBadgeText({ text: count > 0 ? count.toString() : '' });
    browser.browserAction.setBadgeBackgroundColor({ color: '#00695C' });
  }
}

new TabUnloaderBackground();