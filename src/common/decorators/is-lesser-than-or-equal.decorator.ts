import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from 'class-validator';

export function IsLesserThanOrEqual(
  property: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isLesserThanOrEqual',
      target: object.constructor,
      propertyName: propertyName,
      constraints: [property],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [relatedPropertyName] = args.constraints as [string];
          const relatedValue = (args.object as Record<string, unknown>)[
            relatedPropertyName
          ];

          if (value === undefined || relatedValue === undefined) return true;
          return (
            typeof value === 'number' &&
            typeof relatedValue === 'number' &&
            value <= relatedValue
          );
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must be less than or equal to ${args.constraints[0]}`;
        },
      },
    });
  };
}
