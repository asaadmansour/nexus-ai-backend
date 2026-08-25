import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator';
import { collectUnsafeUrls } from './safe-url';

/**
 * Rejects a submitted URL payload containing anything that is not an absolute
 * http(s) URL. These values are rendered as clickable links to reviewers,
 * customers and admins, so a `javascript:` or `data:` URL here is a stored XSS
 * vector. See ISSUES.md #29.
 */
export function ContainsOnlySafeUrls(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'containsOnlySafeUrls',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (value == null) return true;
          return collectUnsafeUrls(value).length === 0;
        },
        defaultMessage(args: ValidationArguments) {
          const offenders = collectUnsafeUrls(args.value, args.property).slice(
            0,
            3,
          );
          return `${args.property} must contain only absolute http(s) URLs. Rejected: ${offenders.join('; ')}`;
        },
      },
    });
  };
}
