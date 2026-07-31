// write-sync.ts — post-write sync for the classification tools.
//
// The eight write tools shipped before this rely on the local read-back probe
// and on the next ensureReady() sync. The tools added on top of them push the
// change themselves, so a caller that writes and immediately asks another
// client to read sees it.
//
// It never throws: the write has already landed in the local copy by the time
// this runs, so a failed sync is a delay, not a failed write. Reporting it as
// an exception would tell the user their change was lost when it was not.

export async function syncAfterWrite(api: any): Promise<{ synced: boolean; error?: string }> {
  try {
    await api.sync();
    return { synced: true };
  } catch (err) {
    return { synced: false, error: err instanceof Error ? err.message : String(err) };
  }
}
