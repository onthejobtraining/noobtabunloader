class TabUnloaderBackground {
  constructor() {
    this.defaultSettings = {
      preventStartupLoad: true,
      autoUnload: false,
      unloadMinutes: 30,
      autoUnloadCount: 0, 
      excludePinned: true,
      whitelist: '',
    };
    this.settings = {};
    this.ALARM_PREFIX = 'unload-tab-';
    this.startupUnloadPerformed = false;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupListeners();
    // This is a one-time action that runs when the addon first loads.
    this.performStartupUnload();
    // This sets up the ongoing timed unloaders.
    await this.refreshAllAlarms();
    await this.updateBadge();
  }

  async loadSettings() {
    this.settings = await browser.storage.local.get(this.defaultSettings);
  }

  setupListeners() {
    browser.runtime.onStartup.addListener(() => this.performStartupUnload());
    browser.alarms.onAlarm.addListener(alarm => this.handleAlarm(alarm));
    browser.commands.onCommand.addListener(command => this.handleCommand(command));
    browser.runtime.onMessage.addListener(message => this.handleMessage(message));

    browser.tabs.onCreated.addListener(() => {
        this.refreshAllAlarms();
        this.handleTabCountChange(); // Restore the tab count check
    });
    browser.tabs.onRemoved.addListener(() => this.refreshAllAlarms());
    browser.tabs.onActivated.addListener(() => this.refreshAllAlarms());
    browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === 'complete' || typeof changeInfo.pinned === 'boolean') {
            this.refreshAllAlarms();
        }
    });
  }

  async performStartupUnload() {
    if (this.startupUnloadPerformed) return;
    this.startupUnloadPerformed = true;

    if (!this.settings.preventStartupLoad) return;
    
    // Get all tabs that are not active and not already discarded.
    const tabsToUnload = await browser.tabs.query({ discarded: false, active: false });

    for (const tab of tabsToUnload) {
      // Use the standard exemption check, which correctly respects the "Exclude pinned tabs" setting.
      if (!this.isExempt(tab)) {
          this.unloadTab(tab.id);
      }
    }
  }
  
  async refreshAllAlarms() {
    await browser.alarms.clearAll();
    if (!this.settings.autoUnload) return;

    const tabs = await browser.tabs.query({ windowType: 'normal' });
    for (const tab of tabs) {
      if (!tab.active && !this.isExempt(tab)) {
        browser.alarms.create(this.ALARM_PREFIX + tab.id, {
          delayInMinutes: this.settings.unloadMinutes
        });
      }
    }
  }

  async handleMessage(message) {
    switch (message.action) {
      case 'updateSettings':
        await this.loadSettings();
        await this.refreshAllAlarms();
        return;
      case 'executeCommand':
        return this.handleCommand(message.command);
      case 'reloadTabs':
        await Promise.all(message.tabIds.map(id => browser.tabs.reload(id)));
        await this.updateBadge();
        return;
      case 'unloadTab':
        await this.unloadTab(message.tabId);
        return;
    }
  }

  async handleAlarm(alarm) {
    if (alarm.name.startsWith(this.ALARM_PREFIX)) {
      const tabId = parseInt(alarm.name.substring(this.ALARM_PREFIX.length), 10);
      try {
        const tab = await browser.tabs.get(tabId);
        if (!tab.active && !this.isExempt(tab)) {
          await this.unloadTab(tab.id);
        }
      } catch (e) { /* Tab was likely closed */ }
    }
  }

  isExempt(tab) {
    if (tab.discarded) return true; 
    if (this.settings.excludePinned && tab.pinned) return true;
    if (!tab.url || !tab.url.startsWith('http')) return true;
    
    const whitelistDomains = this.settings.whitelist.split('\n').map(d => d.trim()).filter(Boolean);
    if (whitelistDomains.length === 0) return false;
    
    try {
        const hostname = new URL(tab.url).hostname;
        return whitelistDomains.some(domain => hostname.includes(domain));
    } catch (e) {
        return true;
    }
  }
  
  async unloadTab(tabId) {
    try {
        await browser.tabs.discard(tabId);
        await this.updateBadge();
    } catch (e) {
        console.warn(`Could not unload tab ${tabId}:`, e.message);
    }
  }

  async updateBadge() {
    const unloadedTabs = await browser.tabs.query({ discarded: true });
    const count = unloadedTabs.length;
    await browser.browserAction.setBadgeText({ text: count > 0 ? count.toString() : '' });
    await browser.browserAction.setBadgeBackgroundColor({ color: '#00695C' });
  }
  
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
      if (!this.isExempt(tab)) {
        unloadedTabIds.push(tab.id);
      }
    }
    for (const id of unloadedTabIds) {
        await this.unloadTab(id);
    }
    return unloadedTabIds;
  }
  
  // This function is now correctly restored and called from the onCreated listener.
  async handleTabCountChange() {
    await this.loadSettings();
    if (this.settings.autoUnloadCount <= 0) return;
    const tabs = await browser.tabs.query({ windowType: 'normal' });
    if (tabs.length > this.settings.autoUnloadCount) {
      const eligibleTabs = tabs.filter(t => !t.active && !this.isExempt(t));
      if (eligibleTabs.length > 0) {
        eligibleTabs.sort((a, b) => a.lastAccessed - b.lastAccessed);
        this.unloadTab(eligibleTabs[0].id);
      }
    }
  }
}

new TabUnloaderBackground();
