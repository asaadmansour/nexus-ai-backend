import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

/**
 * Passes when the value is a date strictly in the future.
 *
 * `@IsDateString()` only proves a value *is* a date — it happily accepts one
 * that has already passed, which let projects be created with deadlines weeks
 * in the past. Everything scheduled from the deadline (planning, matching
 * urgency, late-delivery counters) then starts out already breached.
 */
/**
 * Minimum notice a project must give before its deadline. A deadline merely in
 * the future still allowed a full build to be ordered for tomorrow, which no
 * team can staff, plan and deliver. Configurable via PROJECT_MIN_LEAD_TIME_DAYS;
 * set it to 0 to allow any future date. See ISSUES.md #11.
 */
export const MIN_DEADLINE_LEAD_DAYS = (() => {
  const raw = Number(process.env.PROJECT_MIN_LEAD_TIME_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 3;
})();

export function IsFutureDate(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isFutureDate',
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value === undefined || value === null) return true;
          if (typeof value !== 'string' && !(value instanceof Date))
            return false;

          const parsed = value instanceof Date ? value : new Date(value);
          if (Number.isNaN(parsed.getTime())) return false;

          const earliest =
            Date.now() + MIN_DEADLINE_LEAD_DAYS * 24 * 60 * 60 * 1000;
          return parsed.getTime() > earliest;
        },
        defaultMessage(args: ValidationArguments) {
          return MIN_DEADLINE_LEAD_DAYS > 0
            ? `${args.property} must be at least ${MIN_DEADLINE_LEAD_DAYS} day(s) from now`
            : `${args.property} must be a date in the future`;
        },
      },
    });
  };
}
