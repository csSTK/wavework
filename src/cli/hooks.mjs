/**
 * Merging of wavework's hook entries into `.claude/settings.json`.
 *
 * A definition file has the same shape as the `hooks` key of settings.json:
 * `{ "hooks": { "<Event>": [ <entry>, ... ] } }`. An entry is one element of an event's array
 * (usually `{ matcher?, hooks: [...] }`). Ownership is per entry: wavework owns an entry when it is
 * deep-equal to one it was told to add. Foreign entries are never touched, reordered or removed.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** JSON with sorted keys, so deep equality ignores key order. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const same = (a, b) => canonical(a) === canonical(b);

/**
 * @param {unknown} json parsed definition file
 * @returns {{ event: string, entry: object }[]}
 */
export function parseHookDefs(json) {
  if (!isObject(json) || !isObject(json.hooks)) throw new Error('hook definitions: expected an object with a "hooks" object');
  const defs = [];
  for (const [event, entries] of Object.entries(json.hooks)) {
    if (!Array.isArray(entries)) throw new Error(`hook definitions: hooks.${event} must be an array`);
    entries.forEach((entry, i) => {
      if (!isObject(entry)) throw new Error(`hook definitions: hooks.${event}[${i}] must be an object`);
      defs.push({ event, entry });
    });
  }
  return defs;
}

/**
 * Pure. Removes previously owned entries that are no longer defined, adds missing defined ones.
 *
 * @param {object} settings parsed settings.json (not mutated)
 * @param {{ event: string, entry: object }[]} defs entries wavework defines now
 * @param {{ event: string, entry: object }[]} previouslyOwned from the lock
 * @returns {{ settings: object, owned: { event: string, entry: object }[], lost: { event: string, entry: object }[] }} `lost`: owned entries not found in settings (changed or removed by the user), not re-added
 */
export function mergeHooks(settings, defs, previouslyOwned) {
  const next = structuredClone(settings);
  if (next.hooks !== undefined && !isObject(next.hooks)) throw new Error('settings.json: "hooks" must be an object');
  const hooks = next.hooks;
  const events = () => next.hooks ?? {};
  const eventArray = (event) => {
    const value = events()[event];
    if (value !== undefined && !Array.isArray(value)) throw new Error(`settings.json: hooks.${event} must be an array`);
    return value;
  };

  let removedAny = false;
  for (const old of previouslyOwned) {
    if (defs.some((d) => d.event === old.event && same(d.entry, old.entry))) continue;
    const list = eventArray(old.event);
    const at = list?.findIndex((e) => same(e, old.entry)) ?? -1;
    if (at === -1) continue;
    list.splice(at, 1);
    removedAny = true;
    if (list.length === 0) delete next.hooks[old.event];
  }
  if (removedAny && hooks && Object.keys(next.hooks).length === 0) delete next.hooks;

  const owned = [];
  const lost = [];
  for (const { event, entry } of defs) {
    let list = eventArray(event);
    const wasOwned = previouslyOwned.some((o) => o.event === event && same(o.entry, entry));
    const kept = { event, entry: structuredClone(entry) };
    if (list?.some((e) => same(e, entry))) {
      if (wasOwned) owned.push(kept); // an identical entry that was there before us stays foreign
    } else if (wasOwned) {
      owned.push(kept); // we added it before, now it is gone or changed by the user: do not add a second copy
      lost.push(kept);
    } else {
      if (next.hooks === undefined) next.hooks = {};
      list ??= (next.hooks[event] = []);
      list.push(structuredClone(entry));
      owned.push(kept);
    }
  }
  return { settings: next, owned, lost };
}
