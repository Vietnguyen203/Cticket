const { pool } = require('../../database/pool');
const { withTransaction } = require('../../database/transaction');
const { recordAudit } = require('../audit');
const AppError = require('../../utils/AppError');
const { slugify } = require('../../utils/slug');
const { remember, invalidatesAfter, NAMESPACE, TTL } = require('../../redis/cache');
const categoriesRepository = require('./categories.repository');

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
  return remember(NAMESPACE.CATEGORIES, 'list', TTL.CATEGORIES, async () =>
    (await categoriesRepository.listAll(pool)).map(toPublicCategory),
  );
}

/**
 * The slug is always made from the name ("Âm nhạc" → am-nhac), never given:
 * two categories with the same name hit the UNIQUE slug → 409 CATEGORY_SLUG_TAKEN.
 */
async function createCategory({ name, description }) {
  const row = await categoriesRepository.insert(pool, { name, slug: slugify(name), description });
  return toPublicCategory(row);
}

/** A rename renames the slug too, so the two never drift apart. */
async function updateCategory(id, changes) {
  const withSlug = changes.name !== undefined ? { ...changes, slug: slugify(changes.name) } : changes;
  const row = await categoriesRepository.update(pool, id, withSlug);
  if (!row) {
    throw new AppError('NOT_FOUND', 'Category not found.');
  }
  return toPublicCategory(row);
}

/**
 * Delete a category, also when events use it (decided with the product owner):
 * it is taken off those events first, so an event that had only this category
 * is left with none until its organizer picks one again. Audited, because it
 * changes other people's events. The row is locked first, so an event cannot
 * be tagged with it in between (that request waits, then fails).
 */
async function deleteCategory(context, id) {
  await withTransaction(async (client) => {
    const category = await categoriesRepository.lockById(client, id);
    if (!category) {
      throw new AppError('NOT_FOUND', 'Category not found.');
    }
    const events = await categoriesRepository.unlinkEvents(client, id);
    await categoriesRepository.remove(client, id);
    await recordAudit(client, {
      context,
      action: 'CATEGORY_DELETED',
      entityType: 'category',
      entityId: id,
      oldValue: { name: category.name, slug: category.slug },
      newValue: { removedFromEvents: events },
    });
  });
}

/** Admin page: events per category (drafts included, so not public and not cached). */
async function categoryUsage() {
  return (await categoriesRepository.usage(pool)).map((row) => ({ categoryId: row.category_id, events: row.events }));
}

// Category names also appear in event lists and pages.
const changesCategories = [NAMESPACE.CATEGORIES, NAMESPACE.CATALOG];

module.exports = {
  listCategories,
  categoryUsage,
  createCategory: invalidatesAfter(changesCategories, createCategory),
  updateCategory: invalidatesAfter(changesCategories, updateCategory),
  deleteCategory: invalidatesAfter(changesCategories, deleteCategory),
};
