import { pick, pickBy } from "lodash-es";

/** Raw payload -> Available data */
export abstract class BaseValidator<T extends object> {
  protected requiredFields: (keyof T)[] = [];
  protected optionalFields: (keyof T)[] = [];
  protected ignoredFields: (keyof T)[] = [];
  protected customValidators: ((val: T) => true | string)[] = [];

  /** @deprecated -> addCustomValidator */
  addValidator(validator: (val: T) => true | string) {
    this.customValidators.push(validator);
    return this;
  }

  addCustomValidator(validator: (val: T) => true | string) {
    this.customValidators.push(validator);
    return this;
  }

  protected validateField(field: keyof T, value: unknown): boolean {
    // TODO now only empty check, later should add type checks
    return value != null;
  }

  validate = (val: T): T => {
    const errors: string[] = [];

    // Step 1: Check required fields
    this.requiredFields.forEach((field) => {
      if (!this.validateField(field, val[field])) {
        errors.push(`Missing required field: ${String(field)}`);
      }
    });

    // Step 2: Run custom validators
    this.customValidators.forEach((validator) => {
      const result = validator(val);
      if (result !== true) {
        errors.push(`Custom validation failed ${result}`);
      }
    });

    if (errors.length > 0) {
      const errorCount = errors.length;
      const errorList = errors.map((error, index) => `  ${index + 1}. ${error}`).join("\n");

      throw new Error(
        `[${this.constructor.name}] Validation failed (${errorCount} error${errorCount > 1 ? "s" : ""}):\n${errorList}`
      );
    }

    // Step 3: Pick required and optional fields
    const required = pick(val, this.requiredFields);
    const optional = pickBy(val, (value, key) => {
      const typedKey = key as keyof T;
      return this.optionalFields.includes(typedKey) && value != null;
    }) as Partial<T>;
    // TODO ignoredFields

    return { ...required, ...optional } as T;
  };
}
