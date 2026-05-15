/**
 * Drizzle relations — declarative graph between tables.
 *
 * These power the relational query API:
 *
 *   db.query.users.findFirst({
 *     where: eq(users.id, id),
 *     with: { jobs: { with: { template: true } } },
 *   });
 *
 * Without `relations()`, the same query needs manual joins. Worth it.
 */

import { relations } from 'drizzle-orm';

import { categories } from './categories';
import { creditLedger } from './credit-ledger';
import { jobs } from './jobs';
import { savedTemplates } from './saved-templates';
import { templateCategories } from './template-categories';
import { templateVersions } from './template-versions';
import { templates } from './templates';
import { users } from './users';

export const usersRelations = relations(users, ({ many }) => ({
  jobs: many(jobs),
  creditEntries: many(creditLedger),
  savedTemplates: many(savedTemplates),
}));

export const savedTemplatesRelations = relations(savedTemplates, ({ one }) => ({
  user: one(users, { fields: [savedTemplates.userId], references: [users.id] }),
  template: one(templates, {
    fields: [savedTemplates.templateId],
    references: [templates.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_parent',
  }),
  children: many(categories, { relationName: 'category_parent' }),
  // Many-to-many: a category lists every template (primary or extra)
  // through the `template_categories` join row.
  templateMemberships: many(templateCategories),
}));

export const templatesRelations = relations(templates, ({ many }) => ({
  // 1..3 category memberships; exactly one has `isPrimary: true`.
  categoryMemberships: many(templateCategories),
  versions: many(templateVersions),
  jobs: many(jobs),
  savedBy: many(savedTemplates),
}));

export const templateCategoriesRelations = relations(templateCategories, ({ one }) => ({
  template: one(templates, {
    fields: [templateCategories.templateId],
    references: [templates.id],
  }),
  category: one(categories, {
    fields: [templateCategories.categoryId],
    references: [categories.id],
  }),
}));

export const templateVersionsRelations = relations(templateVersions, ({ one, many }) => ({
  template: one(templates, {
    fields: [templateVersions.templateId],
    references: [templates.id],
  }),
  publisher: one(users, {
    fields: [templateVersions.publishedBy],
    references: [users.id],
  }),
  jobs: many(jobs),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  user: one(users, { fields: [jobs.userId], references: [users.id] }),
  template: one(templates, {
    fields: [jobs.templateId],
    references: [templates.id],
  }),
  templateVersion: one(templateVersions, {
    fields: [jobs.templateVersionId],
    references: [templateVersions.id],
  }),
  creditEntries: many(creditLedger),
}));

export const creditLedgerRelations = relations(creditLedger, ({ one }) => ({
  user: one(users, { fields: [creditLedger.userId], references: [users.id] }),
  job: one(jobs, { fields: [creditLedger.jobId], references: [jobs.id] }),
}));
