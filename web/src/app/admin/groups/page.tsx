/**
 * Recipient groups.
 *
 * Named audiences an admin maintains — test groups now, officials or board members
 * later. Groups appear in the compose screen's audience picker automatically, so
 * adding one here is all that is needed to message it.
 */

import Link from 'next/link'
import { requireAppUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createGroup, deleteGroup, removeMember, updateGroup } from './actions'
import { MemberPicker } from './member-picker'

export default async function GroupsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  await requireAppUser('admin')
  const { error } = await searchParams
  const db = supabaseAdmin()

  // Shape declared explicitly: the nested select confuses Supabase's inferred
  // types, and an unchecked `any` here would hide a real mistake in the join.
  interface GroupRow {
    id: string
    name: string
    description: string | null
    is_test_group: boolean
    recipient_group_members: Array<{
      person_id: string
      people: {
        id: string
        first_name: string
        last_name: string
        phone: string | null
      } | null
    }>
  }

  const { data: groupData } = await db
    .from('recipient_groups')
    .select(
      `id, name, description, is_test_group,
       recipient_group_members(person_id, people(id, first_name, last_name, phone))`
    )
    .order('is_test_group', { ascending: false })
    .order('name')

  const groups = (groupData ?? []) as unknown as GroupRow[]

  // Everyone who could be added. Only people with a phone number, since a group
  // member without one cannot receive anything and would only inflate the count.
  const { data: candidates } = await db
    .from('people')
    .select('id, first_name, last_name, status')
    .not('phone', 'is', null)
    .order('last_name')

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <p className="text-sm">
        <Link href="/admin" className="text-neutral-500 underline">
          &larr; Admin
        </Link>
      </p>

      <h1 className="mt-4 text-xl font-semibold">Recipient groups</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Named audiences for the compose screen. Groups appear in the &ldquo;Send
        to&rdquo; list as soon as they have members.
      </p>

      {error && (
        <p className="mt-4 rounded-lg border border-fwm-burgundy/40 bg-fwm-burgundy/5 p-3 text-sm text-fwm-burgundy" role="alert">
          {error}
        </p>
      )}

      {/* Renaming does not rewrite history: a message already sent keeps the
          audience label it was sent to. Worth saying, because it otherwise looks
          like the rename half-worked. */}
      <p className="mt-2 text-xs text-neutral-500">
        Renaming a group does not change what past messages say they were sent to —
        the send log records the name as it was at the time.
      </p>

      <div className="mt-8 space-y-6">
        {groups.map((g) => {
          const members = g.recipient_group_members ?? []
          const memberIds = new Set(members.map((m) => m.person_id))

          return (
            <section
              key={g.id}
              className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {/* Name and description are editable in place. Deliberately not
                      the test-group flag: that changes where the group sorts and
                      what compose defaults to, which is a different decision from
                      correcting a typo. */}
                  <form action={updateGroup} className="space-y-2">
                    <input type="hidden" name="group_id" value={g.id} />
                    <div className="flex items-center gap-2">
                      <input
                        name="name"
                        defaultValue={g.name}
                        required
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-medium hover:border-neutral-300 focus:border-neutral-400 dark:hover:border-neutral-700"
                      />
                      {g.is_test_group && (
                        <span className="shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                          test
                        </span>
                      )}
                    </div>
                    <input
                      name="description"
                      defaultValue={g.description ?? ''}
                      placeholder="What this group is for"
                      className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-sm text-neutral-500 hover:border-neutral-300 focus:border-neutral-400 dark:hover:border-neutral-700"
                    />
                    <button
                      type="submit"
                      className="ml-2 text-xs text-neutral-500 underline"
                    >
                      Save name and description
                    </button>
                  </form>

                  <p className="ml-2 mt-2 text-sm text-neutral-500">
                    {members.length} {members.length === 1 ? 'member' : 'members'}
                  </p>
                </div>

                <form action={deleteGroup}>
                  <input type="hidden" name="group_id" value={g.id} />
                  <button
                    type="submit"
                    className="text-xs text-neutral-500 underline hover:text-fwm-burgundy"
                  >
                    Delete group
                  </button>
                </form>
              </div>

              <ul className="mt-3 space-y-1 text-sm">
                {members.map((m) => (
                  <li key={m.person_id} className="flex items-center justify-between">
                    <span>
                      {m.people?.first_name} {m.people?.last_name}
                      {!m.people?.phone && (
                        <span className="ml-2 text-xs text-amber-700">no phone</span>
                      )}
                    </span>
                    <form action={removeMember}>
                      <input type="hidden" name="group_id" value={g.id} />
                      <input type="hidden" name="person_id" value={m.person_id} />
                      <button
                        type="submit"
                        className="text-xs text-neutral-500 underline hover:text-red-700"
                      >
                        remove
                      </button>
                    </form>
                  </li>
                ))}
              </ul>

              <MemberPicker
                groupId={g.id}
                candidates={(candidates ?? [])
                  .filter((p) => !memberIds.has(p.id as string))
                  .map((p) => ({
                    id: p.id as string,
                    first_name: p.first_name as string,
                    last_name: p.last_name as string,
                    status: p.status as string,
                  }))}
              />
            </section>
          )
        })}
      </div>

      {/* --- new group --- */}
      <section className="mt-10 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="font-medium">New group</h2>
        <form action={createGroup} className="mt-3 space-y-3">
          <label className="block">
            <span className="text-sm">Name</span>
            <input
              name="name"
              required
              placeholder="Board members"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </label>

          <label className="block">
            <span className="text-sm">Description</span>
            <input
              name="description"
              placeholder="What this group is for"
              className="mt-1 w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
          </label>

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="is_test_group" className="mt-1" />
            <span>
              Test group
              <span className="block text-xs text-neutral-500">
                Appears at the top of the audience list, and the compose screen
                defaults to it.
              </span>
            </span>
          </label>

          {/* There is deliberately no "skip the consent checks" option. Every group
              applies the gate — see migration 0020. */}
          <p className="text-xs text-neutral-500">
            Everyone in a group still needs to have opted in and had an intro text
            before they can receive a message. Groups choose who is asked, not
            whether consent applies.
          </p>

          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
          >
            Create group
          </button>
        </form>
      </section>
    </main>
  )
}
