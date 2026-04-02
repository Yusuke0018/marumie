;(function initPopup() {
  const {
    STORAGE_KEY,
    clone,
    createDefaultSchedule,
    createExcludedRoomOverride,
    createRoomOverrideFromGlobal,
    getCurrentRoomIdFromHash,
    isExcludedRoom,
    isInheritedRoom,
    normalizeSettings,
    resolveRoomEditorSettings,
    toInheritedRoomOverride,
  } = globalThis.YoriwakeShared
  const DEBUG_KEY = 'yoriwakeDebug'
  const SETTINGS_EXPORT_SCHEMA_VERSION = 1

  const state = {
    settings: normalizeSettings(),
    rooms: [],
    membersByRoom: {},
    activeScope: 'global',
    selectedRoomId: '',
    roomQuery: '',
    senderQuery: '',
    bulkRoomQuery: '',
    bulkApplyTargetIds: [],
    authError: '',
    appError: '',
    saveStatus: '',
    saveStatusTimer: null,
    debugState: null,
    debugActionStatus: '',
    watchSenderQuery: '',
    vipSelectedRoomId: '',
    vipRoomQuery: '',
  }

  const elements = {
    authView: document.querySelector('#authView'),
    appView: document.querySelector('#appView'),
    pauseButton: document.querySelector('#pauseButton'),
    authTokenInput: document.querySelector('#authTokenInput'),
    authSaveButton: document.querySelector('#authSaveButton'),
    authImportButton: document.querySelector('#authImportButton'),
    authError: document.querySelector('#authError'),
    globalTabButton: document.querySelector('#globalTabButton'),
    roomTabButton: document.querySelector('#roomTabButton'),
    roomSelectWrap: document.querySelector('#roomSelectWrap'),
    roomSearchInput: document.querySelector('#roomSearchInput'),
    roomSelect: document.querySelector('#roomSelect'),
    scopeTitle: document.querySelector('#scopeTitle'),
    scopeMeta: document.querySelector('#scopeMeta'),
    accountBadge: document.querySelector('#accountBadge'),
    roomsBadge: document.querySelector('#roomsBadge'),
    scopeStateBadge: document.querySelector('#scopeStateBadge'),
    customRoomChips: document.querySelector('#customRoomChips'),
    inheritCheckbox: document.querySelector('#inheritCheckbox'),
    excludeRoomButton: document.querySelector('#excludeRoomButton'),
    roomInheritanceField: document.querySelector('#roomInheritanceField'),
    bulkApplySection: document.querySelector('#bulkApplySection'),
    bulkRoomSearchInput: document.querySelector('#bulkRoomSearchInput'),
    bulkRoomList: document.querySelector('#bulkRoomList'),
    bulkApplyButton: document.querySelector('#bulkApplyButton'),
    bulkApplyHelper: document.querySelector('#bulkApplyHelper'),
    scopeEditorFields: document.querySelector('#scopeEditorFields'),
    keywordInput: document.querySelector('#keywordInput'),
    keywordAddButton: document.querySelector('#keywordAddButton'),
    keywordChips: document.querySelector('#keywordChips'),
    senderSearchInput: document.querySelector('#senderSearchInput'),
    senderList: document.querySelector('#senderList'),
    senderHelper: document.querySelector('#senderHelper'),
    highlightEnabled: document.querySelector('#highlightEnabled'),
    highlightKeywordInput: document.querySelector('#highlightKeywordInput'),
    highlightKeywordAddButton: document.querySelector('#highlightKeywordAddButton'),
    highlightKeywordChips: document.querySelector('#highlightKeywordChips'),
    highlightColorInput: document.querySelector('#highlightColorInput'),
    highlightSwatch: document.querySelector('#highlightSwatch'),
    badgeControlEnabled: document.querySelector('#badgeControlEnabled'),
    badgeKeywordInput: document.querySelector('#badgeKeywordInput'),
    badgeKeywordAddButton: document.querySelector('#badgeKeywordAddButton'),
    badgeKeywordChips: document.querySelector('#badgeKeywordChips'),
    scheduleEnabled: document.querySelector('#scheduleEnabled'),
    scheduleDefaultAction: document.querySelector('#scheduleDefaultAction'),
    scheduleRuleList: document.querySelector('#scheduleRuleList'),
    addScheduleRuleButton: document.querySelector('#addScheduleRuleButton'),
    settingsTokenInput: document.querySelector('#settingsTokenInput'),
    settingsTokenSaveButton: document.querySelector('#settingsTokenSaveButton'),
    refreshRoomsButton: document.querySelector('#refreshRoomsButton'),
    clearTokenButton: document.querySelector('#clearTokenButton'),
    exportSettingsButton: document.querySelector('#exportSettingsButton'),
    importSettingsButton: document.querySelector('#importSettingsButton'),
    importSettingsInput: document.querySelector('#importSettingsInput'),
    runBackgroundSweepButton: document.querySelector('#runBackgroundSweepButton'),
    debugActionStatus: document.querySelector('#debugActionStatus'),
    debugStatePanel: document.querySelector('#debugStatePanel'),
    appError: document.querySelector('#appError'),
    saveStatus: document.querySelector('#saveStatus'),
    vipSenderSection: document.querySelector('#vipSenderSection'),
    vipRoomSearchInput: document.querySelector('#vipRoomSearchInput'),
    vipRoomSelect: document.querySelector('#vipRoomSelect'),
    watchSenderSearchInput: document.querySelector('#watchSenderSearchInput'),
    watchSenderList: document.querySelector('#watchSenderList'),
    watchSenderChips: document.querySelector('#watchSenderChips'),
    watchSenderHelper: document.querySelector('#watchSenderHelper'),
  }

  bindEvents()
  initialize().catch((error) => {
    state.appError = error instanceof Error ? error.message : '初期化に失敗しました。'
    render()
  })

  async function initialize() {
    const result = await chrome.storage.local.get([STORAGE_KEY, DEBUG_KEY])
    state.settings = normalizeSettings(result[STORAGE_KEY])
    state.debugState = result[DEBUG_KEY] || null

    if (state.settings.apiToken) {
      await hydrateFromApi(false)
    }

    render()
  }

  function bindEvents() {
    ;[
      elements.keywordInput,
      elements.highlightKeywordInput,
      elements.badgeKeywordInput,
    ].forEach((input) => {
      preventEnterRegistration(input)
    })

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') {
        return
      }
      if (changes[DEBUG_KEY]) {
        state.debugState = changes[DEBUG_KEY].newValue || null
        renderDebugState()
      }
    })

    elements.pauseButton.addEventListener('click', async () => {
      state.settings.globalPaused = !state.settings.globalPaused
      await saveSettings('一時停止状態を保存しました。')
      render()
    })

    elements.authSaveButton.addEventListener('click', () => saveTokenFrom(elements.authTokenInput))
    elements.authImportButton?.addEventListener('click', openImportPicker)
    elements.settingsTokenSaveButton.addEventListener('click', () =>
      saveTokenFrom(elements.settingsTokenInput)
    )
    elements.exportSettingsButton?.addEventListener('click', exportSettings)
    elements.importSettingsButton?.addEventListener('click', openImportPicker)
    elements.importSettingsInput?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (!file) {
        return
      }
      await importSettingsFromFile(file)
    })
    elements.refreshRoomsButton.addEventListener('click', async () => {
      await hydrateFromApi(true)
      render()
    })

    elements.clearTokenButton.addEventListener('click', async () => {
      state.settings.apiToken = ''
      state.settings.myAccountId = null
      state.rooms = []
      state.membersByRoom = {}
      state.selectedRoomId = ''
      await chrome.runtime.sendMessage({ type: 'yoriwake/reset-cache' })
      await saveSettings('APIトークンを削除しました。')
      render()
    })

    elements.runBackgroundSweepButton?.addEventListener('click', async () => {
      elements.runBackgroundSweepButton.disabled = true
      state.debugActionStatus = 'background へ送信中です。'
      renderDebugState()

      try {
        const response = await sendRuntimeMessageWithTimeout(
          { type: 'yoriwake/run-background-sweep', force: true },
          8000
        )

        if (!response?.ok) {
          state.appError = response?.error || 'background 実行に失敗しました。'
          state.debugActionStatus = `background 実行失敗: ${state.appError}`
        } else {
          state.appError = ''
          state.saveStatus = 'background を手動実行しました。'
          state.debugActionStatus = 'background 実行要求を送信しました。'
        }
      } catch (error) {
        state.appError = error instanceof Error ? error.message : 'background 実行に失敗しました。'
        state.debugActionStatus = `background 応答なし: ${state.appError}`
      }

      const result = await chrome.storage.local.get(DEBUG_KEY)
      state.debugState = result[DEBUG_KEY] || null
      elements.runBackgroundSweepButton.disabled = false
      render()
    })

    elements.globalTabButton.addEventListener('click', () => {
      state.activeScope = 'global'
      render()
    })

    elements.roomTabButton.addEventListener('click', async () => {
      state.activeScope = 'room'
      await ensureSelectedRoom()
      render()
    })

    elements.roomSearchInput.addEventListener('input', async (event) => {
      const previousSelectedRoomId = state.selectedRoomId
      state.roomQuery = String(event.target.value || '')
      renderRoomOptions()
      if (state.selectedRoomId && state.selectedRoomId !== previousSelectedRoomId) {
        await loadMembersForSelectedRoom(false)
      }
      render()
    })

    elements.roomSelect.addEventListener('change', async (event) => {
      state.selectedRoomId = String(event.target.value || '')
      state.bulkApplyTargetIds = state.bulkApplyTargetIds.filter(
        (roomId) => roomId !== state.selectedRoomId
      )
      await loadMembersForSelectedRoom(false)
      render()
    })

    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.addEventListener('change', async (event) => {
        if (!event.target.checked) {
          return
        }
        await updateCurrentScope((target) => {
          target.mode = event.target.value
        }, 'モードを保存しました。')
      })
    })

    elements.inheritCheckbox.addEventListener('change', async (event) => {
      if (!state.selectedRoomId) {
        return
      }

      if (event.target.checked) {
        state.settings.rooms[state.selectedRoomId] = toInheritedRoomOverride()
      } else {
        state.settings.rooms[state.selectedRoomId] = createRoomOverrideFromGlobal(state.settings)
      }

      await saveSettings('ルーム別継承設定を保存しました。')
      render()
    })

    elements.excludeRoomButton?.addEventListener('click', async () => {
      if (!state.selectedRoomId) {
        return
      }

      if (currentRoomIsExcluded()) {
        state.settings.rooms[state.selectedRoomId] = createRoomOverrideFromGlobal(state.settings)
        await saveSettings('このルームを個別設定へ戻しました。')
      } else {
        state.settings.rooms[state.selectedRoomId] = createExcludedRoomOverride()
        await saveSettings('このルームをグローバル設定の対象外にしました。')
      }
      render()
    })

    elements.bulkRoomSearchInput.addEventListener('input', (event) => {
      state.bulkRoomQuery = String(event.target.value || '')
      renderBulkApplyList()
    })

    elements.bulkApplyButton.addEventListener('click', async () => {
      if (!state.selectedRoomId || state.bulkApplyTargetIds.length === 0) {
        return
      }

      const sourceSettings = clone(getDisplaySettings())
      state.bulkApplyTargetIds.forEach((roomId) => {
        state.settings.rooms[roomId] = clone(sourceSettings)
      })
      await saveSettings(`${state.bulkApplyTargetIds.length}件のルームへ個別設定をコピーしました。`)
      render()
    })

    bindChipInput(elements.keywordInput, elements.keywordAddButton, async (value) => {
      await updateCurrentScope((target) => {
        target.keywords = [...target.keywords, value]
      }, 'キーワードを保存しました。')
    })

    bindChipInput(
      elements.highlightKeywordInput,
      elements.highlightKeywordAddButton,
      async (value) => {
        await updateCurrentScope((target) => {
          target.highlight.keywords = [...target.highlight.keywords, value]
        }, 'ハイライトキーワードを保存しました。')
      }
    )

    elements.senderSearchInput.addEventListener('input', (event) => {
      state.senderQuery = String(event.target.value || '')
      renderSenderList()
    })

    elements.highlightEnabled.addEventListener('change', async (event) => {
      await updateCurrentScope((target) => {
        target.highlight.enabled = Boolean(event.target.checked)
      }, 'ハイライト設定を保存しました。')
    })

    elements.highlightColorInput.addEventListener('input', async (event) => {
      await updateCurrentScope((target) => {
        target.highlight.color = String(event.target.value || '#FFF3CD').toUpperCase()
      }, 'ハイライト色を保存しました。')
    })

    elements.badgeControlEnabled.addEventListener('change', async (event) => {
      await updateCurrentScope((target) => {
        target.badgeControl.enabled = Boolean(event.target.checked)
      }, '未読バッジ制御を保存しました。')
    })

    document.querySelectorAll('input[name="badgeMode"]').forEach((input) => {
      input.addEventListener('change', async (event) => {
        if (!event.target.checked) {
          return
        }
        await updateCurrentScope((target) => {
          target.badgeControl.mode = event.target.value
        }, '未読バッジ条件を保存しました。')
      })
    })

    bindChipInput(elements.badgeKeywordInput, elements.badgeKeywordAddButton, async (value) => {
      await updateCurrentScope((target) => {
        target.badgeControl.keywords = [...(target.badgeControl.keywords || []), value]
      }, '未読判定キーワードを保存しました。')
    })

    elements.scheduleEnabled?.addEventListener('change', async (event) => {
      await updateCurrentScope((target) => {
        target.schedule = target.schedule || createDefaultSchedule()
        target.schedule.enabled = Boolean(event.target.checked)
      }, '時間帯設定を保存しました。')
    })

    elements.scheduleDefaultAction?.addEventListener('change', async (event) => {
      await updateCurrentScope((target) => {
        target.schedule = target.schedule || createDefaultSchedule()
        target.schedule.defaultAction = normalizeScheduleActionValue(event.target.value)
      }, '時間帯設定を保存しました。')
    })

    elements.addScheduleRuleButton?.addEventListener('click', async () => {
      await updateCurrentScope((target) => {
        target.schedule = target.schedule || createDefaultSchedule()
        target.schedule.rules = [...(target.schedule.rules || []), createScheduleRule()]
      }, '時間帯ルールを追加しました。')
    })

    elements.scheduleRuleList?.addEventListener('change', async (event) => {
      const ruleElement = event.target.closest?.('[data-schedule-rule-id]')
      if (!ruleElement) {
        return
      }
      const ruleId = String(ruleElement.dataset.scheduleRuleId || '')
      if (!ruleId) {
        return
      }

      if (event.target.matches('[data-schedule-start]')) {
        await updateScheduleRule(
          ruleId,
          (rule) => {
            rule.start = String(event.target.value || '09:00')
          },
          '時間帯ルールを保存しました。'
        )
        return
      }

      if (event.target.matches('[data-schedule-end]')) {
        await updateScheduleRule(
          ruleId,
          (rule) => {
            rule.end = String(event.target.value || '18:00')
          },
          '時間帯ルールを保存しました。'
        )
        return
      }

      if (event.target.matches('[data-schedule-action]')) {
        await updateScheduleRule(
          ruleId,
          (rule) => {
            rule.action = normalizeScheduleActionValue(event.target.value)
          },
          '時間帯ルールを保存しました。'
        )
        return
      }

      if (event.target.matches('[data-schedule-day]')) {
        const day = Number(event.target.dataset.scheduleDay)
        await updateScheduleRule(
          ruleId,
          (rule) => {
            const nextDays = new Set(rule.days || [])
            if (event.target.checked) {
              nextDays.add(day)
            } else {
              nextDays.delete(day)
            }
            rule.days = [...nextDays].sort((a, b) => a - b)
          },
          '曜日設定を保存しました。'
        )
      }
    })

    elements.scheduleRuleList?.addEventListener('click', async (event) => {
      const button = event.target.closest?.('[data-delete-schedule-rule]')
      if (!button) {
        return
      }
      const ruleId = String(button.dataset.deleteScheduleRule || '')
      if (!ruleId) {
        return
      }

      await updateCurrentScope((target) => {
        target.schedule = target.schedule || createDefaultSchedule()
        target.schedule.rules = (target.schedule.rules || []).filter((rule) => rule.id !== ruleId)
      }, '時間帯ルールを削除しました。')
    })

    elements.watchSenderSearchInput?.addEventListener('input', (event) => {
      state.watchSenderQuery = String(event.target.value || '')
      renderWatchSenderList()
    })

    elements.vipRoomSearchInput?.addEventListener('input', (event) => {
      state.vipRoomQuery = String(event.target.value || '')
      renderVipRoomOptions()
    })

    elements.vipRoomSelect?.addEventListener('change', async (event) => {
      state.vipSelectedRoomId = String(event.target.value || '')
      await loadMembersForRoom(state.vipSelectedRoomId, false)
      renderWatchSenderList()
    })
  }

  function bindChipInput(input, button, handler) {
    button.addEventListener('click', async () => {
      const value = input.value.trim()
      if (!value) {
        return
      }
      input.value = ''
      await handler(value)
      render()
    })

    input.addEventListener('keydown', async (event) => {
      if (event.key !== ',' || event.isComposing) {
        return
      }
      event.preventDefault()
      const value = input.value.trim()
      if (!value) {
        return
      }
      input.value = ''
      await handler(value)
      render()
    })
  }

  function preventEnterRegistration(input) {
    if (!input) {
      return
    }

    const suppress = (event) => {
      if (event.key !== 'Enter' || event.isComposing) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    input.addEventListener('keydown', suppress, true)
    input.addEventListener('keypress', suppress, true)
    input.addEventListener('keyup', suppress, true)
  }

  async function saveTokenFrom(input) {
    const token = input.value.trim()
    if (!token) {
      state.authError = 'APIトークンを入力してください。'
      render()
      return
    }

    state.authError = ''
    state.appError = ''
    state.settings.apiToken = token
    await chrome.runtime.sendMessage({ type: 'yoriwake/reset-cache' })
    await saveSettings('APIトークンを保存しました。', false)

    try {
      await hydrateFromApi(true)
      input.value = token
    } catch (_error) {
      input.value = token
    }
    render()
  }

  async function hydrateFromApi(forceRefresh) {
    if (!state.settings.apiToken) {
      return
    }

    const response = await chrome.runtime.sendMessage({
      type: 'yoriwake/bootstrap',
      force: forceRefresh,
    })

    if (!response?.ok) {
      const message = response?.error || 'Chatwork APIの取得に失敗しました。'
      state.authError = message
      state.appError = message
      render()
      return
    }

    state.authError = ''
    state.appError = response.data.warnings?.join(' ') || ''
    state.rooms = Array.isArray(response.data.rooms) ? response.data.rooms : []

    if (response.data.me?.account_id) {
      state.settings.myAccountId = Number(response.data.me.account_id)
      await saveSettings('', false)
    }

    if (!state.selectedRoomId && state.rooms.length) {
      state.selectedRoomId = String(state.rooms[0].room_id)
    }

    await loadMembersForSelectedRoom(forceRefresh)
  }

  async function ensureSelectedRoom() {
    const currentChatworkRoomId = await getActiveChatworkRoomId()
    if (
      currentChatworkRoomId &&
      state.rooms.some((room) => String(room.room_id) === currentChatworkRoomId)
    ) {
      state.selectedRoomId = currentChatworkRoomId
    } else if (!state.selectedRoomId && state.rooms.length) {
      state.selectedRoomId = String(state.rooms[0].room_id)
    }
    await loadMembersForSelectedRoom(false)
  }

  async function getActiveChatworkRoomId() {
    try {
      const tabs = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      })
      const activeTab = tabs[0]
      const url = String(activeTab?.url || '')
      if (!url.startsWith('https://www.chatwork.com/')) {
        return null
      }

      const hash = new URL(url).hash || ''
      return getCurrentRoomIdFromHash(hash)
    } catch (_error) {
      return null
    }
  }

  async function loadMembersForSelectedRoom(forceRefresh) {
    if (!state.selectedRoomId || !state.settings.apiToken) {
      return
    }

    if (state.membersByRoom[state.selectedRoomId] && !forceRefresh) {
      return
    }

    const response = await chrome.runtime.sendMessage({
      type: 'yoriwake/get-room-members',
      roomId: state.selectedRoomId,
      force: forceRefresh,
    })

    if (!response?.ok) {
      state.appError = response?.error || 'メンバー一覧の取得に失敗しました。'
      return
    }

    state.appError = response.data.warning || state.appError
    state.membersByRoom[state.selectedRoomId] = Array.isArray(response.data.members)
      ? response.data.members
      : []
  }

  async function loadMembersForRoom(roomId, forceRefresh) {
    if (!roomId || !state.settings.apiToken) {
      return
    }

    if (state.membersByRoom[roomId] && !forceRefresh) {
      return
    }

    const response = await chrome.runtime.sendMessage({
      type: 'yoriwake/get-room-members',
      roomId,
      force: forceRefresh,
    })

    if (!response?.ok) {
      state.appError = response?.error || 'メンバー一覧の取得に失敗しました。'
      return
    }

    state.appError = response.data.warning || state.appError
    state.membersByRoom[roomId] = Array.isArray(response.data.members) ? response.data.members : []
  }

  async function updateCurrentScope(mutator, statusMessage) {
    const current = getEditableSettings()
    if (!current) {
      return
    }

    mutator(current)
    dedupeSettings(current)
    await saveSettings(statusMessage)
    render()
  }

  function dedupeSettings(target) {
    target.keywords = [
      ...new Set((target.keywords || []).map((value) => value.trim()).filter(Boolean)),
    ]
    target.senderIds = [
      ...new Set(
        (target.senderIds || [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value))
      ),
    ]
    target.highlight.keywords = [
      ...new Set((target.highlight.keywords || []).map((value) => value.trim()).filter(Boolean)),
    ]
    target.highlight.color = String(target.highlight.color || '#FFF3CD').toUpperCase()
    target.badgeControl = {
      enabled: Boolean(target.badgeControl?.enabled),
      mode: ['followFilter', 'showWhenKeywordMatched', 'hideWhenKeywordMatched'].includes(
        target.badgeControl?.mode
      )
        ? target.badgeControl.mode
        : 'followFilter',
      keywords: [
        ...new Set(
          (target.badgeControl?.keywords || []).map((value) => value.trim()).filter(Boolean)
        ),
      ],
    }
    target.schedule = normalizeScheduleTarget(target.schedule)
  }

  function openImportPicker() {
    elements.importSettingsInput?.click()
  }

  async function exportSettings() {
    try {
      const payload = {
        app: 'yoriwake-kun',
        schemaVersion: SETTINGS_EXPORT_SCHEMA_VERSION,
        extensionVersion: chrome.runtime.getManifest?.().version || '',
        exportedAt: new Date().toISOString(),
        settings: normalizeSettings(state.settings),
      }
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `yoriwake-settings-${formatExportTimestamp(new Date())}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 0)
      flashStatus('設定をエクスポートしました。')
      state.appError = ''
      render()
    } catch (error) {
      state.appError = error instanceof Error ? error.message : '設定のエクスポートに失敗しました。'
      render()
    }
  }

  async function importSettingsFromFile(file) {
    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const importedSettings = extractImportedSettings(parsed)

      state.settings = importedSettings
      state.rooms = []
      state.membersByRoom = {}
      state.selectedRoomId = ''
      state.bulkApplyTargetIds = []
      state.authError = ''
      state.appError = ''
      state.activeScope = 'global'
      state.roomQuery = ''
      state.senderQuery = ''
      state.bulkRoomQuery = ''
      state.watchSenderQuery = ''
      state.vipRoomQuery = ''
      state.vipSelectedRoomId = ''

      await resetRuntimeCache()
      await saveSettings('設定をインポートしました。', false)

      if (state.settings.apiToken) {
        await hydrateFromApi(true)
      }

      render()
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '設定のインポートに失敗しました。'
      state.authError = message
      state.appError = message
      render()
    }
  }

  function extractImportedSettings(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('設定JSONの形式が正しくありません。')
    }

    const settingsCandidate =
      parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)
        ? parsed.settings
        : parsed

    const hasSettingsShape =
      'global' in settingsCandidate ||
      'rooms' in settingsCandidate ||
      'apiToken' in settingsCandidate ||
      'watchSenderIds' in settingsCandidate

    if (!hasSettingsShape) {
      throw new Error('ヨリワケくんの設定JSONではありません。')
    }

    return normalizeSettings(settingsCandidate)
  }

  async function resetRuntimeCache() {
    try {
      await chrome.runtime.sendMessage({ type: 'yoriwake/reset-cache' })
    } catch (_error) {
      // 拡張再読み込み直後でもインポート自体は継続させる
    }
  }

  function formatExportTimestamp(date) {
    const pad = (value) => String(value).padStart(2, '0')
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
      '-',
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
    ].join('')
  }

  function flashStatus(message) {
    state.saveStatus = message
    window.clearTimeout(state.saveStatusTimer)
    state.saveStatusTimer = window.setTimeout(() => {
      state.saveStatus = ''
      render()
    }, 1800)
  }

  async function saveSettings(statusMessage, shouldRender = true) {
    state.settings = normalizeSettings(state.settings)
    await chrome.storage.local.set({
      [STORAGE_KEY]: state.settings,
    })

    if (statusMessage) {
      flashStatus(statusMessage)
    }

    if (shouldRender) {
      render()
    }
  }

  function getEditableSettings() {
    if (state.activeScope === 'global') {
      return state.settings.global
    }

    if (!state.selectedRoomId) {
      return null
    }

    if (
      !state.settings.rooms[state.selectedRoomId] ||
      isInheritedRoom(state.settings.rooms[state.selectedRoomId])
    ) {
      state.settings.rooms[state.selectedRoomId] = createRoomOverrideFromGlobal(state.settings)
    }

    return state.settings.rooms[state.selectedRoomId]
  }

  function getDisplaySettings() {
    if (state.activeScope === 'global') {
      return state.settings.global
    }
    return resolveRoomEditorSettings(state.settings, state.selectedRoomId)
  }

  function currentRoomIsInherited() {
    if (state.activeScope !== 'room' || !state.selectedRoomId) {
      return false
    }
    return isInheritedRoom(state.settings.rooms[state.selectedRoomId])
  }

  function render() {
    const hasToken = Boolean(state.settings.apiToken)
    const isRoomScope = state.activeScope === 'room'
    elements.authView.hidden = hasToken
    elements.appView.hidden = !hasToken

    elements.pauseButton.classList.toggle('is-paused', state.settings.globalPaused)
    elements.pauseButton.textContent = state.settings.globalPaused ? '▶ 再開' : '⏸ 一時停止'

    elements.authTokenInput.value = state.settings.apiToken
    elements.settingsTokenInput.value = state.settings.apiToken

    elements.authError.hidden = !state.authError
    elements.authError.textContent = state.authError
    elements.appError.hidden = !state.appError
    elements.appError.textContent = state.appError
    elements.saveStatus.textContent = state.saveStatus
    if (elements.debugActionStatus) {
      elements.debugActionStatus.textContent = state.debugActionStatus
    }

    if (!hasToken) {
      return
    }

    elements.globalTabButton.classList.toggle('is-active', !isRoomScope)
    elements.roomTabButton.classList.toggle('is-active', isRoomScope)
    elements.roomSelectWrap.hidden = !isRoomScope
    elements.roomSelectWrap.style.display = isRoomScope ? '' : 'none'
    elements.roomSelect.disabled = !isRoomScope
    elements.roomSearchInput.value = state.roomQuery
    elements.roomSearchInput.disabled = !isRoomScope
    elements.roomInheritanceField.hidden = !isRoomScope
    elements.roomInheritanceField.style.display = isRoomScope ? '' : 'none'
    elements.bulkApplySection.hidden = !isRoomScope
    elements.bulkApplySection.style.display = isRoomScope ? '' : 'none'

    if (elements.vipSenderSection) {
      elements.vipSenderSection.hidden = isRoomScope
      elements.vipSenderSection.style.display = isRoomScope ? 'none' : ''
    }

    renderRoomOptions()
    renderScopeSummary()
    renderEditor()
    renderWatchSenderList()
    renderDebugState()
  }

  function renderDebugState() {
    if (!elements.debugStatePanel) {
      return
    }

    const debug = state.debugState || {}
    elements.debugStatePanel.innerHTML = [
      debugRow('最終 background 開始', formatTimestamp(debug.lastSweepStartedAt)),
      debugRow('最終 background 完了', formatTimestamp(debug.lastSweepFinishedAt)),
      debugRow('起動トリガー', debug.lastSweepTrigger || '未実行'),
      debugRow('sweep 結果', debug.lastSweepSummary || '未実行'),
      debugRow('sweep エラー', debug.lastSweepError || 'なし'),
      debugRow('最終既読成功', formatTimestamp(debug.lastReadSuccessAt)),
      debugRow('最終既読失敗', formatTimestamp(debug.lastReadFailureAt)),
      debugRow('最終既読 room_id', debug.lastReadRoomId || '-'),
      debugRow('最終既読 message_id', debug.lastReadMessageId || '-'),
      debugRow('既読失敗理由', debug.lastReadError || 'なし'),
    ].join('')
  }

  function debugRow(label, value) {
    return `<div class="debug-row"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value || '-'))}</div>`
  }

  function formatTimestamp(value) {
    const timestamp = Number(value) || 0
    if (!timestamp) {
      return '未実行'
    }
    return new Date(timestamp).toLocaleString('ja-JP')
  }

  function sendRuntimeMessageWithTimeout(message, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new Error('background から一定時間内に応答がありませんでした。'))
      }, timeoutMs)

      chrome.runtime
        .sendMessage(message)
        .then((response) => {
          window.clearTimeout(timer)
          resolve(response)
        })
        .catch((error) => {
          window.clearTimeout(timer)
          reject(error)
        })
    })
  }

  function renderRoomOptions() {
    const current = state.selectedRoomId
    const query = state.roomQuery.trim().toLocaleLowerCase()
    const filteredRooms = state.rooms.filter((room) => {
      if (!query) {
        return true
      }
      return String(room.name || '')
        .toLocaleLowerCase()
        .includes(query)
    })

    const options = filteredRooms.map((room) => {
      const selected = String(room.room_id) === current ? ' selected' : ''
      const roomId = String(room.room_id)
      const prefix = hasCustomOverride(roomId) ? '● ' : ''
      return `<option value="${room.room_id}"${selected}>${escapeHtml(prefix + (room.name || `ルーム ${room.room_id}`))}</option>`
    })

    if (!options.length) {
      state.selectedRoomId = ''
      elements.roomSelect.innerHTML = '<option value="">該当するルームがありません</option>'
      elements.roomSelect.value = ''
      return
    }

    elements.roomSelect.innerHTML = options.join('')
    if (filteredRooms.some((room) => String(room.room_id) === current)) {
      elements.roomSelect.value = current
      return
    }

    if (!current && filteredRooms[0]) {
      state.selectedRoomId = String(filteredRooms[0].room_id)
      elements.roomSelect.value = state.selectedRoomId
      return
    }

    state.selectedRoomId = String(filteredRooms[0].room_id)
    elements.roomSelect.value = state.selectedRoomId
  }

  function renderScopeSummary() {
    const room = state.rooms.find((item) => String(item.room_id) === state.selectedRoomId)
    const inherited = currentRoomIsInherited()
    const excluded = currentRoomIsExcluded()
    const customRoomIds = getCustomRoomIds()

    elements.accountBadge.textContent = state.settings.myAccountId
      ? `自分のID: ${state.settings.myAccountId}`
      : '自分のID: 未取得'
    elements.roomsBadge.textContent = `ルーム: ${state.rooms.length}件`

    if (state.activeScope === 'global') {
      elements.scopeTitle.textContent = 'グローバル設定'
      elements.scopeMeta.textContent = '全ルームのデフォルトとして適用されます。'
      elements.scopeStateBadge.hidden = true
      elements.customRoomChips.parentElement.hidden = true
      return
    }

    elements.scopeStateBadge.hidden = false
    elements.customRoomChips.parentElement.hidden = false
    elements.scopeTitle.textContent = room ? `${room.name}` : 'ルーム別設定'
    if (inherited) {
      elements.scopeMeta.textContent = '現在はグローバル設定を継承しています。'
      elements.scopeStateBadge.textContent = '状態: グローバル継承'
    } else if (excluded) {
      elements.scopeMeta.textContent = 'このルームはグローバル設定の対象外です。'
      elements.scopeStateBadge.textContent = '状態: グローバル対象外'
    } else {
      elements.scopeMeta.textContent = 'このルーム専用の設定が有効です。'
      elements.scopeStateBadge.textContent = '状態: 個別設定あり'
    }
    renderCustomRoomChips(customRoomIds)
  }

  function renderEditor() {
    const display = getDisplaySettings()
    const inherited = currentRoomIsInherited()
    const excluded = currentRoomIsExcluded()
    const shouldDisable = state.activeScope === 'room' && inherited

    elements.roomInheritanceField.hidden = state.activeScope !== 'room'
    elements.roomInheritanceField.style.display = state.activeScope === 'room' ? '' : 'none'
    elements.bulkApplySection.hidden = state.activeScope !== 'room'
    elements.bulkApplySection.style.display = state.activeScope === 'room' ? '' : 'none'
    elements.inheritCheckbox.checked = inherited
    if (elements.excludeRoomButton) {
      elements.excludeRoomButton.textContent = excluded
        ? '除外を解除して個別設定に戻す'
        : 'このルームだけ除外'
    }
    elements.bulkRoomSearchInput.value = state.bulkRoomQuery
    elements.bulkApplyButton.disabled =
      state.activeScope !== 'room' || state.bulkApplyTargetIds.length === 0

    elements.scopeEditorFields.classList.toggle('is-disabled', shouldDisable)

    document.querySelectorAll('input[name="mode"]').forEach((input) => {
      input.checked = input.value === display.mode
      input.disabled = shouldDisable
    })

    elements.keywordInput.disabled = shouldDisable
    elements.keywordAddButton.disabled = shouldDisable
    elements.senderSearchInput.disabled = shouldDisable || !state.selectedRoomId
    elements.highlightEnabled.checked = display.highlight.enabled
    elements.highlightEnabled.disabled = shouldDisable
    elements.highlightKeywordInput.disabled = shouldDisable
    elements.highlightKeywordAddButton.disabled = shouldDisable
    elements.highlightColorInput.value = display.highlight.color
    elements.highlightColorInput.disabled = shouldDisable
    elements.highlightSwatch.style.background = display.highlight.color
    elements.badgeControlEnabled.checked = display.badgeControl.enabled
    elements.badgeControlEnabled.disabled = shouldDisable
    elements.badgeKeywordInput.disabled =
      shouldDisable || display.badgeControl.mode === 'followFilter'
    elements.badgeKeywordAddButton.disabled =
      shouldDisable || display.badgeControl.mode === 'followFilter'
    elements.scheduleEnabled.checked = Boolean(display.schedule?.enabled)
    elements.scheduleEnabled.disabled = shouldDisable
    elements.scheduleDefaultAction.value = normalizeScheduleActionValue(
      display.schedule?.defaultAction
    )
    elements.scheduleDefaultAction.disabled = shouldDisable || !display.schedule?.enabled
    elements.addScheduleRuleButton.disabled = shouldDisable || !display.schedule?.enabled

    document.querySelectorAll('input[name="badgeMode"]').forEach((input) => {
      input.checked = input.value === display.badgeControl.mode
      input.disabled = shouldDisable
    })

    renderChipList(elements.keywordChips, display.keywords, shouldDisable, async (value) => {
      await updateCurrentScope((target) => {
        target.keywords = target.keywords.filter((item) => item !== value)
      }, 'キーワードを更新しました。')
    })

    renderChipList(
      elements.highlightKeywordChips,
      display.highlight.keywords,
      shouldDisable,
      async (value) => {
        await updateCurrentScope((target) => {
          target.highlight.keywords = target.highlight.keywords.filter((item) => item !== value)
        }, 'ハイライトキーワードを更新しました。')
      }
    )

    renderChipList(
      elements.badgeKeywordChips,
      display.badgeControl.keywords,
      shouldDisable || display.badgeControl.mode === 'followFilter',
      async (value) => {
        await updateCurrentScope((target) => {
          target.badgeControl.keywords = (target.badgeControl.keywords || []).filter(
            (item) => item !== value
          )
        }, '未読判定キーワードを更新しました。')
      }
    )

    renderSenderList()
    renderBulkApplyList()
    renderScheduleRules(display.schedule, shouldDisable)
  }

  function renderScheduleRules(schedule, shouldDisable) {
    const normalized = normalizeScheduleTarget(schedule)
    const dayLabels = ['日', '月', '火', '水', '木', '金', '土']

    if (!elements.scheduleRuleList) {
      return
    }

    elements.scheduleRuleList.innerHTML = normalized.rules
      .map(
        (rule, index) => `
      <section class="schedule-rule-card" data-schedule-rule-id="${escapeHtml(rule.id)}">
        <div class="field-heading">
          <span class="field-label">停止 ${index + 1}</span>
          <button type="button" class="danger-button" data-delete-schedule-rule="${escapeHtml(rule.id)}" ${shouldDisable ? 'disabled' : ''}>削除</button>
        </div>
        <div class="schedule-day-grid">
          ${dayLabels
            .map(
              (label, day) => `
            <label class="schedule-day-chip ${rule.days.includes(day) ? 'is-selected' : ''}">
              <input type="checkbox" data-schedule-day="${day}" ${rule.days.includes(day) ? 'checked' : ''} ${shouldDisable || !normalized.enabled ? 'disabled' : ''}>
              <span>${label}</span>
            </label>
          `
            )
            .join('')}
        </div>
        <div class="schedule-time-row schedule-time-row--simple">
          <label class="field">
            <span>開始</span>
            <input type="time" data-schedule-start value="${escapeHtml(rule.start)}" ${shouldDisable || !normalized.enabled ? 'disabled' : ''}>
          </label>
          <label class="field">
            <span>終了</span>
            <input type="time" data-schedule-end value="${escapeHtml(rule.end)}" ${shouldDisable || !normalized.enabled ? 'disabled' : ''}>
          </label>
        </div>
        <select data-schedule-action hidden><option value="pause" selected></option></select>
      </section>
    `
      )
      .join('')

    elements.scheduleRuleList.classList.toggle('is-empty', normalized.rules.length === 0)
  }

  async function updateScheduleRule(ruleId, mutator, statusMessage) {
    await updateCurrentScope((target) => {
      target.schedule = target.schedule || createDefaultSchedule()
      target.schedule.rules = (target.schedule.rules || []).map((rule) => {
        if (String(rule.id) !== String(ruleId)) {
          return rule
        }
        const nextRule = clone(rule)
        mutator(nextRule)
        return nextRule
      })
    }, statusMessage)
  }

  function createScheduleRule() {
    return {
      id: `schedule-rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      days: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '18:00',
      action: 'pause',
    }
  }

  function normalizeScheduleTarget(schedule) {
    const base = createDefaultSchedule()
    const merged = {
      ...base,
      ...(schedule || {}),
    }
    return {
      enabled: Boolean(merged.enabled),
      defaultAction: merged.defaultAction === 'pause' ? 'pause' : 'normal',
      rules: (merged.rules || []).map((rule, index) => ({
        id: String(rule?.id || `schedule-rule-${index}`),
        days: [
          ...new Set(
            (rule?.days || [])
              .map((value) => Number(value))
              .filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
          ),
        ],
        start: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule?.start || ''))
          ? String(rule.start)
          : '09:00',
        end: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(rule?.end || '')) ? String(rule.end) : '18:00',
        action: normalizeScheduleActionValue(rule?.action),
      })),
    }
  }

  function normalizeScheduleActionValue(action) {
    return ['normal', 'pause', 'mode:hide', 'mode:showOnly', 'mode:off'].includes(action)
      ? action
      : 'normal'
  }

  function renderCustomRoomChips(customRoomIds) {
    const roomsById = new Map(state.rooms.map((room) => [String(room.room_id), room]))
    elements.customRoomChips.classList.toggle('is-empty', customRoomIds.length === 0)
    elements.customRoomChips.innerHTML = customRoomIds
      .map((roomId) => {
        const room = roomsById.get(roomId)
        const activeClass = roomId === state.selectedRoomId ? ' chip--active-room' : ''
        const suffix = isExcludedRoom(state.settings.rooms?.[roomId]) ? ' (除外)' : ''
        return `<button type="button" class="chip chip--room${activeClass}" data-room-chip-id="${roomId}">${escapeHtml((room?.name || `ルーム ${roomId}`) + suffix)}</button>`
      })
      .join('')
    ;[...elements.customRoomChips.querySelectorAll('[data-room-chip-id]')].forEach((button) => {
      button.addEventListener('click', async () => {
        state.activeScope = 'room'
        state.selectedRoomId = String(button.dataset.roomChipId || '')
        state.bulkApplyTargetIds = state.bulkApplyTargetIds.filter(
          (roomId) => roomId !== state.selectedRoomId
        )
        await loadMembersForSelectedRoom(false)
        render()
      })
    })
  }

  function renderBulkApplyList() {
    if (state.activeScope !== 'room') {
      return
    }

    const query = state.bulkRoomQuery.trim().toLocaleLowerCase()
    const rooms = state.rooms.filter((room) => {
      const roomId = String(room.room_id)
      if (roomId === state.selectedRoomId) {
        return false
      }
      if (!query) {
        return true
      }
      return String(room.name || '')
        .toLocaleLowerCase()
        .includes(query)
    })

    elements.bulkApplyHelper.textContent =
      state.bulkApplyTargetIds.length > 0
        ? `${state.bulkApplyTargetIds.length}件選択中`
        : 'コピー先のルームを選んでください。'

    elements.bulkRoomList.innerHTML = rooms
      .map((room) => {
        const roomId = String(room.room_id)
        const checked = state.bulkApplyTargetIds.includes(roomId) ? 'checked' : ''
        const customLabel = hasCustomOverride(roomId) ? '個別設定あり' : '継承中'
        return `
        <label class="sender-row">
          <input type="checkbox" data-room-id="${roomId}" ${checked}>
          <span>
            ${escapeHtml(room.name || `ルーム ${roomId}`)}
            <small>${customLabel}</small>
          </span>
        </label>
      `
      })
      .join('')
    ;[...elements.bulkRoomList.querySelectorAll("input[type='checkbox']")].forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const roomId = String(event.target.dataset.roomId)
        if (event.target.checked) {
          state.bulkApplyTargetIds = [...new Set([...state.bulkApplyTargetIds, roomId])]
        } else {
          state.bulkApplyTargetIds = state.bulkApplyTargetIds.filter((value) => value !== roomId)
        }
        renderBulkApplyList()
      })
    })
  }

  function getCustomRoomIds() {
    return Object.entries(state.settings.rooms || {})
      .filter(([, roomSettings]) => !isInheritedRoom(roomSettings))
      .map(([roomId]) => String(roomId))
      .sort((a, b) => {
        const roomA = state.rooms.find((room) => String(room.room_id) === a)
        const roomB = state.rooms.find((room) => String(room.room_id) === b)
        return String(roomA?.name || a).localeCompare(String(roomB?.name || b), 'ja')
      })
  }

  function hasCustomOverride(roomId) {
    return Boolean(roomId) && !isInheritedRoom(state.settings.rooms?.[roomId])
  }

  function currentRoomIsExcluded() {
    if (state.activeScope !== 'room' || !state.selectedRoomId) {
      return false
    }
    return isExcludedRoom(state.settings.rooms[state.selectedRoomId])
  }

  function renderChipList(container, values, disabled, onRemove) {
    container.classList.toggle('is-empty', !values.length)
    container.innerHTML = values
      .map(
        (value) => `
      <span class="chip">
        ${escapeHtml(value)}
        <button type="button" aria-label="${escapeHtml(value)} を削除" ${disabled ? 'disabled' : ''}>×</button>
      </span>
    `
      )
      .join('')

    if (disabled) {
      return
    }

    ;[...container.querySelectorAll('button')].forEach((button, index) => {
      button.addEventListener('click', async () => {
        await onRemove(values[index])
        render()
      })
    })
  }

  function renderSenderList() {
    const display = getDisplaySettings()
    const inherited = currentRoomIsInherited()
    const shouldDisable = state.activeScope === 'room' && inherited
    const members = state.selectedRoomId ? state.membersByRoom[state.selectedRoomId] || [] : []
    const query = state.senderQuery.trim().toLocaleLowerCase()

    if (!state.settings.apiToken) {
      elements.senderHelper.textContent = 'APIトークン未設定のため送信者フィルターは使えません。'
      elements.senderList.innerHTML = ''
      return
    }

    if (!state.selectedRoomId) {
      elements.senderHelper.textContent = 'ルームを選択するとメンバー一覧を表示します。'
      elements.senderList.innerHTML = ''
      return
    }

    if (!members.length) {
      elements.senderHelper.textContent = 'このルームのメンバー一覧を読み込めていません。'
      elements.senderList.innerHTML = ''
      return
    }

    const filtered = members
      .filter((member) => {
        if (!query) {
          return true
        }
        return String(member.name || '')
          .toLocaleLowerCase()
          .includes(query)
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'))

    elements.senderHelper.textContent = `${filtered.length}人を表示中`
    elements.senderList.innerHTML = filtered
      .map((member) => {
        const accountId = Number(member.account_id)
        const checked = display.senderIds.includes(accountId) ? 'checked' : ''
        return `
        <label class="sender-row">
          <input type="checkbox" data-sender-id="${accountId}" ${checked} ${shouldDisable ? 'disabled' : ''}>
          <span>
            ${escapeHtml(member.name || '名称未設定')}
            <small>ID: ${accountId}</small>
          </span>
        </label>
      `
      })
      .join('')

    if (shouldDisable) {
      return
    }

    ;[...elements.senderList.querySelectorAll("input[type='checkbox']")].forEach((checkbox) => {
      checkbox.addEventListener('change', async (event) => {
        const senderId = Number(event.target.dataset.senderId)
        await updateCurrentScope((target) => {
          if (event.target.checked) {
            target.senderIds = [...target.senderIds, senderId]
          } else {
            target.senderIds = target.senderIds.filter((value) => value !== senderId)
          }
        }, '送信者フィルターを保存しました。')
      })
    })
  }

  function getAllLoadedMembers() {
    const memberMap = new Map()
    Object.values(state.membersByRoom).forEach((members) => {
      ;(members || []).forEach((member) => {
        const id = Number(member.account_id)
        if (id && !memberMap.has(id)) {
          memberMap.set(id, member)
        }
      })
    })
    return memberMap
  }

  function renderVipRoomOptions() {
    if (!elements.vipRoomSelect) {
      return
    }

    const query = state.vipRoomQuery.trim().toLocaleLowerCase()
    const filteredRooms = state.rooms.filter((room) => {
      if (!query) {
        return true
      }
      return String(room.name || '')
        .toLocaleLowerCase()
        .includes(query)
    })

    const current = state.vipSelectedRoomId
    const options = filteredRooms.map((room) => {
      const selected = String(room.room_id) === current ? ' selected' : ''
      return `<option value="${room.room_id}"${selected}>${escapeHtml(room.name || 'ルーム ' + room.room_id)}</option>`
    })

    if (!options.length) {
      elements.vipRoomSelect.innerHTML = '<option value="">該当するルームがありません</option>'
      return
    }

    elements.vipRoomSelect.innerHTML = options.join('')
    if (filteredRooms.some((room) => String(room.room_id) === current)) {
      elements.vipRoomSelect.value = current
    } else if (filteredRooms[0]) {
      state.vipSelectedRoomId = String(filteredRooms[0].room_id)
      elements.vipRoomSelect.value = state.vipSelectedRoomId
    }
  }

  function renderWatchSenderList() {
    if (!elements.watchSenderList || !elements.watchSenderChips || !elements.watchSenderHelper) {
      return
    }

    if (state.activeScope === 'room') {
      return
    }

    if (!state.vipSelectedRoomId && state.rooms.length) {
      state.vipSelectedRoomId = String(state.rooms[0].room_id)
    }

    renderVipRoomOptions()

    const watchSenderIds = state.settings.watchSenderIds || []
    const allMembers = getAllLoadedMembers()

    const chipHtml = watchSenderIds
      .map((id) => {
        const member = allMembers.get(id)
        const label = member ? `${member.name} (${id})` : `ID: ${id}`
        return `
        <span class="chip chip--vip">
          ${escapeHtml(label)}
          <button type="button" data-remove-watch-sender="${id}" aria-label="${escapeHtml(label)} を削除">×</button>
        </span>
      `
      })
      .join('')

    elements.watchSenderChips.classList.toggle('is-empty', !watchSenderIds.length)
    elements.watchSenderChips.innerHTML = chipHtml
    ;[...elements.watchSenderChips.querySelectorAll('[data-remove-watch-sender]')].forEach(
      (button) => {
        button.addEventListener('click', async () => {
          const removeId = Number(button.dataset.removeWatchSender)
          state.settings.watchSenderIds = (state.settings.watchSenderIds || []).filter(
            (id) => id !== removeId
          )
          await saveSettings('VIP送信者を削除しました。')
          render()
        })
      }
    )

    const vipRoomId = state.vipSelectedRoomId
    const members = vipRoomId ? state.membersByRoom[vipRoomId] || [] : []
    const query = state.watchSenderQuery.trim().toLocaleLowerCase()

    if (!state.settings.apiToken) {
      elements.watchSenderHelper.textContent = 'APIトークン未設定のため送信者を選択できません。'
      elements.watchSenderList.innerHTML = ''
      return
    }

    if (!vipRoomId) {
      elements.watchSenderHelper.textContent = '上のルームを選んでください。'
      elements.watchSenderList.innerHTML = ''
      return
    }

    if (!members.length) {
      elements.watchSenderHelper.textContent = 'メンバーを読み込み中…'
      elements.watchSenderList.innerHTML = ''
      loadMembersForRoom(vipRoomId, false).then(() => {
        if (state.membersByRoom[vipRoomId]?.length) {
          renderWatchSenderList()
        } else {
          elements.watchSenderHelper.textContent = 'このルームのメンバーを取得できませんでした。'
        }
      })
      return
    }

    const filtered = members
      .filter((member) => {
        if (!query) {
          return true
        }
        return String(member.name || '')
          .toLocaleLowerCase()
          .includes(query)
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'))

    elements.watchSenderHelper.textContent = `${filtered.length}人を表示中`
    elements.watchSenderList.innerHTML = filtered
      .map((member) => {
        const accountId = Number(member.account_id)
        const checked = watchSenderIds.includes(accountId) ? 'checked' : ''
        return `
        <label class="sender-row">
          <input type="checkbox" data-watch-sender-id="${accountId}" ${checked}>
          <span>
            ${escapeHtml(member.name || '名称未設定')}
            <small>ID: ${accountId}</small>
          </span>
        </label>
      `
      })
      .join('')
    ;[...elements.watchSenderList.querySelectorAll("input[type='checkbox']")].forEach(
      (checkbox) => {
        checkbox.addEventListener('change', async (event) => {
          const senderId = Number(event.target.dataset.watchSenderId)
          if (event.target.checked) {
            state.settings.watchSenderIds = [
              ...new Set([...(state.settings.watchSenderIds || []), senderId]),
            ]
          } else {
            state.settings.watchSenderIds = (state.settings.watchSenderIds || []).filter(
              (id) => id !== senderId
            )
          }
          await saveSettings('VIP送信者を保存しました。')
          render()
        })
      }
    )
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;')
  }
})()
