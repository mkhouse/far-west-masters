/**
 * Message templates.
 *
 * The wording FWM sends over and over, held in one place so it stops drifting. The
 * intro text learned this lesson the expensive way — it had been sent 145 times in
 * five slightly different versions before migration 0023 stored it once.
 *
 * Open to any signed-in officer, unlike the rest of /admin. See actions.ts.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { categoryLabel, describePlaceholders, findPlaceholders } from '@/lib/templates'
import {
  archiveTemplate,
  createTemplate,
  restoreTemplate,
  updateTemplate,
} from './actions'
import { TemplateEditor } from './template-editor'

interface TemplateRow {
  id: string
  name: string
  category: string
  body: string
  archived_at: string | null
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; edit?: string; new?: string }>
}) {
  await requireAppUser()
  const { error, edit, new: creating } = await searchParams

  const { data } = await supabaseAdmin()
    .from('message_templates')
    .select('id, name, category, body, archived_at')
    .order('category')
    .order('name')

  const all = (data ?? []) as unknown as TemplateRow[]
  const live = all.filter((t) => !t.archived_at)
  const archived = all.filter((t) => t.archived_at)
  const editing = edit ? live.find((t) => t.id === edit) : undefined

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-600 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Message templates</h1>
      <p className="mt-1 text-sm text-neutral-600">
        Wording an officer starts from when contacting a member, with blanks filled in
        at send time. Choosing one never sends anything &mdash; it fills the compose
        box, and you still press Send.
      </p>

      {error && (
        <p
          className="mt-4 rounded-lg border border-fwm-burgundy/40 bg-fwm-burgundy/5 p-3 text-sm text-fwm-burgundy"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* --- edit one --- */}
      {editing && (
        <section className="mt-8 rounded-lg border border-neutral-200 bg-surface p-5 dark:border-neutral-800">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">Editing &ldquo;{editing.name}&rdquo;</h2>
            <Link href="/admin/templates" className="text-sm text-neutral-600 underline">
              Cancel
            </Link>
          </div>
          <div className="mt-4">
            <TemplateEditor
              action={updateTemplate}
              templateId={editing.id}
              initialName={editing.name}
              initialCategory={editing.category}
              initialBody={editing.body}
              submitLabel="Save changes"
            />
          </div>
        </section>
      )}

      {/* --- write a new one --- */}
      {creating && !editing && (
        <section className="mt-8 rounded-lg border border-neutral-200 bg-surface p-5 dark:border-neutral-800">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-medium">New template</h2>
            <Link href="/admin/templates" className="text-sm text-neutral-600 underline">
              Cancel
            </Link>
          </div>
          <div className="mt-4">
            <TemplateEditor action={createTemplate} submitLabel="Save template" />
          </div>
        </section>
      )}

      {!creating && !editing && (
        <p className="mt-6">
          <Link
            href="/admin/templates?new=1"
            className="inline-block rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            New template
          </Link>
        </p>
      )}

      {/* --- the live ones --- */}
      <h2 className="mt-10 text-sm font-medium text-neutral-600">
        {live.length} {live.length === 1 ? 'template' : 'templates'}
      </h2>

      {live.length === 0 && (
        <p className="mt-3 text-sm text-neutral-600">
          None yet. Migration 0029 seeds the eight FWM already uses.
        </p>
      )}

      <ul className="mt-3 space-y-3">
        {live.map((t) => {
          const blanks = findPlaceholders(t.body)
          return (
            <li
              key={t.id}
              className="rounded-lg border border-neutral-200 bg-surface p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{t.name}</span>
                <span className="text-sm text-neutral-600">
                  {categoryLabel(t.category)}
                </span>
              </div>

              {/* Monospaced and whitespace-preserving: the waiver template is a list
                  of steps, and reflowing it into a paragraph misrepresents it. */}
              <p className="mt-2 whitespace-pre-wrap font-mono text-sm text-neutral-600">
                {t.body}
              </p>

              <p className="mt-2 text-sm text-neutral-600">
                {describePlaceholders(blanks.map((b) => `{${b}}`))}
              </p>

              <div className="mt-3 flex items-center gap-4">
                <Link
                  href={`/admin/templates?edit=${t.id}`}
                  className="text-sm text-fwm-navy underline"
                >
                  Edit
                </Link>
                <form action={archiveTemplate}>
                  <input type="hidden" name="template_id" value={t.id} />
                  <button type="submit" className="text-sm text-neutral-600 underline">
                    Archive
                  </button>
                </form>
              </div>
            </li>
          )
        })}
      </ul>

      {/* --- archived, kept rather than deleted --- */}
      {archived.length > 0 && (
        <>
          <h2 className="mt-10 text-sm font-medium text-neutral-600">
            Archived ({archived.length})
          </h2>
          <p className="mt-1 text-sm text-neutral-600">
            Not offered in the picker. Kept because a template that has been used is
            part of the record of how the club communicates.
          </p>
          <ul className="mt-3 space-y-2">
            {archived.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-dashed border-neutral-300 p-3 dark:border-neutral-700"
              >
                <span className="text-sm text-neutral-600">
                  {t.name} — {categoryLabel(t.category)}
                </span>
                <form action={restoreTemplate}>
                  <input type="hidden" name="template_id" value={t.id} />
                  <button type="submit" className="text-sm text-fwm-navy underline">
                    Restore
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
