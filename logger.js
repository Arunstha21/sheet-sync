import pino from "pino"

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  base: undefined,
  redact: ["req.headers.authorization"],
})

export default logger
