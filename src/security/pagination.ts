import { Type } from '@fastify/type-provider-typebox';

export const pagination = Type.Object({
  limit: Type.Optional(Type.String({ pattern: '^(?:[1-9][0-9]?|100)$' })),
  offset: Type.Optional(Type.String({ pattern: '^(?:0|[1-9][0-9]{0,3}|10000)$' })),
}, { additionalProperties: false });
