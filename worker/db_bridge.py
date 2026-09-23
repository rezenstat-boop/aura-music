# Persistent SQLite bridge: JSON-lines SQLite bridge for the smoke test
import sys, json, sqlite3

conn = sqlite3.connect(':memory:')
conn.execute('PRAGMA foreign_keys = ON')
conn.executescript(open('schema.sql', encoding='utf-8').read())

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    out = {'id': req['id']}
    try:
        cur = conn.execute(req['sql'], req.get('params') or [])
        if cur.description:
            cols = [c[0] for c in cur.description]
            out['rows'] = [dict(zip(cols, row)) for row in cur.fetchall()]
        else:
            out['rows'] = []
        conn.commit()
    except Exception as e:
        out['error'] = str(e)
    sys.stdout.write(json.dumps(out) + '\n')
    sys.stdout.flush()
