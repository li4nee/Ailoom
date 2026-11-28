// SPDX-License-Identifier: MIT
import { z } from 'zod';

const interactionId = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9-]+$/);
const httpsUrlSchema = z.url({ protocol: /^https$/ }).max(2048);

const interactionCardSchema = z
  .object({
    id: interactionId,
    title: z.string().trim().min(1).max(80),
    description: z.string().trim().max(240),
    imageUrl: httpsUrlSchema.nullable(),
    imageAlt: z.string().trim().max(120),
    linkUrl: httpsUrlSchema,
    linkLabel: z.string().trim().min(1).max(30),
  })
  .strict();
const quickReplySchema = z
  .object({
    id: interactionId,
    label: z.string().trim().min(1).max(40),
    prompt: z.string().trim().min(1).max(300),
  })
  .strict();
const textFieldSchema = z
  .object({
    id: interactionId,
    label: z.string().trim().min(1).max(60),
    type: z.enum(['text', 'email']),
    required: z.boolean(),
  })
  .strict();
const selectFieldSchema = z
  .object({
    id: interactionId,
    label: z.string().trim().min(1).max(60),
    type: z.literal('select'),
    required: z.boolean(),
    options: z.array(z.string().trim().min(1).max(60)).min(2).max(8),
  })
  .strict();
const formFieldSchema = z.discriminatedUnion('type', [textFieldSchema, selectFieldSchema]);

/** Safe, admin-authored visitor interactions. No model-defined actions or destinations. */
export const widgetInteractionsSchema = z
  .object({
    cards: z.array(interactionCardSchema).max(8),
    quickReplies: z.array(quickReplySchema).max(6),
    form: z
      .object({
        title: z.string().trim().min(1).max(60),
        description: z.string().trim().max(240),
        submitLabel: z.string().trim().min(1).max(30),
        fields: z.array(formFieldSchema).min(1).max(5),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((interactions, context) => {
    const checkUniqueIds = (items: { id: string }[], path: (string | number)[]): void => {
      const seen = new Set<string>();
      for (const [index, item] of items.entries()) {
        if (seen.has(item.id)) {
          context.addIssue({
            code: 'custom',
            path: [...path, index, 'id'],
            message: 'IDs must be unique within this interaction list.',
          });
        }
        seen.add(item.id);
      }
    };

    checkUniqueIds(interactions.cards, ['cards']);
    checkUniqueIds(interactions.quickReplies, ['quickReplies']);
    if (interactions.form !== null) {
      checkUniqueIds(interactions.form.fields, ['form', 'fields']);
      for (const [fieldIndex, field] of interactions.form.fields.entries()) {
        if (field.type !== 'select') continue;
        const options = field.options.map((option) => option.toLowerCase());
        if (new Set(options).size !== options.length) {
          context.addIssue({
            code: 'custom',
            path: ['form', 'fields', fieldIndex, 'options'],
            message: 'Select options must be unique.',
          });
        }
      }
    }
  });

export type WidgetInteractions = z.infer<typeof widgetInteractionsSchema>;
