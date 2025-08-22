import fs from "fs"
import logger from "./logger.js"

const CACHE_FILE = "cache.json"
let cache = {}

export function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"))
      logger.info("Cache loaded successfully")
    } else {
      logger.info("No cache file found, starting with empty cache")
    }
  } catch (error) {
    logger.error({ error }, "Failed to load cache, starting with empty cache")
    cache = {}
  }
}

export function saveCache() {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2))
    logger.debug("Cache saved successfully")
  } catch (error) {
    logger.error({ error }, "Failed to save cache")
  }
}

export function getCache(key) {
  return cache[key]
}

export function setCache(key, value) {
  cache[key] = value
}

export const getChecksum = getCache
export const setChecksum = setCache
