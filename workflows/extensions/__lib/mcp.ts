import * as fs from "node:fs"

import { Type } from "typebox"
import { Value } from "typebox/value"

const McpRecordSchema = Type.Record(Type.String(), Type.Unknown())
type McpSettings = Record<string, unknown> & { servers?: Record<string, unknown> }

export function readMcpSettings(filePath: string): McpSettings {
    if (!fs.existsSync(filePath)) return {}
    let value: unknown
    try {
        value = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    } catch (error) {
        throw new Error(`invalid JSON in ${filePath}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!Value.Check(McpRecordSchema, value)) throw new Error(`invalid MCP settings in ${filePath}: expected an object`)
    if (value.servers !== undefined && !Value.Check(McpRecordSchema, value.servers)) {
        throw new Error(`invalid MCP settings in ${filePath}: servers must be an object`)
    }
    return value as McpSettings
}
