// src/paginate.js
//
// One shared list-response shape for every /api/* collection route.
// Every route builds a `filtered` array with its own domain-specific
// filters, then calls this to apply the *generic* page/limit/sort logic
// and wrap the result in a consistent envelope. Keeping this in one place
// means "page 2 is empty when it shouldn't be" is one bug to fix, not five.

export function paginate(items, req, { defaultSort } = {}) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));

  let sorted = items;
  const sortKey = req.query.sort || defaultSort;
  if (sortKey) {
    const desc = sortKey.startsWith("-");
    const key = desc ? sortKey.slice(1) : sortKey;
    sorted = [...items].sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      if (av === bv) return 0;
      const cmp = av > bv ? 1 : -1;
      return desc ? -cmp : cmp;
    });
  }

  const total = sorted.length;
  const start = (page - 1) * limit;
  const data = sorted.slice(start, start + limit);

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

// Case-insensitive substring match across a fixed set of fields.
// Used by every "?q=" search param below.
export function matchesQuery(record, fields, q) {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((field) => String(record[field] ?? "").toLowerCase().includes(needle));
}
