"""The QR code of the Say thanks payment link, as THANKS.stripeQr in src/core.js.

    pip install segno
    python tools/qr-path.py https://buy.stripe.com/...

Prints the object to paste over stripeQr: the link it encodes ("for" - the
panel shows the code only while it matches THANKS.stripe), the number of
modules a side, and the dark modules as one SVG path, a run of modules per
command. Level Q, so a code on a bright screen still reads.
"""
import sys

import segno

url = sys.argv[1]
qr = segno.make(url, error='q', micro=False)
rows = [list(r) for r in qr.matrix]
path = []
for y, row in enumerate(rows):
    x = 0
    while x < len(row):
        if row[x]:
            start = x
            while x < len(row) and row[x]:
                x += 1
            path.append('M%d %dh%dv1h-%dz' % (start, y, x - start, x - start))
        else:
            x += 1
print("stripeQr: {\n  for: '%s',\n  size: %d,\n  path: '%s'\n}," % (url, len(rows), ''.join(path)))
