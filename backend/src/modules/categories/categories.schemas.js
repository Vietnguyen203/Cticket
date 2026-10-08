const { z } = require('zod');

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DESCRIPTION_LENGTH = 2000;

const fields = {
  name: z.string().trim().min(1).max(150),
  slug: z.string().trim().max(180).regex(SLUG_PATTERN, 'must be lowercase words separated by "-"'),
  description: z.string().trim().max(MAX_DESCRIPTION_LENGTH).nullable(),
};

const idParams = z.object({ id: z.uuid() });

const createCategory = z.object({
  name: fields.name,
  slug: fields.slug.optional(),
  description: fields.description.optional(),
});

const updateCategory = z
  .object({
    name: fields.name.optional(),
    slug: fields.slug.optional(),
    description: fields.description.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'at least one field is required' });

module.exports = { idParams, createCategory, updateCategory };
