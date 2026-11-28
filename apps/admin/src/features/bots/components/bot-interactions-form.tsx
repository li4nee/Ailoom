// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';

import { FormAlert } from '@/components/form-alert';
import { hasRole, useWorkspaceRole } from '@/components/role-gate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/error-message';
import type { WidgetInteractions } from '@app/shared';

import { useBot, useUpdateBot } from '../api';

type FormConfig = NonNullable<WidgetInteractions['form']>;
type FormField = FormConfig['fields'][number];

function newId(prefix: string): string {
  try {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  } catch {
    return `${prefix}-${String(Date.now())}`;
  }
}

function TextControl({
  id,
  label,
  value,
  maxLength,
  disabled,
  type = 'text',
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  type?: 'text' | 'url';
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1 text-sm">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        maxLength={maxLength}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

export function BotInteractionsForm({
  workspaceId,
  botId,
}: {
  workspaceId: string;
  botId: string;
}) {
  const isAdmin = hasRole(useWorkspaceRole(), 'admin');
  const bot = useBot(workspaceId, botId);
  const update = useUpdateBot(workspaceId, botId);
  const [draft, setDraft] = useState<WidgetInteractions | null>(null);

  if (bot.isError) return <FormAlert message={errorMessage(bot.error)} />;
  if (bot.data === undefined) return <Skeleton className="h-24 w-full" />;

  const interactions = draft ?? bot.data.widgetInteractions;
  const form = interactions.form;
  const patch = (next: WidgetInteractions): void => {
    setDraft(next);
  };
  const patchCard = (index: number, values: Partial<WidgetInteractions['cards'][number]>): void => {
    patch({
      ...interactions,
      cards: interactions.cards.map((card, current) =>
        current === index ? { ...card, ...values } : card,
      ),
    });
  };
  const patchReply = (
    index: number,
    values: Partial<WidgetInteractions['quickReplies'][number]>,
  ): void => {
    patch({
      ...interactions,
      quickReplies: interactions.quickReplies.map((reply, current) =>
        current === index ? { ...reply, ...values } : reply,
      ),
    });
  };
  const patchForm = (values: Partial<FormConfig>): void => {
    if (form === null) return;
    patch({ ...interactions, form: { ...form, ...values } });
  };
  const patchField = (index: number, next: FormField): void => {
    if (form === null) return;
    patchForm({
      fields: form.fields.map((field, current) => (current === index ? next : field)),
    });
  };
  const addField = (): void => {
    if (form === null || form.fields.length >= 5) return;
    patchForm({
      fields: [...form.fields, { id: newId('field'), label: '', type: 'text', required: false }],
    });
  };

  return (
    <form
      className="max-w-2xl space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate({ widgetInteractions: interactions });
      }}
    >
      <div>
        <h2 className="text-lg font-semibold">Welcome interactions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add helpful links, suggested questions, and a short support form. These appear before a
          visitor starts chatting.
        </p>
      </div>

      <fieldset className="space-y-4 rounded-lg border p-4">
        <legend className="px-1 font-medium">Cards</legend>
        {interactions.cards.map((card, index) => (
          <div key={card.id} className="grid gap-3 rounded-md bg-muted/40 p-3 sm:grid-cols-2">
            <TextControl
              id={`card-title-${card.id}`}
              label="Title"
              maxLength={80}
              value={card.title}
              disabled={!isAdmin}
              onChange={(title) => {
                patchCard(index, { title });
              }}
            />
            <TextControl
              id={`card-link-label-${card.id}`}
              label="Link label"
              maxLength={30}
              value={card.linkLabel}
              disabled={!isAdmin}
              onChange={(linkLabel) => {
                patchCard(index, { linkLabel });
              }}
            />
            <TextControl
              id={`card-description-${card.id}`}
              label="Description"
              maxLength={240}
              value={card.description}
              disabled={!isAdmin}
              onChange={(description) => {
                patchCard(index, { description });
              }}
            />
            <TextControl
              id={`card-destination-${card.id}`}
              label="Destination (HTTPS)"
              maxLength={2048}
              type="url"
              value={card.linkUrl}
              disabled={!isAdmin}
              onChange={(linkUrl) => {
                patchCard(index, { linkUrl });
              }}
            />
            <TextControl
              id={`card-image-${card.id}`}
              label="Image URL (optional, HTTPS)"
              maxLength={2048}
              type="url"
              value={card.imageUrl ?? ''}
              disabled={!isAdmin}
              onChange={(value) => {
                patchCard(index, { imageUrl: value.trim() === '' ? null : value });
              }}
            />
            <TextControl
              id={`card-image-alt-${card.id}`}
              label="Image description (blank if decorative)"
              maxLength={120}
              value={card.imageAlt}
              disabled={!isAdmin}
              onChange={(imageAlt) => {
                patchCard(index, { imageAlt });
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={!isAdmin}
              onClick={() => {
                patch({ ...interactions, cards: interactions.cards.filter((_, i) => i !== index) });
              }}
            >
              Remove card
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={!isAdmin || interactions.cards.length >= 8}
          onClick={() => {
            patch({
              ...interactions,
              cards: [
                ...interactions.cards,
                {
                  id: newId('card'),
                  title: '',
                  description: '',
                  imageUrl: null,
                  imageAlt: '',
                  linkUrl: '',
                  linkLabel: 'Learn more',
                },
              ],
            });
          }}
        >
          Add card
        </Button>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 font-medium">Quick replies</legend>
        <p className="text-sm text-muted-foreground">
          Selecting one sends its configured prompt as a visitor message.
        </p>
        {interactions.quickReplies.map((reply, index) => (
          <div key={reply.id} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
            <TextControl
              id={`reply-label-${reply.id}`}
              label="Button label"
              maxLength={40}
              value={reply.label}
              disabled={!isAdmin}
              onChange={(label) => {
                patchReply(index, { label });
              }}
            />
            <TextControl
              id={`reply-prompt-${reply.id}`}
              label="Message sent"
              maxLength={300}
              value={reply.prompt}
              disabled={!isAdmin}
              onChange={(prompt) => {
                patchReply(index, { prompt });
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="self-end"
              disabled={!isAdmin}
              onClick={() => {
                patch({
                  ...interactions,
                  quickReplies: interactions.quickReplies.filter((_, i) => i !== index),
                });
              }}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          disabled={!isAdmin || interactions.quickReplies.length >= 6}
          onClick={() => {
            patch({
              ...interactions,
              quickReplies: [
                ...interactions.quickReplies,
                { id: newId('reply'), label: '', prompt: '' },
              ],
            });
          }}
        >
          Add quick reply
        </Button>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 font-medium">Support form</legend>
        {form === null ? (
          <Button
            type="button"
            variant="outline"
            disabled={!isAdmin}
            onClick={() => {
              patch({
                ...interactions,
                form: {
                  title: 'Contact support',
                  description: '',
                  submitLabel: 'Send to support',
                  fields: [
                    {
                      id: newId('field'),
                      label: 'How can we help?',
                      type: 'text',
                      required: true,
                    },
                  ],
                },
              });
            }}
          >
            Add form
          </Button>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextControl
                id="interaction-form-title"
                label="Form title"
                maxLength={60}
                value={form.title}
                disabled={!isAdmin}
                onChange={(title) => {
                  patchForm({ title });
                }}
              />
              <TextControl
                id="interaction-form-submit-label"
                label="Submit button"
                maxLength={30}
                value={form.submitLabel}
                disabled={!isAdmin}
                onChange={(submitLabel) => {
                  patchForm({ submitLabel });
                }}
              />
              <TextControl
                id="interaction-form-description"
                label="Description"
                maxLength={240}
                value={form.description}
                disabled={!isAdmin}
                onChange={(description) => {
                  patchForm({ description });
                }}
              />
            </div>
            {form.fields.map((field, index) => (
              <FormFieldEditor
                key={field.id}
                field={field}
                disabled={!isAdmin}
                onChange={(next) => {
                  patchField(index, next);
                }}
                onRemove={() => {
                  patchForm({ fields: form.fields.filter((_, i) => i !== index) });
                }}
              />
            ))}
            <Button
              type="button"
              variant="outline"
              disabled={!isAdmin || form.fields.length >= 5}
              onClick={addField}
            >
              Add field
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!isAdmin}
              onClick={() => {
                patch({ ...interactions, form: null });
              }}
            >
              Remove form
            </Button>
            <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
              Submitted answers are added to the conversation and processed by this bot’s configured
              AI and support team. Do not ask for passwords, payment details, or other sensitive
              information.
            </p>
          </>
        )}
      </fieldset>

      <FormAlert message={errorMessage(update.error)} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={!isAdmin || update.isPending}>
          Save interactions
        </Button>
        {update.isSuccess && (
          <span role="status" className="text-sm text-muted-foreground">
            Saved.
          </span>
        )}
      </div>
    </form>
  );
}

function FormFieldEditor({
  field,
  disabled,
  onChange,
  onRemove,
}: {
  field: FormField;
  disabled: boolean;
  onChange: (next: FormField) => void;
  onRemove: () => void;
}) {
  const id = `form-field-${field.id}`;
  const setType = (value: string): void => {
    const next: FormField =
      value === 'select'
        ? {
            id: field.id,
            label: field.label,
            type: 'select',
            required: field.required,
            options: ['Option 1', 'Option 2'],
          }
        : {
            id: field.id,
            label: field.label,
            type: value === 'email' ? 'email' : 'text',
            required: field.required,
          };
    onChange(next);
  };

  return (
    <div className="grid items-end gap-2 rounded-md bg-muted/40 p-3 sm:grid-cols-[1fr_130px_auto_auto]">
      <TextControl
        id={`${id}-label`}
        label="Field label"
        maxLength={60}
        value={field.label}
        disabled={disabled}
        onChange={(label) => {
          onChange({ ...field, label });
        }}
      />
      <div className="space-y-1 text-sm">
        <Label htmlFor={`${id}-type`}>Type</Label>
        <select
          id={`${id}-type`}
          className="h-10 w-full rounded-md border bg-background px-2"
          value={field.type}
          disabled={disabled}
          onChange={(event) => {
            setType(event.target.value);
          }}
        >
          <option value="text">Short text</option>
          <option value="email">Email</option>
          <option value="select">Choose one</option>
        </select>
      </div>
      {field.type === 'select' && (
        <div className="space-y-1 text-sm sm:col-span-2">
          <Label htmlFor={`${id}-options`}>Options, one per line</Label>
          <textarea
            id={`${id}-options`}
            className="min-h-10 w-full rounded-md border bg-background p-2"
            value={field.options.join('\n')}
            disabled={disabled}
            onChange={(event) => {
              onChange({
                ...field,
                options: event.target.value.split('\n').slice(0, 8),
              });
            }}
          />
        </div>
      )}
      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={field.required}
          disabled={disabled}
          onChange={(event) => {
            onChange({ ...field, required: event.target.checked });
          }}
        />
        Required
      </label>
      <Button type="button" variant="outline" disabled={disabled} onClick={onRemove}>
        Remove field
      </Button>
    </div>
  );
}
