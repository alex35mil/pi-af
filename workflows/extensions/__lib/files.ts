import * as fs from "node:fs"

export function writeTextAtomically(filePath: string, content: string): void {
    const temporaryPath = `${filePath}.${process.pid}.tmp`
    try {
        const options = fs.existsSync(filePath) ? { mode: fs.statSync(filePath).mode } : undefined
        fs.writeFileSync(temporaryPath, content, options)
        fs.renameSync(temporaryPath, filePath)
    } finally {
        fs.rmSync(temporaryPath, { force: true })
    }
}
