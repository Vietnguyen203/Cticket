const { pool } = require('../../database/pool');
const { PG_ERROR } = require('../../database/errors');
const AppError = require('../../utils/AppError');
const { slugify } = require('../../utils/slug');
const categoriesRepository = require('./categories.repository');

const CATEGORY_USAGE_FK = 'event_categories_category_id_fkey';

function toPublicCategory(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function listCategories() {
  return (await categoriesRepository.listAll(pool)).map(toPublicCategory);
}

async function createCategory({ name, slug, description }) {
  // A duplicate slug is rejected by the UNIQUE constraint → 409 CATEGORY_SLUG_TAKEN.
  const row = await categoriesRepository.insert(pool, { name, slug: slug ?? slugify(name), description });
  return toPublicCategory(row);
}

async function updateCategory(id, changes) {
  const row = await categoriesRepository.update(pool, id, changes);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Category not found.');
  }
  return toPublicCategory(row);
}

/**
 * The foreign key from event_categories is ON DELETE RESTRICT, so PostgreSQL
 * itself refuses to delete a category that events still use. Checking usage
 * with a SELECT first would race with an event being tagged in between.
 */
async function deleteCategory(id) {
  let deleted;
  try {
    deleted = await categoriesRepository.remove(pool, id);
  } catch (err) {
    if (err.code === PG_ERROR.FOREIGN_KEY_VIOLATION && err.constraint === CATEGORY_USAGE_FK) {
      throw new AppError('CATEGORY_IN_USE', undefined, { cause: err });
    }
    throw err;
  }
  if (!deleted) {
    throw new AppError('NOT_FOUND', 'Category not found.');
  }
}

module.exports = { listCategories, createCategory, updateCategory, deleteCategory };
