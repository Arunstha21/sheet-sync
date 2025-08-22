import "dotenv/config"
import express from "express"
import path from "path"
import { fileURLToPath } from "url"
import router from "./webhook.js"
import logger from "./logger.js"
import { fullSync, setMappings } from "./sync.js"
import { loadCache, saveCache } from "./cache.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

app.use(express.json())
app.use(express.static(path.join(__dirname, "public")))

const syncStatus = {
  isRunning: false,
  lastSync: null,
  nextSync: null,
  totalSyncs: 0,
  errors: 0,
  syncInterval: null,
}

const syncConfig = {
  interval: Number.parseInt(process.env.FULL_SYNC_INTERVAL_MS || "300000", 10),
  autoStart: false,
}

const TAB_MAPPINGS = [
  {
    id: "1",
    sourceSheet: "1DrC-hl0APcpcd_mWPZFzk2lrX-Kqk5vbXgvYXvfgMTw",
    sourceTab: "Prod_to_Main",
    destSheet: "1BZKGjTMfmMepHvjlrMJxyoT5CQ2Ti0e--yuMHDSikmM",
    destTab: "Prod_to_Main",
    name: "Production to Main",
    description: "Sync production data to main sheet",
  },
  {
    id: "2",
    sourceSheet: "1BZKGjTMfmMepHvjlrMJxyoT5CQ2Ti0e--yuMHDSikmM",
    sourceTab: "Main_to_Prod",
    destSheet: "1DrC-hl0APcpcd_mWPZFzk2lrX-Kqk5vbXgvYXvfgMTw",
    destTab: "Main_to_Prod",
    name: "Main to Production",
    description: "Sync main sheet to production data",
  },
]

setMappings(TAB_MAPPINGS)

async function runSync() {
  try {
    setMappings(TAB_MAPPINGS)
    await fullSync()
    saveCache()

    syncStatus.lastSync = new Date().toISOString()
    syncStatus.totalSyncs++

    if (syncStatus.syncInterval) {
      syncStatus.nextSync = new Date(Date.now() + syncConfig.interval).toISOString()
    }
  } catch (error) {
    logger.error({ error }, "Sync failed")
    syncStatus.errors++
  }
}

app.get("/api/sync/status", (req, res) => {
  try {
    res.json({
      isRunning: syncStatus.isRunning,
      lastSync: syncStatus.lastSync,
      nextSync: syncStatus.nextSync,
      totalSyncs: syncStatus.totalSyncs,
      errors: syncStatus.errors,
    })
  } catch (error) {
    logger.error({ error }, "Failed to get sync status")
    res.status(500).json({ error: "Failed to get status" })
  }
})

app.get("/api/sync/config", (req, res) => {
  try {
    res.json(syncConfig)
  } catch (error) {
    logger.error({ error }, "Failed to get sync config")
    res.status(500).json({ error: "Failed to get config" })
  }
})

app.post("/api/sync/config", (req, res) => {
  try {
    const { interval, autoStart } = req.body

    if (interval && interval < 10000) {
      return res.status(400).json({ error: "Interval must be at least 10 seconds" })
    }

    const oldInterval = syncConfig.interval

    if (interval) {
      syncConfig.interval = interval
    }
    if (typeof autoStart === "boolean") {
      syncConfig.autoStart = autoStart
    }

    if (syncStatus.isRunning && interval && interval !== oldInterval) {
      if (syncStatus.syncInterval) {
        clearInterval(syncStatus.syncInterval)
      }
      syncStatus.syncInterval = setInterval(runSync, syncConfig.interval)
      syncStatus.nextSync = new Date(Date.now() + syncConfig.interval).toISOString()
    }

    res.json({
      ...syncConfig,
      message:
        interval !== oldInterval && syncStatus.isRunning
          ? "Configuration updated and sync interval restarted"
          : "Configuration updated",
    })
  } catch (error) {
    logger.error({ error }, "Failed to update sync config")
    res.status(500).json({ error: "Failed to update config" })
  }
})

app.post("/api/sync/start", async (req, res) => {
  try {
    if (syncStatus.isRunning) {
      return res.status(400).json({ error: "Sync is already running" })
    }

    loadCache()

    syncStatus.syncInterval = setInterval(runSync, syncConfig.interval)
    syncStatus.isRunning = true
    syncStatus.nextSync = new Date(Date.now() + syncConfig.interval).toISOString()

    await runSync()

    res.json({
      message: "Sync started successfully",
      status: {
        isRunning: syncStatus.isRunning,
        nextSync: syncStatus.nextSync,
      },
    })
  } catch (error) {
    logger.error({ error }, "Failed to start sync")
    res.status(500).json({ error: "Failed to start sync" })
  }
})

app.post("/api/sync/stop", (req, res) => {
  try {
    if (!syncStatus.isRunning) {
      return res.status(400).json({ error: "Sync is not running" })
    }

    if (syncStatus.syncInterval) {
      clearInterval(syncStatus.syncInterval)
      syncStatus.syncInterval = null
    }

    syncStatus.isRunning = false
    syncStatus.nextSync = null

    saveCache()

    res.json({
      message: "Sync stopped successfully",
      status: {
        isRunning: syncStatus.isRunning,
        nextSync: syncStatus.nextSync,
      },
    })
  } catch (error) {
    logger.error({ error }, "Failed to stop sync")
    res.status(500).json({ error: "Failed to stop sync" })
  }
})

app.post("/api/sync/trigger", async (req, res) => {
  try {
    await fullSync()
    saveCache()

    syncStatus.lastSync = new Date().toISOString()
    syncStatus.totalSyncs++

    res.json({
      message: "Manual sync completed successfully",
      lastSync: syncStatus.lastSync,
      totalSyncs: syncStatus.totalSyncs,
    })
  } catch (error) {
    logger.error({ error }, "Manual sync failed")
    syncStatus.errors++
    res.status(500).json({ error: "Manual sync failed" })
  }
})

app.get("/api/mappings", (req, res) => {
  try {
    res.json(TAB_MAPPINGS)
  } catch (error) {
    logger.error({ error }, "Failed to get mappings")
    res.status(500).json({ error: "Failed to get mappings" })
  }
})

app.post("/api/mappings", (req, res) => {
  try {
    const { sourceSheet, sourceTab, destSheet, destTab, name, description } = req.body

    if (!sourceSheet || !sourceTab || !destSheet || !destTab || !name) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    const newMapping = {
      id: Date.now().toString(),
      sourceSheet,
      sourceTab,
      destSheet,
      destTab,
      name,
      description: description || "",
    }

    TAB_MAPPINGS.push(newMapping)
    setMappings(TAB_MAPPINGS)
    res.status(201).json(newMapping)
  } catch (error) {
    logger.error({ error }, "Failed to create mapping")
    res.status(500).json({ error: "Failed to create mapping" })
  }
})

app.put("/api/mappings/:id", (req, res) => {
  try {
    const mappingIndex = TAB_MAPPINGS.findIndex((m) => m.id === req.params.id)

    if (mappingIndex === -1) {
      return res.status(404).json({ error: "Mapping not found" })
    }

    TAB_MAPPINGS[mappingIndex] = {
      ...TAB_MAPPINGS[mappingIndex],
      ...req.body,
      id: req.params.id,
    }

    setMappings(TAB_MAPPINGS)
    res.json(TAB_MAPPINGS[mappingIndex])
  } catch (error) {
    logger.error({ error }, "Failed to update mapping")
    res.status(500).json({ error: "Failed to update mapping" })
  }
})

app.delete("/api/mappings/:id", (req, res) => {
  try {
    const mappingIndex = TAB_MAPPINGS.findIndex((m) => m.id === req.params.id)

    if (mappingIndex === -1) {
      return res.status(404).json({ error: "Mapping not found" })
    }

    TAB_MAPPINGS.splice(mappingIndex, 1)
    setMappings(TAB_MAPPINGS)
    res.json({ message: "Mapping deleted successfully" })
  } catch (error) {
    logger.error({ error }, "Failed to delete mapping")
    res.status(500).json({ error: "Failed to delete mapping" })
  }
})

app.use(router)

const port = Number.parseInt(process.env.PORT || "3000", 10)

loadCache()

app.listen(port, () => {
  logger.info({ port }, "Sync server started")
})

let mainSyncInterval = null
if (syncConfig.autoStart) {
  mainSyncInterval = setInterval(async () => {
    try {
      await fullSync()
      saveCache()
    } catch (err) {
      logger.error({ err }, "fullSync failed")
    }
  }, syncConfig.interval)
}

function gracefulShutdown(signal) {
  logger.info({ signal }, "Received shutdown signal, cleaning up...")

  if (mainSyncInterval) {
    clearInterval(mainSyncInterval)
  }
  if (syncStatus.syncInterval) {
    clearInterval(syncStatus.syncInterval)
  }

  saveCache()
  process.exit(0)
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"))
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))

process.on("unhandledRejection", (reason, promise) => {
  logger.error({ reason, promise }, "Unhandled Rejection")
})

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught Exception")
  saveCache()
  process.exit(1)
})
