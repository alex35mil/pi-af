import * as fs from "node:fs"
import * as path from "node:path"

import { getPackageDir, type ExtensionContext, type ToolDefinition } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

import {
    preparePublication,
    publicationBinding,
    publicationToolDescription,
    publicationToolSchema,
    publicationWireArguments,
    type PublicationIdentity,
    type PublicationOperation,
} from "./publication.js"

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value)
}

export function readHarnessName(packageDir: string = getPackageDir()): string {
    const pkg: unknown = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8"))
    if (!record(pkg)) throw new Error("Invalid running harness package metadata.")
    const name = record(pkg.piConfig) ? pkg.piConfig.name : undefined
    if (name === undefined || name === "pi") return "Pi"
    if (typeof name !== "string" || !name.trim()) throw new Error("Invalid running harness name.")
    return name
}

export function readPublicationIdentity(ctx: Pick<ExtensionContext, "model">): PublicationIdentity {
    if (!ctx.model?.provider || !ctx.model.id)
        throw new Error("Cannot sign AI-assisted publication without the current model identity.")
    return { harness: readHarnessName(), provider: ctx.model.provider, modelId: ctx.model.id }
}

export function decoratePublicationTool<T extends ToolDefinition>(native: T, operation: PublicationOperation) {
    if (publicationBinding(operation).kind === "none") return native
    return {
        ...native,
        parameters: Type.Unsafe(publicationToolSchema(operation)),
        description: publicationToolDescription(operation, native.description),
        async execute(...[id, params, signal, onUpdate, ctx]: Parameters<ToolDefinition["execute"]>) {
            const prepared = preparePublication(operation, params as Record<string, unknown>, () =>
                readPublicationIdentity(ctx),
            )
            return native.execute(id, publicationWireArguments(operation, prepared), signal, onUpdate, ctx)
        },
    }
}
