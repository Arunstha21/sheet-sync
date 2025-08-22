// Global state
let currentMappings = []
let editingMappingId = null
let isLoading = false
// Removed empty lucide object declaration

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  // Initialize Lucide icons - wait for the library to load
  const initLucide = () => {
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons()
      return true
    }
    return false
  }

  // Try to initialize immediately, then retry if needed
  if (!initLucide()) {
    setTimeout(() => {
      if (!initLucide()) {
        setTimeout(initLucide, 500) // Final retry after 500ms
      }
    }, 100)
  }

  // Set up event listeners
  setupEventListeners()

  // Load initial data
  fetchStatus()
  fetchConfig()
  fetchMappings()

  // Set up periodic status updates
  setInterval(fetchStatus, 5000)
})

function setupEventListeners() {
  const startBtn = document.getElementById("start-btn")
  const stopBtn = document.getElementById("stop-btn")
  const syncNowBtn = document.getElementById("sync-now-btn")
  const updateConfigBtn = document.getElementById("update-config-btn")
  const addMappingBtn = document.getElementById("add-mapping-btn")

  if (startBtn) {
    startBtn.addEventListener("click", handleStart)
  } else {
    console.error("Start button not found!")
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", handleStop)
  } else {
    console.error("Stop button not found!")
  }

  if (syncNowBtn) {
    syncNowBtn.addEventListener("click", handleManualSync)
  } else {
    console.error("Sync now button not found!")
  }

  if (updateConfigBtn) {
    updateConfigBtn.addEventListener("click", handleConfigUpdate)
  } else {
    console.error("Update config button not found!")
  }

  if (addMappingBtn) {
    addMappingBtn.addEventListener("click", () => openModal())
  } else {
    console.error("Add mapping button not found!")
  }

  // Configuration
  const intervalInput = document.getElementById("interval")
  if (intervalInput) {
    intervalInput.addEventListener("input", updateIntervalDisplay)
  }

  // Modal event listeners
  const modalClose = document.getElementById("modal-close")
  const modalCancel = document.getElementById("modal-cancel")
  const modalOverlay = document.getElementById("modal-overlay")
  const mappingForm = document.getElementById("mapping-form")

  if (modalClose) modalClose.addEventListener("click", closeModal)
  if (modalCancel) modalCancel.addEventListener("click", closeModal)
  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        closeModal()
      }
    })
  }
  if (mappingForm) mappingForm.addEventListener("submit", handleMappingSubmit)
}

// API Functions
async function fetchStatus() {
  try {
    const response = await fetch("/api/sync/status")
    if (response.ok) {
      const status = await response.json()
      updateStatusDisplay(status)
    }
  } catch (error) {
    console.error("Failed to fetch status:", error)
  }
}

async function fetchConfig() {
  try {
    const response = await fetch("/api/sync/config")
    if (response.ok) {
      const config = await response.json()
      updateConfigDisplay(config)
    }
  } catch (error) {
    console.error("Failed to fetch config:", error)
  }
}

async function fetchMappings() {
  try {
    const response = await fetch("/api/mappings")

    if (response.ok) {
      const mappings = await response.json()
      currentMappings = mappings
      updateMappingsDisplay(mappings)
    } else {
      console.error("Failed to fetch mappings, status:", response.status)
      const errorText = await response.text()
      console.error("Error response:", errorText)
    }
  } catch (error) {
    console.error("Failed to fetch mappings:", error)
  }
}

// Sync Control Functions
async function handleStart() {
  if (isLoading) return
  setLoading(true)

  try {
    const response = await fetch("/api/sync/start", { method: "POST" })
    if (response.ok) {
      await fetchStatus()
    }
  } catch (error) {
    console.error("Failed to start sync:", error)
  } finally {
    setLoading(false)
  }
}

async function handleStop() {
  if (isLoading) return
  setLoading(true)

  try {
    const response = await fetch("/api/sync/stop", { method: "POST" })
    if (response.ok) {
      await fetchStatus()
    }
  } catch (error) {
    console.error("Failed to stop sync:", error)
  } finally {
    setLoading(false)
  }
}

async function handleManualSync() {
  if (isLoading) return
  setLoading(true)

  try {
    const response = await fetch("/api/sync/trigger", { method: "POST" })
    if (response.ok) {
      await fetchStatus()
    }
  } catch (error) {
    console.error("Failed to trigger manual sync:", error)
  } finally {
    setLoading(false)
  }
}

// Configuration Functions
async function handleConfigUpdate() {
  if (isLoading) return
  setLoading(true)

  const interval = Number.parseInt(document.getElementById("interval").value) || 300000

  try {
    const response = await fetch("/api/sync/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interval, autoStart: false }),
    })

    if (response.ok) {
      const data = await response.json()
      showMessage(data.message || "Configuration updated successfully")
      await fetchConfig()
      await fetchStatus()
    }
  } catch (error) {
    console.error("Failed to update config:", error)
    showMessage("Failed to update configuration")
  } finally {
    setLoading(false)
  }
}

function updateIntervalDisplay() {
  const interval = Number.parseInt(document.getElementById("interval").value) || 300000
  const formatted = formatInterval(interval)
  document.getElementById("interval-display").textContent = formatted
}

// Mapping Management Functions
function openModal(mapping = null) {
  editingMappingId = mapping ? mapping.id : null

  const modal = document.getElementById("modal-overlay")
  const title = document.getElementById("modal-title")
  const submitBtn = document.getElementById("modal-submit")

  if (mapping) {
    title.textContent = "Edit Mapping"
    submitBtn.textContent = "Update Mapping"

    // Fill form with existing data
    document.getElementById("mapping-name").value = mapping.name
    document.getElementById("mapping-description").value = mapping.description || ""
    document.getElementById("source-sheet").value = mapping.sourceSheet
    document.getElementById("source-tab").value = mapping.sourceTab
    document.getElementById("dest-sheet").value = mapping.destSheet
    document.getElementById("dest-tab").value = mapping.destTab
  } else {
    title.textContent = "Add New Mapping"
    submitBtn.textContent = "Create Mapping"

    // Clear form
    document.getElementById("mapping-form").reset()
  }

  modal.style.display = "flex"
}

function closeModal() {
  document.getElementById("modal-overlay").style.display = "none"
  document.getElementById("mapping-form").reset()
  editingMappingId = null
}

async function handleMappingSubmit(e) {
  e.preventDefault()
  if (isLoading) return
  setLoading(true)

  const formData = {
    name: document.getElementById("mapping-name").value,
    description: document.getElementById("mapping-description").value,
    sourceSheet: document.getElementById("source-sheet").value,
    sourceTab: document.getElementById("source-tab").value,
    destSheet: document.getElementById("dest-sheet").value,
    destTab: document.getElementById("dest-tab").value,
  }

  try {
    const url = editingMappingId ? `/api/mappings/${editingMappingId}` : "/api/mappings"
    const method = editingMappingId ? "PUT" : "POST"

    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
    })

    if (response.ok) {
      const result = await response.json()
      await fetchMappings()
      closeModal()
      showMessage(editingMappingId ? "Mapping updated successfully" : "Mapping created successfully")
    } else {
      const errorText = await response.text()
      console.error("Failed to save mapping:", errorText)
      showMessage("Failed to save mapping")
    }
  } catch (error) {
    console.error("Failed to save mapping:", error)
    showMessage("Failed to save mapping")
  } finally {
    setLoading(false)
  }
}

async function deleteMapping(id) {
  if (!confirm("Are you sure you want to delete this mapping?")) return
  if (isLoading) return
  setLoading(true)

  try {
    const response = await fetch(`/api/mappings/${id}`, { method: "DELETE" })
    if (response.ok) {
      await fetchMappings()
    }
  } catch (error) {
    console.error("Failed to delete mapping:", error)
  } finally {
    setLoading(false)
  }
}

// Display Update Functions
function updateStatusDisplay(status) {
  const statusBadge = document.getElementById("status-badge")
  const lastSync = document.getElementById("last-sync")
  const totalSyncs = document.getElementById("total-syncs")
  const errors = document.getElementById("errors")
  const nextSync = document.getElementById("next-sync")
  const startBtn = document.getElementById("start-btn")
  const stopBtn = document.getElementById("stop-btn")

  // Update status badge
  if (statusBadge) {
    statusBadge.textContent = status.isRunning ? "Running" : "Stopped"
    statusBadge.className = `badge ${status.isRunning ? "badge-default" : "badge-secondary"}`
  }

  // Update stats
  if (lastSync) lastSync.textContent = status.lastSync ? new Date(status.lastSync).toLocaleString() : "Never"
  if (totalSyncs) totalSyncs.textContent = status.totalSyncs
  if (errors) errors.textContent = status.errors
  if (nextSync) nextSync.textContent = status.nextSync ? new Date(status.nextSync).toLocaleString() : "Not scheduled"

  // Update button states
  if (startBtn) startBtn.disabled = status.isRunning || isLoading
  if (stopBtn) stopBtn.disabled = !status.isRunning || isLoading
}

function updateConfigDisplay(config) {
  document.getElementById("interval").value = config.interval
  updateIntervalDisplay()
}

function updateMappingsDisplay(mappings) {
  const emptyState = document.getElementById("mappings-empty")
  const tableContainer = document.getElementById("mappings-table")
  const tbody = document.getElementById("mappings-tbody")

  if (!mappings || mappings.length === 0) {
    if (emptyState) emptyState.style.display = "block"
    if (tableContainer) tableContainer.style.display = "none"
  } else {
    if (emptyState) emptyState.style.display = "none"
    if (tableContainer) tableContainer.style.display = "block"

    if (tbody) {
      tbody.innerHTML = mappings
        .map(
          (mapping) => `
              <tr>
                  <td>
                      <div class="mapping-name">${escapeHtml(mapping.name)}</div>
                      ${mapping.description ? `<div class="mapping-description">${escapeHtml(mapping.description)}</div>` : ""}
                  </td>
                  <td>
                      <div class="sheet-info">
                          <div class="sheet-id">${formatSheetId(mapping.sourceSheet)}</div>
                          <div class="tab-name">${escapeHtml(mapping.sourceTab)}</div>
                      </div>
                  </td>
                  <td class="text-center">
                      <i data-lucide="arrow-right"></i>
                  </td>
                  <td>
                      <div class="sheet-info">
                          <div class="sheet-id">${formatSheetId(mapping.destSheet)}</div>
                          <div class="tab-name">${escapeHtml(mapping.destTab)}</div>
                      </div>
                  </td>
                  <td>
                      <div class="action-buttons">
                          <button class="btn btn-outline btn-small" onclick="editMapping('${mapping.id}')">
                              <i data-lucide="edit"></i>
                          </button>
                          <button class="btn btn-outline btn-small" onclick="deleteMapping('${mapping.id}')" style="color: #dc2626;">
                              <i data-lucide="trash-2"></i>
                          </button>
                      </div>
                  </td>
              </tr>
          `,
        )
        .join("")

      setTimeout(() => {
        if (window.lucide && window.lucide.createIcons) {
          window.lucide.createIcons()
        }
      }, 50)
    }
  }
}

// Global function for editing mappings (called from HTML)
window.editMapping = (id) => {
  const mapping = currentMappings.find((m) => m.id === id)
  if (mapping) {
    openModal(mapping)
  }
}

// Global function for deleting mappings (called from HTML)
window.deleteMapping = deleteMapping

// Utility Functions
function setLoading(loading) {
  isLoading = loading
  const buttons = document.querySelectorAll("button")
  buttons.forEach((btn) => {
    btn.disabled = loading
  })
}

function showMessage(text) {
  const messageEl = document.getElementById("config-message")
  messageEl.textContent = text
  messageEl.style.display = "block"

  setTimeout(() => {
    messageEl.style.display = "none"
  }, 3000)
}

function formatInterval(ms) {
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatSheetId(sheetId) {
  return sheetId.length > 20 ? `${sheetId.substring(0, 20)}...` : sheetId
}

function escapeHtml(text) {
  const div = document.createElement("div")
  div.textContent = text
  return div.innerHTML
}
