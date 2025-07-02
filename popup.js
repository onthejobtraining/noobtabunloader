class TabUnloader {
  constructor() {
    this.SETTINGS_CONFIG = [
        { id: 'preventStartupLoad', type: 'checkbox', defaultValue: true },
        { id: 'theme', type: 'radio', defaultValue: 'auto' },
        { id: 'autoUnload', type: 'checkbox', defaultValue: false },
        { id: 'unloadMinutes', type: 'number', defaultValue: 30 },
        { id: 'autoUnloadCount', type: 'number', defaultValue: 0 },
        { id: 'excludePinned', type: 'checkbox', defaultValue: true },
        { id: 'whitelist', type: 'textarea', defaultValue: '' },
        { id: 'showMemory', type: 'checkbox', defaultValue: true },
        { id: 'showUnloadCurrent', type: 'checkbox', defaultValue: true },
        { id: 'showUnloadOthers', type: 'checkbox', defaultValue: true },
        { id: 'showUnloadAll', type: 'checkbox', defaultValue: true },
        { id: 'showReloadAll', type: 'checkbox', defaultValue: true }
    ];
    this.FRIENDLY_NAME_MAP = {
        'mail.google.com': 'Gmail', 'google.com': 'Google', 'reddit.com': 'Reddit',
        'youtube.com': 'YouTube', 'amazon.com': 'Amazon', 'flipkart.com': 'Flipkart',
        'pricehistoryapp.com': 'Pricehistoryapp', 'spotify.com': 'Spotify'
    };
    this.INTERNAL_ICONS = {
        'about:addons': 'data:image/svg+xml,%3csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"%3e%3cpath d="M14.5 8.5a1 1 0 0 0-1-1h-2v-2a1 1 0 0 0-1-1h-1a1 1 0 0 0-1 1v2h-2a1 1 0 1 0 0 2h2v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2h2a1 1 0 0 0 1-1zM3.5 0A3.5 3.5 0 0 0 0 3.5v5A3.5 3.5 0 0 0 3.5 12H4v1.5a2.5 2.5 0 0 0 2.5 2.5H8V12H3.5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V8h4V3.5A3.5 3.5 0 0 0 9.5 0h-6z"/%3e%3c/svg%3e',
        'fallback': 'data:image/svg+xml,%3csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="%23ddd"%3e%3crect width="16" height="16"/%3e%3c/svg%3e'
    };
    this.RELOAD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2.5a5.5 5.5 0 1 0 4.71 8.63l.79.79A6.5 6.5 0 1 1 8 1.5V2.5z M12.5 8a.75.75 0 0 1-.75.75h-3.5a.75.75 0 0 1 0-1.5h4.25c.41 0 .75.34.75.75z"/></svg>`;
    
    this.settings = {};
    this.snapshots = {};
    this.undoTimeout = null;

    this.init();
  }
  
  async init() {
    this.setupTabs();
    await this.loadSettingsFromStorage();
    this.populateUIFromSettings();
    await this.loadSnapshots();
    await this.updateStats();
    await this.renderTabList();
    this.setupEventListeners();
  }

  setupTabs() {
    const navTabs = document.querySelectorAll('.nav-tab');
    const contentPanes = document.querySelectorAll('.content-pane');
    navTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            navTabs.forEach(t => t.classList.remove('active'));
            contentPanes.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            const targetPane = document.querySelector(tab.dataset.target);
            if (targetPane) targetPane.classList.add('active');
        });
    });
  }
  
  setupEventListeners() {
    document.getElementById('unloadCurrent').addEventListener('click', () => this.handleUnloadAction('current'));
    document.getElementById('unloadOthers').addEventListener('click', () => this.handleUnloadAction('others', true));
    document.getElementById('unloadAll').addEventListener('click', () => this.handleUnloadAction('all', true));
    document.getElementById('reloadAll').addEventListener('click', () => this.reloadAllTabs());
    
    document.getElementById('settings-pane').addEventListener('change', (e) => {
        this.updateSettingsFromUI();
        this.updateDynamicUI();
        this.applyTheme();
        this.saveSettingsToStorage();
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.applyTheme());
    document.getElementById('save-snapshot-button').addEventListener('click', () => this.saveSnapshot());
    document.getElementById('snapshot-list').addEventListener('click', (e) => {
        const restoreBtn = e.target.closest('.snapshot-restore');
        const deleteBtn = e.target.closest('.snapshot-delete');
        if (restoreBtn) this.restoreSnapshot(restoreBtn.dataset.id);
        if (deleteBtn) this.deleteSnapshot(deleteBtn.dataset.id);
    });
  }

  async loadSettingsFromStorage() {
    const defaultSettings = this.SETTINGS_CONFIG.reduce((acc, {id, defaultValue}) => ({ ...acc, [id]: defaultValue }), {});
    this.settings = await browser.storage.local.get(defaultSettings);
  }

  populateUIFromSettings() {
    this.SETTINGS_CONFIG.forEach(({ id, type }) => {
        if (type === 'radio') {
            const radioToCheck = document.querySelector(`input[name="${id}"][value="${this.settings[id]}"]`);
            if (radioToCheck) radioToCheck.checked = true;
        } else {
            const element = document.getElementById(id);
            if (element) {
                if (type === 'checkbox') element.checked = this.settings[id];
                else element.value = this.settings[id];
            }
        }
    });
    this.applyTheme();
    this.updateDynamicUI();
  }

  updateSettingsFromUI() {
      this.SETTINGS_CONFIG.forEach(({ id, type }) => {
          if (type === 'radio') {
              const checkedRadio = document.querySelector(`input[name="${id}"]:checked`);
              if (checkedRadio) this.settings[id] = checkedRadio.value;
          } else {
              const element = document.getElementById(id);
              if (element) {
                  if (type === 'checkbox') this.settings[id] = element.checked;
                  else if (type === 'textarea') this.settings[id] = element.value;
                  else this.settings[id] = parseInt(element.value, 10) || 0;
              }
          }
      });
  }

  async saveSettingsToStorage() {
    await browser.storage.local.set(this.settings);
    await browser.runtime.sendMessage({ action: 'updateSettings', settings: this.settings });
  }

  updateDynamicUI() {
    document.getElementById('autoUnloadTime').style.display = this.settings.autoUnload ? 'flex' : 'none';
    
    ['showUnloadCurrent', 'showUnloadOthers', 'showUnloadAll', 'showReloadAll'].forEach(settingKey => {
        const buttonId = settingKey.replace('show', '').charAt(0).toLowerCase() + settingKey.slice(5);
        const button = document.getElementById(buttonId);
        if(button) button.style.display = this.settings[settingKey] ? 'flex' : 'none';
    });
    const topRow = document.querySelector('.button-row:first-child');
    if (topRow) topRow.style.display = (this.settings.showUnloadCurrent || this.settings.showUnloadOthers) ? 'flex' : 'none';
    const bottomRow = document.querySelector('.button-row:last-child');
    if (bottomRow) bottomRow.style.display = (this.settings.showUnloadAll || this.settings.showReloadAll) ? 'flex' : 'none';
  }

  applyTheme() {
    document.body.classList.remove('light-theme', 'dark-theme');
    const useDark = this.settings.theme === 'dark' || (this.settings.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.body.classList.add(useDark ? 'dark-theme' : 'light-theme');
  }

  // The rest of popup.js is unchanged and correct.
  async updateStats() { const tabs = await browser.tabs.query({}); const unloadedCount = tabs.filter(tab => tab.discarded).length; document.getElementById('totalTabs').textContent = tabs.length; document.getElementById('unloadedTabs').textContent = unloadedCount; document.getElementById('memoryFreed').textContent = `${unloadedCount * 50}MB`; }
  async renderTabList() { const tabList = document.getElementById('tabList'); tabList.style.display = 'block'; while (tabList.firstChild) tabList.removeChild(tabList.firstChild); const tabs = await browser.tabs.query({ active: false, windowType: 'normal' }); if (tabs.length > 0) { tabs.forEach(tab => { const tabElement = this._createTabItemElement(tab); tabList.appendChild(tabElement); }); } else { const emptyMessage = document.createElement('div'); emptyMessage.style.cssText = 'padding: 12px; text-align: center; font-size: 11px; color: var(--text-color-secondary);'; emptyMessage.textContent = 'No other tabs open'; tabList.appendChild(emptyMessage); } }
  _createTabItemElement(tab) { const item = document.createElement('div'); item.className = 'tab-item'; item.dataset.tabId = tab.id; const favicon = document.createElement('img'); favicon.className = 'tab-favicon'; favicon.src = this._getIconForTab(tab); favicon.onerror = () => { favicon.src = this.INTERNAL_ICONS.fallback; }; const title = document.createElement('span'); title.className = 'tab-title'; title.title = tab.title; title.textContent = this._cleanTabTitle(tab.title, tab.url); const infoRight = this._getStatusAndActionElement(tab); item.appendChild(favicon); item.appendChild(title); item.appendChild(infoRight); return item; }
  _getStatusAndActionElement(tab) { const container = document.createElement('div'); container.className = 'tab-info-right'; const statusText = document.createElement('span'); statusText.className = 'status-text'; const indicator = document.createElement('div'); indicator.className = 'status-indicator'; let actionButton; if (tab.discarded) { if (this.settings.showMemory) { const memoryBadge = document.createElement('span'); memoryBadge.className = 'memory-badge'; memoryBadge.textContent = '~50MB'; container.appendChild(memoryBadge); } indicator.classList.add('status-unloaded'); statusText.textContent = 'Unloaded'; actionButton = document.createElement('button'); actionButton.className = 'action-button reload-btn'; actionButton.title = 'Reload tab'; actionButton.innerHTML = this.RELOAD_ICON_SVG; } else { indicator.classList.add('status-active'); statusText.textContent = 'Loaded'; actionButton = document.createElement('button'); actionButton.className = 'action-button unload-btn'; actionButton.textContent = 'UNLOAD'; } statusText.prepend(indicator); container.appendChild(statusText); container.appendChild(actionButton); actionButton.addEventListener('click', (e) => this.handleTabAction(e)); return container; }
  async handleTabAction(e) { e.stopPropagation(); const button = e.currentTarget; const tabItem = button.closest('.tab-item'); const tabId = parseInt(tabItem.dataset.tabId, 10); button.disabled = true; if (button.classList.contains('reload-btn')) { await browser.tabs.reload(tabId); } else { await browser.runtime.sendMessage({ action: 'unloadTab', tabId: tabId }); } setTimeout(async () => { try { const updatedTab = await browser.tabs.get(tabId); const newTabItemElement = this._createTabItemElement(updatedTab); tabItem.replaceWith(newTabItemElement); } catch(e) { tabItem.remove(); } this.updateStats(); }, 300); }
  async handleUnloadAction(type, showUndo = false) { const commandMap = { current: 'unload-current-tab', others: 'unload-others', all: 'unload-all' }; if (commandMap[type]) { const unloadedTabIds = await browser.runtime.sendMessage({ action: 'executeCommand', command: commandMap[type] }); if (showUndo && unloadedTabIds && unloadedTabIds.length > 0) { this.showUndoButton(unloadedTabIds); } else if (!showUndo) { setTimeout(() => window.close(), 100); } } setTimeout(() => { this.updateStats(); this.renderTabList(); }, 300); }
  showUndoButton(tabIds) { const undoContainer = document.getElementById('undo-container'); clearTimeout(this.undoTimeout); const undoButton = document.createElement('button'); undoButton.id = 'undo-button'; undoButton.textContent = `Undo Unload (${tabIds.length})`; undoButton.onclick = async () => { await browser.runtime.sendMessage({ action: 'reloadTabs', tabIds }); undoContainer.innerHTML = ''; clearTimeout(this.undoTimeout); await this.updateStats(); await this.renderTabList(); }; undoContainer.innerHTML = ''; undoContainer.appendChild(undoButton); this.undoTimeout = setTimeout(() => { undoContainer.innerHTML = ''; }, 7000); }
  async reloadAllTabs() { const tabs = await browser.tabs.query({discarded: true}); await Promise.all(tabs.map(tab => browser.tabs.reload(tab.id))); setTimeout(() => window.close(), 100); }
  async loadSnapshots() { const data = await browser.storage.local.get('snapshots'); this.snapshots = data.snapshots || {}; this.renderSnapshots(); }
  renderSnapshots() { const list = document.getElementById('snapshot-list'); while(list.firstChild) list.removeChild(list.firstChild); if (Object.keys(this.snapshots).length === 0) { const emptyMessage = document.createElement('div'); emptyMessage.style.cssText = 'padding: 12px; text-align: center; font-size: 11px; color: var(--text-color-secondary);'; emptyMessage.textContent = 'No saved snapshots'; list.appendChild(emptyMessage); return; } Object.entries(this.snapshots).forEach(([id, snapshot]) => { const item = document.createElement('div'); item.className = 'snapshot-item'; const name = document.createElement('span'); name.className = 'snapshot-name'; name.textContent = `${snapshot.name} (${snapshot.tabs.length} tabs)`; const controls = document.createElement('div'); controls.className = 'snapshot-controls'; const restoreBtn = document.createElement('button'); restoreBtn.className = 'snapshot-restore success'; restoreBtn.dataset.id = id; restoreBtn.textContent = 'Restore'; const deleteBtn = document.createElement('button'); deleteBtn.className = 'snapshot-delete danger'; deleteBtn.dataset.id = id; deleteBtn.innerHTML = '<svg style="width:12px; height:12px;"><use href="#icon-delete"/></svg>'; controls.appendChild(restoreBtn); controls.appendChild(deleteBtn); item.appendChild(name); item.appendChild(controls); list.appendChild(item); }); }
  async saveSnapshot() { const nameInput = document.getElementById('snapshot-name-input'); let name = nameInput.value.trim(); if (!name) name = `Session - ${new Date().toLocaleDateString()}`; const tabs = await browser.tabs.query({ currentWindow: true, pinned: false }); const snapshotId = `snap_${Date.now()}`; this.snapshots[snapshotId] = { name, tabs: tabs.map(t => ({ url: t.url, title: t.title })) }; await browser.storage.local.set({ snapshots: this.snapshots }); nameInput.value = ''; this.renderSnapshots(); }
  async restoreSnapshot(id) { const snapshot = this.snapshots[id]; if (snapshot) { for (const tab of snapshot.tabs) { await browser.tabs.create({ url: tab.url, active: false }); } } }
  async deleteSnapshot(id) { delete this.snapshots[id]; await browser.storage.local.set({ snapshots: this.snapshots }); this.renderSnapshots(); }
  _getIconForTab(tab) { for (const urlPrefix in this.INTERNAL_ICONS) { if (tab.url && tab.url.startsWith(urlPrefix)) return this.INTERNAL_ICONS[urlPrefix]; } return tab.favIconUrl || this.INTERNAL_ICONS.fallback; }
  _cleanTabTitle(title, url) { const internalPageTitles = { 'about:debugging': 'Debugging', 'about:addons': 'Add-ons Manager', 'about:processes': 'Process Manager', 'about:profiles': 'About Profiles', 'about:newtab': 'New Tab', }; if (url && url.startsWith('about:')) return internalPageTitles[url] || title; try { const hostname = new URL(url).hostname.replace(/^www\./, ''); if (this.FRIENDLY_NAME_MAP[hostname]) return this.FRIENDLY_NAME_MAP[hostname]; const domainParts = hostname.split('.'); if (domainParts.length >= 2) { const mainDomain = domainParts[domainParts.length - 2]; return mainDomain.charAt(0).toUpperCase() + mainDomain.slice(1); } return hostname; } catch (e) { return title || 'Unknown Tab'; } }
}

document.addEventListener('DOMContentLoaded', () => new TabUnloader());
