import express from "express"
import { applyRangeUpdate } from "./sync.js"
import logger from "./logger.js"

const router = express.Router()

router.use(express.json())

router.post("/webhook", async (req, res) => {
  try {
    const { sheetName, range, values } = req.body

    if (!sheetName || !range || !values) {
      return res.status(400).json({
        error: "Missing required fields: sheetName, range, values",
      })
    }

    await applyRangeUpdate({ sheetName, range, values })
    res.json({ success: true })
  } catch (error) {
    logger.error({ error, body: req.body }, "Webhook processing failed")
    res.status(500).json({ error: "Internal server error" })
  }
})

router.get("/health", (req, res) => {
  res.json({ status: "healthy", timestamp: new Date().toISOString() })
})

export default router
