import logger from "./logger.js"
import { getSheetsClient, batchGetValues, batchUpdateValues, checksum2D, withBackoff } from "./google.js"
import { getCache as getChecksum, setCache as setChecksum } from "./cache.js"

const MAX_OPS = Number.parseInt(process.env.RATE_LIMIT_MAX_OPS_PER_100S || "80", 10)
let tokens = MAX_OPS
setInterval(() => {
  tokens = Math.min(MAX_OPS, tokens + MAX_OPS)
}, 100000)
function consumeTokens(n) {
  if (tokens >= n) {
    tokens -= n
    return true
  }
  return false
}

let currentMappings = []
export function setMappings(mappings) {
  currentMappings = mappings
}

export function getMappings() {
  return currentMappings
}

export async function fullSync() {
  const sheets = await getSheetsClient()
  const TAB_MAPPINGS = getMappings()

  if (!TAB_MAPPINGS || TAB_MAPPINGS.length === 0) {
    logger.warn("No mappings available for sync")
    return
  }

  if (!consumeTokens(1)) {
    logger.warn("Rate limit: skipping fullSync cycle")
    return
  }

  const sheetRanges = new Map()
  const mappingsBySheet = new Map()

  for (const mapping of TAB_MAPPINGS) {
    // Group source ranges
    if (!sheetRanges.has(mapping.sourceSheet)) {
      sheetRanges.set(mapping.sourceSheet, [])
      mappingsBySheet.set(mapping.sourceSheet, [])
    }
    sheetRanges.get(mapping.sourceSheet).push(`${mapping.sourceTab}!A:Z`)
    mappingsBySheet.get(mapping.sourceSheet).push({ ...mapping, type: "source" })

    // Group destination ranges
    if (!sheetRanges.has(mapping.destSheet)) {
      sheetRanges.set(mapping.destSheet, [])
      mappingsBySheet.set(mapping.destSheet, [])
    }
    sheetRanges.get(mapping.destSheet).push(`${mapping.destTab}!A:Z`)
    mappingsBySheet.get(mapping.destSheet).push({ ...mapping, type: "dest" })
  }

  const allSheetData = new Map()
  for (const [sheetId, ranges] of sheetRanges) {
    try {
      const uniqueRanges = [...new Set(ranges)] // Remove duplicates
      const values = await withBackoff(() => batchGetValues(sheets, sheetId, uniqueRanges))

      // Map range to data
      const rangeData = new Map()
      uniqueRanges.forEach((range, index) => {
        rangeData.set(range, values[index] || [])
      })
      allSheetData.set(sheetId, rangeData)

      logger.debug({ sheetId, rangeCount: uniqueRanges.length }, "Batched read from sheet")
    } catch (error) {
      logger.error({ error, sheetId }, "Error reading sheet data")
      continue
    }
  }

  const updatesBySheet = new Map()

  for (const mapping of TAB_MAPPINGS) {
    try {
      const sourceRange = `${mapping.sourceTab}!A:Z`
      const destRange = `${mapping.destTab}!A:Z`

      const sourceValues = allSheetData.get(mapping.sourceSheet)?.get(sourceRange) || []
      const destValues = allSheetData.get(mapping.destSheet)?.get(destRange) || []

      const sourceChecksum = checksum2D(sourceValues)
      const destChecksum = checksum2D(destValues)
      const sourceKey = `${mapping.sourceSheet}:${mapping.sourceTab}`
      const destKey = `${mapping.destSheet}:${mapping.destTab}`

      const cachedSourceChecksum = getChecksum(sourceKey)
      const cachedDestChecksum = getChecksum(destKey)

      if (sourceChecksum !== destChecksum) {
        const sourceChanged = cachedSourceChecksum && cachedSourceChecksum !== sourceChecksum
        const destChanged = cachedDestChecksum && cachedDestChecksum !== destChecksum

        if (sourceChanged || (!cachedSourceChecksum && !cachedDestChecksum)) {
          // Group updates by destination sheet
          if (!updatesBySheet.has(mapping.destSheet)) {
            updatesBySheet.set(mapping.destSheet, [])
          }
          updatesBySheet.get(mapping.destSheet).push({
            range: `${mapping.destTab}!A1`,
            values: sourceValues,
            checksumKey: destKey,
            checksum: sourceChecksum,
            direction: sourceChanged ? "source->dest" : "source->dest (initial)",
          })
          logger.info(
            { sourceKey, destKey },
            sourceChanged ? "Source changed, syncing to dest" : "Initial sync from source to dest",
          )
        } else if (destChanged && !sourceChanged) {
          if (!updatesBySheet.has(mapping.destSheet)) {
            updatesBySheet.set(mapping.destSheet, [])
          }
          updatesBySheet.get(mapping.destSheet).push({
            range: `${mapping.destTab}!A1`,
            values: sourceValues,
            checksumKey: destKey,
            checksum: sourceChecksum,
            direction: "source->dest (forced)",
          })
          logger.warn(
            { sourceKey, destKey },
            "Destination changed independently - forcing sync from source to maintain unidirectional flow",
          )
        } else if (sourceChanged && destChanged) {
          if (!updatesBySheet.has(mapping.destSheet)) {
            updatesBySheet.set(mapping.destSheet, [])
          }
          updatesBySheet.get(mapping.destSheet).push({
            range: `${mapping.destTab}!A1`,
            values: sourceValues,
            checksumKey: destKey,
            checksum: sourceChecksum,
            direction: "source->dest (conflict resolved)",
          })
          logger.warn({ sourceKey, destKey }, "Conflict detected: both sides changed. Enforcing source->dest only")
        }
      }

      setChecksum(sourceKey, sourceChecksum)
      setChecksum(destKey, destChecksum)
    } catch (error) {
      logger.error({ error, mapping }, "Error processing mapping in fullSync")
      continue
    }
  }

  if (updatesBySheet.size === 0) {
    logger.debug("fullSync: no changes detected")
    return
  }

  if (!consumeTokens(1)) {
    logger.warn("Rate limit: skipping updates this cycle")
    return
  }

  for (const [sheetId, updates] of updatesBySheet) {
    try {
      const batchUpdates = updates.map((update) => ({
        range: update.range,
        values: update.values,
      }))

      await withBackoff(() => batchUpdateValues(sheets, sheetId, batchUpdates))

      // Update checksums after successful batch write
      for (const update of updates) {
        setChecksum(update.checksumKey, update.checksum)
        logger.info(
          {
            range: update.range,
            spreadsheetId: sheetId,
            direction: update.direction,
          },
          "fullSync: applied batched unidirectional update",
        )
      }

      logger.info({ sheetId, updateCount: updates.length }, "Batched write to sheet")
    } catch (error) {
      logger.error({ error, sheetId, updateCount: updates.length }, "Failed to apply batched updates")
    }
  }
}

export async function applyRangeUpdate({ sheetName, range, values }) {
  const sheets = await getSheetsClient()
  const TAB_MAPPINGS = getMappings()

  // Map source tab → destination tab
  const mapping = TAB_MAPPINGS.find((m) => m.sourceTab === sheetName)
  if (!mapping) {
    logger.warn({ sheetName }, "No mapping found; ignoring")
    return
  }

  const destRange = `${mapping.destTab}!${range}`
  const key = `${mapping.destSheet}:${mapping.destTab}`

  if (!consumeTokens(1)) {
    logger.warn("Rate limit: dropping push update")
    return
  }

  await withBackoff(async () => {
    await batchUpdateValues(sheets, mapping.destSheet, [{ range: destRange, values }])
  })

  setChecksum(key, null)
  logger.info({ from: `${sheetName}!${range}`, to: destRange }, "Applied push update")
}
