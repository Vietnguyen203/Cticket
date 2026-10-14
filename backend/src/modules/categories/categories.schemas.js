const { z } = require('zod');

const MAX_DESCRIPTION_LENGTH = 2000;

// No slug field: the slug is always made from the name (categories.service.js).
// A "slug" sent anyway is dropped by zod like any unknown field.
const fields = {
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable(),
};

const idParams = z.object({ id: z.uuid() });

const createCategory = z.object({
  name: fields.name,
  description: fields.description.optional(),
});

const updateCategory = z
  .object({
    name: fields.name.optional(),
    description: fields.description.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

module.exports = { idParams, createCategory, updateCategory };
