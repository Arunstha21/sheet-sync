import { google } from "googleapis"
import crypto from "crypto"
import fs from "fs"
import path from "path"
import logger from "./logger.js"

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

export async function getSheetsClient() {
  let auth

  const keyPath = path.join(process.cwd(), "key.json")
  if (fs.existsSync(keyPath)) {
    try {
      const keyFile = JSON.parse(fs.readFileSync(keyPath, "utf8"))
      auth = new google.auth.GoogleAuth({
        credentials: keyFile,
        scopes: SCOPES,
      })
      logger.info("Using service account credentials from key.json")
    } catch (error) {
      logger.error({ error: error.message }, "Failed to read key.json, falling back to default auth")
      auth = new google.auth.GoogleAuth({ scopes: SCOPES })
    }
  } else {
    logger.info("key.json not found, using default Google Auth")
    auth = new google.auth.GoogleAuth({ scopes: SCOPES })
  }

  const client = await auth.getClient()
  return google.sheets({ version: "v4", auth: client })
}

export function checksum2D(values) {
  const s = JSON.stringify(values || [])
  return crypto.createHash("sha256").update(s).digest("hex")
}

export async function batchGetValues(sheets, spreadsheetId, ranges) {
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
  })
  return res.data.valueRanges.map((vr) => vr.values || [])
}

export async function batchUpdateValues(sheets, spreadsheetId, updates) {
  if (!updates.length) return
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((u) => ({ range: u.range, values: u.values })),
    },
  })
}

export async function withBackoff(fn, { tries = 5, baseMs = 500 } = {}) {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      const status = err?.code || err?.response?.status
      const retriable = [429, 500, 502, 503, 504].includes(status)
      attempt++
      if (!retriable || attempt >= tries) throw err
      const delay = Math.min(15000, baseMs * Math.pow(2, attempt))
      logger.warn({ status, attempt, delay }, "Retrying after error")
      await new Promise((r) => setTimeout(r, delay))
    }
  }
}
