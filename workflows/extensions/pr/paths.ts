import * as path from "node:path"

// File must already be resolved through the selected PR's private-path guard.
export function evidenceLocation(root: string, file: string) {
    return { relative: path.relative(root, file), absolute: file }
}
