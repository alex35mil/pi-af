/**
 * Validation with pi-schema, the validator pi itself uses for tool arguments.
 *
 * Schemas stay TypeBox builders: pi still types extension tools with TypeBox, and pi-schema's
 * `compile()` reads TypeBox schemas as JSON Schema and keeps their static types. Compile each
 * schema once where it's defined, then validate through the compiled validator.
 */
import type { ValidationError, Validator } from "@earendil-works/pi-schema"

export { compile, type Validator } from "@earendil-works/pi-schema"

/** One line per error: the JSON Pointer of the failing value (`/` for the value itself) and pi-schema's message. */
export function describeErrors(errors: readonly ValidationError[]): string[] {
    return errors.map((error) => `${error.path || "/"}: ${error.message}`)
}

/** Raised by {@link parse}: the formatted errors in the message, pi-schema's errors as `cause`. */
export class SchemaValidationError extends Error {
    override readonly cause: readonly ValidationError[]

    constructor(errors: readonly ValidationError[]) {
        super(`invalid input: ${describeErrors(errors).join("; ")}`)
        this.name = "SchemaValidationError"
        this.cause = errors
    }
}

/**
 * `value` itself when the validator accepts it, else a {@link SchemaValidationError}. Strict: nothing is
 * stripped, converted, or defaulted.
 */
export function parse<T>(validator: Validator<T>, value: unknown): T {
    const result = validator.validate(value)
    if (!result.ok) throw new SchemaValidationError(result.errors)
    return result.value
}
